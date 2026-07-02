import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  type HttpException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AVG_UNIT_PRICE_WINDOW_DAYS,
  ForecastingService,
} from '../forecasting/forecasting.service';
import { PrismaService } from '../platform/prisma/prisma.service';
import { type ChatQueryResponse, type CoreAiAnswerRequest } from '../shared';
import { CoreAiChatClient } from './core-ai-chat.client';
import { estimateRevenue, formatDriverLabels } from './forecast-answer.util';
import { classifyIntent, type ChatDateRange } from './intent-classifier.util';
import { todayLima } from './lima-date.util';
import { ANALYTICS_SCHEMA_CONTEXT } from './schema-context';
import { validateSql, MAX_ROWS } from './sql-validator.util';

/**
 * LOTE B3 · Respuestas fijas para las intenciones que NUNCA llegan a core-ai
 * (`out_of_domain`/`ambiguous`) — texto estático, no generado por LLM, porque
 * la clasificación en sí ya decidió que no hay nada que preguntarle al modelo.
 * `provider`/`model` reportan "system"/"intent-classifier" (en vez de mock/
 * openai/etc.) para que la respuesta sea auditable igual que el resto del
 * contrato (el frontend/QA puede distinguir "esto lo resolvió el LLM" de
 * "esto lo resolvió el gate determinístico").
 */
const OUT_OF_DOMAIN_ANSWER =
  'Solo puedo responder sobre los datos de tu negocio (ventas, insumos, ' +
  'recetas, empleados, pronósticos, etc.). Prueba con una pregunta sobre tu restaurante.';

const AMBIGUOUS_ANSWER =
  'Tu pregunta es un poco ambigua. ¿Puedes ser más específico? Por ejemplo: ' +
  '"¿cuáles fueron mis ventas de esta semana?", "¿qué insumos están por ' +
  'agotarse?" o "¿cuánto voy a vender este fin de semana?".';

const NEEDS_FORECAST_ANSWER =
  'Todavía no hay ningún pronóstico generado para tu negocio, así que no ' +
  'puedo responder preguntas sobre el futuro. Genera un pronóstico desde ' +
  'la lista de compras para que pueda usarlo en el chat.';

/**
 * QA-23 (LOTE B5) · La serie `scope: 'total'` que alimenta el forecast agrega
 * `qty` de `sales_history` (unidades — ver `sales-aggregation.util.ts`), NUNCA
 * dinero. Este es el shape ÚNICO que hoy expone `ForecastingService`, así que
 * la etiqueta es una constante fija (no viene de la corrida) — si algún día
 * se agrega un `scope` de ingresos reales, esta constante deja de ser válida
 * y debe volverse dinámica.
 */
const FORECAST_UNIT_LABEL = 'platos';

/**
 * Postgres SQLSTATE for `query_canceled` — raised when our own
 * `SET LOCAL statement_timeout` fires. Distinguished from other execution
 * failures because it means "safe query, too expensive" (504) rather than
 * "the generated SQL is not actually valid against our schema" (502).
 */
const POSTGRES_QUERY_CANCELED = '57014';

/**
 * Raw row returned by Prisma $queryRawUnsafe. Column values can be
 * primitives, Dates, Prisma Decimal objects, or BigInts depending on the
 * PostgreSQL column type. We serialise everything to JSON-safe values before
 * returning to the HTTP layer.
 */
type RawRow = Record<string, unknown>;

/**
 * E09 · ChatService — orchestration layer for the Text-to-SQL chat feature.
 *
 * Security invariants (backend.md §8.2):
 *  1. tenant_id comes ONLY from the JWT claim (passed via `tenantId` param).
 *  2. Every DB query runs inside runInTenant() so RLS FORCE is active.
 *  3. The SQL validation hard gate (validateSql) MUST pass before any query
 *     reaches $queryRawUnsafe.
 *  4. statement_timeout prevents denial-of-service via expensive queries.
 *  5. core-ai never touches the business DB — it only generates the SQL.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly coreAiChat: CoreAiChatClient,
    private readonly forecasting: ForecastingService,
  ) {}

  /**
   * Answer a natural-language analytics question for the given tenant.
   *
   * LOTE B3 (preguntas sobre el futuro + rechazo elegante fuera de dominio):
   * the question is classified BEFORE deciding whether to call core-ai at
   * all (see `intent-classifier.util.ts` for the full design rationale).
   *   - `future`        → answered from the latest completed `ForecastRun`
   *                        (`ForecastingService.getForecastForRange`), no SQL.
   *   - `out_of_domain` → rejected with a fixed message, no SQL, no LLM call.
   *   - `ambiguous`     → asked to clarify (2-3 example questions), no SQL.
   *   - `historical`    → the ORIGINAL flow, byte-for-byte unchanged below:
   *       1. Call core-ai to translate the question into a SQL SELECT.
   *       2. Run the SQL through the 9-rule validation hard gate.
   *       3. Execute under runInTenant (RLS + statement_timeout).
   *       4. Optionally call core-ai for a Spanish NL answer (non-fatal).
   *
   * @param tenantId  UUID from the JWT claim — never from request body.
   * @param question  Natural-language question from the user.
   */
  async query(tenantId: string, question: string): Promise<ChatQueryResponse> {
    const intent = classifyIntent(question, todayLima());

    switch (intent.kind) {
      case 'out_of_domain':
        // Transparency: log WHY nothing was executed (mirrors the validator's
        // own rejection logging) — helps QA/incident triage distinguish "the
        // classifier rejected this" from "core-ai/the validator rejected it".
        this.logger.log(
          `Chat: pregunta clasificada fuera de dominio, no se generó SQL: "${question}"`,
          { tenantId },
        );
        return this.staticResponse('out_of_domain', OUT_OF_DOMAIN_ANSWER);

      case 'ambiguous':
        return this.staticResponse('ambiguous', AMBIGUOUS_ANSWER);

      case 'future':
        return this.answerFuture(tenantId, intent.range);

      case 'historical':
      default:
        return this.answerHistorical(tenantId, question);
    }
  }

  /**
   * LOTE B3 · Responde una pregunta sobre el futuro desde la última
   * `ForecastRun` completada — NUNCA genera SQL (no hay "ventas futuras" en
   * `sales_history`) y NUNCA dispara una corrida nueva (ver invariante en
   * `ForecastingService.getForecastForRange`).
   */
  private async answerFuture(
    tenantId: string,
    range: ChatDateRange,
  ): Promise<ChatQueryResponse> {
    const result = await this.forecasting.getForecastForRange(
      tenantId,
      range.from,
      range.to,
    );

    if (result.needsForecast) {
      return this.staticResponse('future', NEEDS_FORECAST_ANSWER);
    }

    if (result.outOfHorizon) {
      const horizonHint = result.horizonEnd
        ? ` El pronóstico más reciente solo cubre hasta el ${result.horizonEnd}.`
        : '';
      return this.staticResponse(
        'future',
        `Tu pregunta cae fuera del rango que cubre el último pronóstico.${horizonHint} ` +
          'Genera un nuevo pronóstico con un horizonte más amplio para poder responder eso.',
      );
    }

    // Non-null by construction: outOfHorizon===false implies points.length > 0
    // (see ForecastingService.getForecastForRange), so the sums were computed.
    const totalYhat = result.totalYhat as number;
    const totalLo = result.totalLo as number;
    const totalHi = result.totalHi as number;

    // QA-22 · Dedupe labels before narrating them — a full weekend brings 2
    // `weekend` drivers (sat+sun) with the SAME label; without this the
    // sentence read "Incluye el efecto de Fin de semana, Fin de semana."
    const driverText =
      result.drivers.length > 0
        ? ` Incluye el efecto de ${formatDriverLabels(result.drivers.map((d) => d.label))}.`
        : '';

    // QA-23 · `totalYhat`/`totalLo`/`totalHi` are UNITS (platos), never S/ —
    // see `FORECAST_UNIT_LABEL` and `ForecastingService.demandSeries`
    // (aggregates `qty`, not `qty × unitPrice`). Rounded to whole dishes for
    // the sentence (you can't sell half a plate) — the raw, unrounded values
    // still travel in `forecast.totalYhat/totalLo/totalHi` for any consumer
    // that wants full precision (e.g. a chart).
    const estimatedRevenue = estimateRevenue(
      { total: totalYhat, lo: totalLo, hi: totalHi },
      result.avgUnitPrice,
      AVG_UNIT_PRICE_WINDOW_DAYS,
    );
    const revenueText = estimatedRevenue
      ? ` Estimado en S/ ${estimatedRevenue.total.toFixed(2)} según tu ticket ` +
        `promedio por plato de los últimos ${estimatedRevenue.basisDays} días ` +
        `(S/ ${estimatedRevenue.avgUnitPrice.toFixed(2)}/plato).`
      : '';

    const answer =
      `Se proyectan ~${Math.round(totalYhat)} ${FORECAST_UNIT_LABEL} para ${range.label} ` +
      `(banda estimada ${Math.round(totalLo)}–${Math.round(totalHi)} ${FORECAST_UNIT_LABEL}).` +
      `${revenueText}${driverText} Nota: esto es una proyección del modelo, no una venta confirmada.`;

    return {
      answer,
      sql: '',
      columns: [],
      rows: [],
      provider: 'system',
      model: 'forecast-run',
      kind: 'future',
      forecast: {
        runId: result.runId as string,
        range,
        totalYhat,
        totalLo,
        totalHi,
        unitLabel: FORECAST_UNIT_LABEL,
        estimatedRevenue,
        points: result.points,
        drivers: result.drivers,
      },
    };
  }

  /** LOTE B3 · Respuesta sin SQL/LLM (out_of_domain, ambiguous, o future sin datos). */
  private staticResponse(
    kind: 'out_of_domain' | 'ambiguous' | 'future',
    answer: string,
  ): ChatQueryResponse {
    return {
      answer,
      sql: '',
      columns: [],
      rows: [],
      provider: 'system',
      model: 'intent-classifier',
      kind,
    };
  }

  /**
   * Original Text-to-SQL flow (HU-09-01), UNCHANGED by LOTE B3 — only reached
   * when `classifyIntent` returns `historical`.
   *
   * Flow:
   *  1. Call core-ai to translate the question into a SQL SELECT.
   *  2. Run the SQL through the 9-rule validation hard gate.
   *  3. Execute under runInTenant (RLS + statement_timeout).
   *  4. Optionally call core-ai for a Spanish NL answer (non-fatal).
   *  5. Return the full response in ApiResponse shape.
   */
  private async answerHistorical(
    tenantId: string,
    question: string,
  ): Promise<ChatQueryResponse> {
    // --- Step 1: LLM generates SQL ---
    const nl2sqlResp = await this.coreAiChat.nl2sql({
      question,
      schema_context: ANALYTICS_SCHEMA_CONTEXT,
      dialect: 'postgresql',
      max_rows: MAX_ROWS,
    });

    // --- Step 2: Hard validation gate ---
    const validation = validateSql(nl2sqlResp.sql);
    if (!validation.ok) {
      this.logger.warn(
        `Chat SQL rejected (rule ${validation.error.rule}): ${validation.error.reason}`,
        { tenantId, question, rawSql: nl2sqlResp.sql },
      );
      throw new BadRequestException(
        `No pude generar una consulta segura para eso: ${validation.error.reason}`,
      );
    }

    const validSql = validation.value.sql;
    let columns: string[] = [];
    let rows: unknown[][] = [];

    // --- Step 3: Execute under RLS FORCE + statement_timeout ---
    // The validator only checks SYNTACTIC safety (no DDL/DML, allowlisted
    // tables, no sensitive columns) — it cannot know whether every column the
    // LLM referenced actually exists in the real schema. A hallucinated
    // column/table typo, an ambiguous JOIN, or a query that legitimately
    // needs more time than the hard timeout allows can still fail here.
    // backend.md §8.2 requires that this NEVER surface as an unhandled 500:
    // we catch it and degrade to a controlled, user-facing error instead.
    try {
      await this.prisma.runInTenant(tenantId, async (tx) => {
        // defence-in-depth: 5-second hard timeout prevents infinite/expensive
        // queries even if the validator passed a technically-valid but slow query.
        await tx.$executeRaw`SET LOCAL statement_timeout = '5000'`;

        const raw = await tx.$queryRawUnsafe<RawRow[]>(validSql);

        if (raw.length > 0 && raw[0] != null) {
          columns = Object.keys(raw[0]);
          rows = raw.map((r) => Object.values(r).map(toJsonSafe));
        }
      });
    } catch (err) {
      throw this.mapExecutionError(err, tenantId, question, validSql);
    }

    // --- Step 4: Optional NL answer from core-ai (graceful degradation) ---
    let answer: string;
    const answerReq: CoreAiAnswerRequest = {
      question,
      columns,
      rows,
      provider: nl2sqlResp.provider,
    };
    const answerResp = await this.coreAiChat.answerFromRows(answerReq);
    if (answerResp) {
      answer = answerResp.answer;
    } else {
      answer = this.defaultAnswer(rows.length);
    }

    return {
      answer,
      sql: validSql,
      columns,
      rows,
      provider: nl2sqlResp.provider,
      model: nl2sqlResp.model,
      kind: 'historical',
    };
  }

  private defaultAnswer(rowCount: number): string {
    return rowCount === 0
      ? 'No se encontraron datos para esa consulta.'
      : `Se encontraron ${rowCount} registro(s).`;
  }

  /**
   * Map a failure raised while executing the validated SQL to an appropriate
   * HTTP exception. This is the last line of defence per backend.md §8.2: an
   * unhandled 500 must never reach the client, even when the LLM produces SQL
   * that passes the validator's syntactic checks but fails at execution time
   * against the real schema (e.g. a hallucinated column/table name), or a
   * query that is safe but too expensive for the hard statement_timeout.
   *
   * Classification:
   *  - Postgres SQLSTATE 57014 (`query_canceled`, raised by OUR OWN
   *    `SET LOCAL statement_timeout`) → 504 Gateway Timeout: the query was
   *    safe but too slow. The user can retry with a narrower question.
   *  - Any other raw-query failure (undefined column/table, type mismatch,
   *    division by zero, ambiguous reference, etc.) → 502 Bad Gateway: the
   *    upstream LLM produced SQL that is not actually executable against our
   *    schema — this is an upstream generation-quality problem, not a client
   *    input problem, so it is NOT a 4xx.
   *
   * Both branches log the tenant, question, raw SQL, and Postgres error code
   * at `error` level for incident triage; the message returned to the client
   * stays generic and safe — same policy as the SQL validator's own
   * rejection messages (no internal schema/stack-trace detail leaked).
   */
  private mapExecutionError(
    err: unknown,
    tenantId: string,
    question: string,
    sql: string,
  ): HttpException {
    const pgCode = this.extractPostgresErrorCode(err);
    this.logger.error(
      `Chat SQL execution failed (pgCode=${pgCode ?? 'unknown'}): ${
        err instanceof Error ? err.message : String(err)
      }`,
      { tenantId, question, sql },
    );

    if (pgCode === POSTGRES_QUERY_CANCELED) {
      return new GatewayTimeoutException(
        'La consulta tardó demasiado en responder. Prueba acotar el rango de fechas o ser más específico.',
      );
    }

    return new BadGatewayException(
      'No pude ejecutar la consulta que generé para tu pregunta. Prueba reformularla de otra manera.',
    );
  }

  /**
   * Extract the underlying Postgres SQLSTATE from a Prisma raw-query error,
   * if present. Prisma wraps `$queryRawUnsafe` failures as
   * `PrismaClientKnownRequestError` (code 'P2010', "Raw query failed") and
   * puts the real Postgres error code in `error.meta.code` (e.g. '42703' for
   * undefined_column, '57014' for query_canceled). Returns undefined for any
   * other error shape so the caller falls back to the generic 502 branch.
   */
  private extractPostgresErrorCode(err: unknown): string | undefined {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      typeof err.meta === 'object' &&
      err.meta !== null &&
      'code' in err.meta &&
      typeof err.meta['code'] === 'string'
    ) {
      return (err.meta as Record<string, string>)['code'];
    }
    return undefined;
  }
}

/**
 * Convert a Prisma raw-query value to a JSON-serialisable primitive.
 *
 * Prisma maps PostgreSQL types as follows:
 *   - DECIMAL / NUMERIC → Prisma.Decimal (has .toNumber())
 *   - BIGINT            → BigInt (not JSON-serialisable)
 *   - TIMESTAMPTZ       → Date
 *   - UUID / TEXT       → string
 *   - INT / FLOAT       → number
 *
 * We flatten to primitives so Fastify can serialise the response without
 * a custom JSON replacer. Note: no `any` — we stay within `unknown` and
 * use type narrowing to reach known interfaces.
 */
function toJsonSafe(value: unknown): unknown {
  if (value === null || value === undefined) return null;

  if (typeof value === 'bigint') return Number(value);

  if (value instanceof Date) return value.toISOString();

  // Prisma.Decimal exposes a toNumber() method. We detect by duck-typing
  // rather than instanceof to avoid importing the Prisma namespace here.
  if (
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>)['toNumber'] === 'function'
  ) {
    return (value as { toNumber(): number }).toNumber();
  }

  return value;
}
