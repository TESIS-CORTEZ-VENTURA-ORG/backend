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

/** Explicit forecast/projection vocabulary — always a future/forecast question. */
const FORECAST_WORD_RE =
  /\b(pronostic\w*|forecast\w*|proyecc\w*|proyectad\w*|predicc\w*|predic\w*)\b/;

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
 *   1. Future signal (explicit date phrase, ir-a-infinitive, or forecast
 *      vocabulary) → 'future'. Checked FIRST because a future business
 *      question ("¿cuánto voy a vender este fin de semana?") also contains a
 *      domain keyword ("vender") — future takes priority over historical.
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

  const explicitRange = resolveExplicitRange(q, todayLima);
  const hasFutureSignal =
    explicitRange !== null ||
    FUTURE_VERB_RE.test(q) ||
    FORECAST_WORD_RE.test(q);

  if (hasFutureSignal) {
    return {
      kind: 'future',
      range: explicitRange ?? defaultFutureRange(todayLima),
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
