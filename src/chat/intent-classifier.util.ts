import {
  addDays,
  dayOfWeek,
  firstDayOfNextMonth,
  lastDayOfMonth,
} from './lima-date.util';

/**
 * Intent classifier for the chat (HU-09-01 refinamiento — LOTE B3).
 *
 * DESIGN DECISION (documented per ticket instructions): classification is a
 * DETERMINISTIC HEURISTIC (keywords + Spanish temporal phrases), not an extra
 * LLM round-trip.
 *
 * Why NOT ask the LLM to classify (either as a separate call or folded into
 * the same nl2sql prompt)?
 *   1. Scope constraint: this batch may NOT touch `team-core-ai`. core-ai's
 *      only chat endpoints are `/chat/nl2sql` (translates NL → SQL against
 *      the REAL schema) and `/chat/answer` (narrates rows). Neither is a
 *      classifier, and repurposing `/chat/nl2sql` for classification would
 *      require changing its contract (a core-ai change), which is out of
 *      scope here.
 *   2. Security posture: `sql-validator.util.ts` documents the repo's stance
 *      explicitly — "conservative / reject-on-doubt", "defence-in-depth,
 *      no single layer is trusted alone". An out-of-domain / future-intent
 *      gate that runs BEFORE any LLM call is a harder guarantee than trusting
 *      the same LLM that we already know can hallucinate columns/tables
 *      (see `schema-context.ts` incident log) to also self-report intent.
 *      A deterministic function is exhaustively unit-testable (this file's
 *      spec enumerates every branch) — an LLM classification step is not.
 *   3. Cost/latency: avoids a second 20s-timeout HTTP round-trip
 *      (`CoreAiChatClient` DEFAULT_TIMEOUT_MS) for every single question,
 *      including the common case (historical queries, unchanged).
 *
 * Trade-off accepted: the heuristic is necessarily imperfect for open-ended
 * phrasing it wasn't tuned for (documented below, per branch). This is the
 * same trade-off the repo already makes with `validateSql`'s regex-based
 * table/column extraction — conservative and testable beats clever and opaque.
 *
 * SECURITY INVARIANT: classification NEVER bypasses `validateSql`. Only the
 * 'historical' branch reaches `CoreAiChatClient.nl2sql` + the SQL validator +
 * `runInTenant` at all — 'future' answers from `ForecastRun` data (no SQL),
 * and 'out_of_domain'/'ambiguous' never call core-ai or touch the DB.
 */

export type ChatIntentKind =
  | 'historical'
  | 'future'
  | 'out_of_domain'
  | 'ambiguous';

/** Inclusive day range (`YYYY-MM-DD`, Lima) the user asked about, plus a Spanish label for the answer. */
export interface ChatDateRange {
  from: string;
  to: string;
  label: string;
}

export type ChatIntent =
  | { kind: 'historical' }
  | { kind: 'out_of_domain' }
  | { kind: 'ambiguous' }
  | { kind: 'future'; range: ChatDateRange };

/** Fallback window (days) when a future question has no explicit recognizable range (e.g. "¿cuánto vamos a vender?"). */
const DEFAULT_FUTURE_HORIZON_DAYS = 7;

// ---------------------------------------------------------------------------
// Domain vocabulary — mirrors the nouns in `ANALYTICS_SCHEMA_CONTEXT` (the
// business entities this chat can actually answer about). A question that
// matches NONE of these AND has no future-temporal signal is out of domain.
// ---------------------------------------------------------------------------
const DOMAIN_KEYWORD_RE =
  /\b(venta|ventas|vend\w*|ingreso|ingresos|facturac\w*|insumo|insumos|ingredient\w*|stock|inventario|receta|recetas|plato|platos|menu|menus|empleado|empleados|mesa|mesas|pedido|pedidos|orden|ordenes|pago|pagos|factura|facturas|boleta|boletas|proveedor|proveedores|compra|compras|costo|costos|margen|utilidad|ganancia|ganancias|cliente|clientes|propina|propinas|turno|turnos|caja|gasto|gastos|overhead|demanda|negocio|restaurante|agotar\w*|quincena|feriado|feriados|cocina|mozo|cierre|notificacion\w*|reporte|reportes|cliente|categoria\w*|unidad\w*|kardex|compras|abastec\w*)\b/;

/** Ir-a-infinitive future tense: "voy/vamos/va/van a vender", "vamos a facturar". */
const FUTURE_VERB_RE = /\b(voy|vamos|van|va)\s+a\s+[a-záéíóúñ]+(ar|er|ir)\b/;

/**
 * QA-24 · Simple future tense ("venderé", "ganaré", "tendré" — 1st/2nd/3rd
 * person, singular/plural), the OTHER way Spanish expresses futurity besides
 * the ir-a-infinitive construction above. ALL Spanish future-tense verbs,
 * regular AND irregular, are built as [infinitive or irregular stem] + é/ás/
 * á/emos/éis/án — and that stem always ends in "r" (it either IS the
 * infinitive, e.g. vender+é="venderé", or an irregular future stem that keeps
 * the "r", e.g. tener→tendr+é="tendré", poder→podr+é="podré"). So a word
 * ending in one of these accented suffixes is, for practical purposes, always
 * a future-tense verb — the WRITTEN ACCENT is the signal, which is why this
 * regex runs against `qAccented` (accents preserved) instead of the
 * diacritic-stripped `q` used everywhere else in this file.
 *
 * Known false-positive trade-off (documented, not fixed): a handful of
 * unrelated words also end in an accented "-rá/-rás" (e.g. "detrás"). Same
 * accepted imprecision as the rest of this heuristic classifier (see file
 * JSDoc) — a deterministic gate that's slightly over-eager beats an LLM
 * round-trip that can hallucinate.
 */
const FUTURE_TENSE_ACCENT_RE =
  /\b[a-zñ]{3,}(ré|rás|rá|remos|réis|rán)(?![a-záéíóúñ])/;

/** Explicit forecast/projection vocabulary — always a future/forecast question. */
const FORECAST_WORD_RE =
  /\b(pronostic\w*|forecast\w*|proyecc\w*|proyectad\w*|predicc\w*|predic\w*)\b/;

/**
 * QA-24 · Nombre de mes en español (incluye "setiembre", grafía usual en
 * Perú) → número de mes (1-12). Un nombre de mes NO es, por sí solo, una
 * señal de futuro (a diferencia de "mañana"/"fin de semana"/"próximo mes":
 * esas frases son intrínsecamente prospectivas, pero "diciembre" puede
 * aparecer en una pregunta histórica igual de válida, "¿cuánto vendí en
 * diciembre?"). Por eso {@link resolveMonthRange} solo se consulta cuando
 * YA hay una señal de futuro por otra vía (verbo, "pronóstico", etc.) — ver
 * `classifyIntent`.
 */
const MONTH_NUMBER_BY_NAME: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};
const MONTH_NAME_RE =
  /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/;

/**
 * Vague filler phrases with no specific business noun attached — the exact
 * QA-08 repro ("¿cómo va todo?"). Only treated as ambiguous when NO domain
 * keyword is also present (a domain keyword disambiguates the scope, e.g.
 * "¿cómo van las ventas de hoy?" is NOT ambiguous — it has "ventas").
 */
const AMBIGUOUS_RE =
  /\b(como\s+va(mos)?|que\s+tal|como\s+estamos|como\s+andamos|resumen\s+general|cuentame\s+(de\s+)?todo|dame\s+un\s+resumen|como\s+esta\s+todo)\b/;

/** Lowercase + strip diacritics so "cómo"/"como", "mañana"/"manana" match the same regex. */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Recognizes an explicit Spanish temporal phrase in `q` (already normalized)
 * and resolves it to a concrete day range anchored on `todayLima`.
 * Returns `null` when no explicit phrase is found — the caller falls back to
 * {@link defaultFutureRange} when a future signal was detected some other way
 * (e.g. `FUTURE_VERB_RE` alone, "¿cuánto vamos a vender?" with no date phrase).
 */
function resolveExplicitRange(
  q: string,
  todayLima: string,
): ChatDateRange | null {
  if (/\bpasado\s+manana\b/.test(q)) {
    const d = addDays(todayLima, 2);
    return { from: d, to: d, label: 'pasado mañana' };
  }
  if (/\bmanana\b/.test(q)) {
    const d = addDays(todayLima, 1);
    return { from: d, to: d, label: 'mañana' };
  }
  if (/\bfin\s+de\s+semana\b/.test(q)) {
    // Próximo sábado (incluye HOY si hoy ya es sábado) + domingo siguiente.
    const dow = dayOfWeek(todayLima); // 0=domingo..6=sábado
    const daysToSat = (6 - dow + 7) % 7;
    const sat = addDays(todayLima, daysToSat);
    const sun = addDays(sat, 1);
    return { from: sat, to: sun, label: 'este fin de semana' };
  }
  if (/\b(proxima\s+semana|semana\s+que\s+viene)\b/.test(q)) {
    const dow = dayOfWeek(todayLima);
    const daysToNextMonday = (8 - dow) % 7 || 7;
    const mon = addDays(todayLima, daysToNextMonday);
    const sun = addDays(mon, 6);
    return { from: mon, to: sun, label: 'la próxima semana' };
  }
  if (/\besta\s+semana\b/.test(q)) {
    const dow = dayOfWeek(todayLima);
    const daysToSunday = (7 - dow) % 7;
    const sun = addDays(todayLima, daysToSunday);
    return { from: todayLima, to: sun, label: 'esta semana' };
  }
  if (/\b(proximo\s+mes|mes\s+que\s+viene)\b/.test(q)) {
    const from = firstDayOfNextMonth(todayLima);
    return { from, to: lastDayOfMonth(from), label: 'el próximo mes' };
  }
  if (/\beste\s+mes\b/.test(q)) {
    return {
      from: todayLima,
      to: lastDayOfMonth(todayLima),
      label: 'este mes',
    };
  }
  return null;
}

/**
 * QA-24 · Resolves a bare month name ("diciembre") to the NEXT occurrence of
 * that calendar month relative to `todayLima` — never the past. If the named
 * month is the current month or later this year, it resolves within the
 * current year; otherwise it rolls over to next year (mirrors the rollover
 * `resolveExplicitRange` already does for "el próximo mes" in December).
 * `null` when no month name is present. Only called from `classifyIntent`
 * AFTER a future signal was already confirmed by some other means (see the
 * `MONTH_NAME_RE` JSDoc for why a bare month name must not, by itself, imply
 * futurity).
 */
function resolveMonthRange(q: string, todayLima: string): ChatDateRange | null {
  const match = MONTH_NAME_RE.exec(q);
  if (!match) return null;

  const monthName = match[1];
  const monthIndex = MONTH_NUMBER_BY_NAME[monthName];
  const [todayYear, todayMonth] = todayLima.split('-').map(Number) as [
    number,
    number,
  ];
  const year = monthIndex < todayMonth ? todayYear + 1 : todayYear;
  const from = `${year}-${String(monthIndex).padStart(2, '0')}-01`;
  return { from, to: lastDayOfMonth(from), label: monthName };
}

/** No explicit phrase, but a future signal was found some other way — default to a 1-week window. */
function defaultFutureRange(todayLima: string): ChatDateRange {
  const from = addDays(todayLima, 1);
  const to = addDays(todayLima, DEFAULT_FUTURE_HORIZON_DAYS);
  return {
    from,
    to,
    label: `los próximos ${DEFAULT_FUTURE_HORIZON_DAYS} días`,
  };
}

/**
 * Classify a natural-language chat question. `todayLima` is `YYYY-MM-DD`
 * (America/Lima) — pass `todayLima()` from `lima-date.util.ts` in production,
 * a fixed string in tests for determinism.
 *
 * Branch order matters:
 *   1. Future signal (explicit date phrase, ir-a-infinitive, simple future
 *      tense — QA-24 — or forecast vocabulary) → 'future'. Checked FIRST
 *      because a future business question ("¿cuánto voy a vender este fin de
 *      semana?") also contains a domain keyword ("vender") — future takes
 *      priority over historical.
 *   2. No future signal, no domain keyword, vague filler phrase → 'ambiguous'.
 *   3. No future signal, no domain keyword, no vague phrase → 'out_of_domain'.
 *   4. Otherwise (has a domain keyword) → 'historical' (existing nl2sql flow,
 *      UNCHANGED — this is the regression-safe default).
 */
export function classifyIntent(
  question: string,
  todayLima: string,
): ChatIntent {
  const q = normalize(question);
  // QA-24 · Kept SEPARATE from `q` (accents preserved, only lowercased) —
  // `FUTURE_TENSE_ACCENT_RE` needs the written accent as its signal, which
  // `normalize()` strips for every other check in this function.
  const qAccented = question.toLowerCase();

  const explicitRange = resolveExplicitRange(q, todayLima);
  const hasFutureSignal =
    explicitRange !== null ||
    FUTURE_VERB_RE.test(q) ||
    FUTURE_TENSE_ACCENT_RE.test(qAccented) ||
    FORECAST_WORD_RE.test(q);

  if (hasFutureSignal) {
    // QA-24 · A bare month name ("diciembre") only resolves the range when we
    // already know (from the check above) the question IS about the future —
    // see `resolveMonthRange` JSDoc for why it can't set `hasFutureSignal` on
    // its own. Only consulted when `resolveExplicitRange` found nothing more
    // specific (e.g. "el próximo mes" still wins over a stray month mention).
    const monthRange =
      explicitRange === null ? resolveMonthRange(q, todayLima) : null;
    return {
      kind: 'future',
      range: explicitRange ?? monthRange ?? defaultFutureRange(todayLima),
    };
  }

  const hasDomainKeyword = DOMAIN_KEYWORD_RE.test(q);

  if (!hasDomainKeyword) {
    return AMBIGUOUS_RE.test(q)
      ? { kind: 'ambiguous' }
      : { kind: 'out_of_domain' };
  }

  return { kind: 'historical' };
}
