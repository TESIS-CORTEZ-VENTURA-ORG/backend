import { z } from 'zod';
import {
  forecastDriverSchema,
  forecastPointSchema,
} from '../forecasting/forecast';

/**
 * E09 · Contrato del chat analítico Text-to-SQL (backend.md §8.2).
 * Zod es la única fuente de verdad; los tipos TS se infieren de los schemas.
 * Pydantic espeja estos tipos en core-ai/app/chat/schemas.py.
 *
 * Flujo: POST /api/chat/query → validateSql (9 reglas) → runInTenant
 * (RLS FORCE + statement_timeout) → core-ai /chat/answer → ApiResponse<T>.
 *
 * Invariante de seguridad: tenant_id SIEMPRE proviene del JWT, NUNCA del
 * body de la pregunta. El SQL generado se valida antes de ejecutarse.
 * RLS FORCE provee una segunda capa independiente de la validación.
 *
 * Refinamiento LOTE B3 (preguntas sobre el futuro + rechazo fuera de dominio):
 * `ChatService.query` clasifica la pregunta ANTES de decidir si genera SQL
 * (ver `src/chat/intent-classifier.util.ts`). `kind`/`forecast` son ADITIVOS
 * y opcionales — un cliente que solo lea `answer/sql/columns/rows` (el shape
 * previo a este cambio) sigue funcionando sin cambios.
 */

// ---------------------------------------------------------------------------
// Endpoint público: POST /api/chat/query
// ---------------------------------------------------------------------------

/** Input del endpoint público. */
export const chatQuerySchema = z.object({
  /** Pregunta en lenguaje natural del usuario. */
  question: z.string().min(1).max(2000),
});
export type ChatQueryInput = z.infer<typeof chatQuerySchema>;

/**
 * LOTE B3 · Clasificación de la pregunta (ver `intent-classifier.util.ts`).
 * `historical` es el flujo previo a este cambio (nl2sql normal) — se incluye
 * explícitamente en toda respuesta nueva para que el frontend (F2b) pueda
 * distinguir "tabla de resultados" de "proyección"/"rechazo" sin adivinar por
 * `columns.length === 0`.
 */
export const chatQueryKindSchema = z.enum([
  'historical',
  'future',
  'out_of_domain',
  'ambiguous',
]);
export type ChatQueryKind = z.infer<typeof chatQueryKindSchema>;

/** Rango de fechas (Lima) que el usuario preguntó, ya resuelto a fechas concretas. */
export const chatDateRangeSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  /** Etiqueta en español lista para mostrar (p. ej. "este fin de semana"). */
  label: z.string(),
});
export type ChatDateRange = z.infer<typeof chatDateRangeSchema>;

/**
 * QA-23 (LOTE B5) · Estimación de ingresos (S/) DERIVADA de las unidades
 * pronosticadas (`totalYhat`/`totalLo`/`totalHi`, que están en UNIDADES —
 * platos vendidos, ver `unitLabel`) × el ticket promedio por plato de los
 * últimos `basisDays` días de `sales_history`. Es una CONVERSIÓN declarada,
 * no una serie de ingresos pronosticada de forma independiente — el bug
 * original (QA-23) fue re-etiquetar unidades como si ya fueran soles.
 */
export const chatEstimatedRevenueSchema = z.object({
  total: z.number(),
  lo: z.number(),
  hi: z.number(),
  /** Ticket promedio por plato (S/) usado para la derivación. */
  avgUnitPrice: z.number(),
  /** Ventana (días) de `sales_history` de la que salió `avgUnitPrice`. */
  basisDays: z.number().int(),
});
export type ChatEstimatedRevenue = z.infer<typeof chatEstimatedRevenueSchema>;

/**
 * LOTE B3 · Metadata estructurada de una respuesta `kind: 'future'` — la
 * misma info que ya narra `answer` en texto plano, pero en forma consumible
 * por el frontend (badges/gráfico) sin tener que parsear el string. Viaja
 * SOLO cuando `kind === 'future'` y SÍ hubo una corrida completada con datos
 * en el rango pedido (si `needsForecast`/fuera de horizonte, no hay `forecast`
 * — el mensaje explicativo va en `answer`).
 */
export const chatForecastMetaSchema = z.object({
  /** Corrida (`ForecastRun`) de la que salen los puntos — para trazabilidad/auditoría. */
  runId: z.string().uuid(),
  range: chatDateRangeSchema,
  /**
   * QA-23 · Suma de `yhat`/`yhat_lo`/`yhat_hi` de los puntos dentro del
   * rango. UNIDADES (platos vendidos), NO soles — ver `unitLabel`. Antes de
   * este fix el `answer` los formateaba con prefijo "S/", que era el bug.
   */
  totalYhat: z.number(),
  totalLo: z.number(),
  totalHi: z.number(),
  /** QA-23 · Etiqueta de la unidad real de `totalYhat`/`totalLo`/`totalHi` (siempre "platos" para `scope: 'total'`). */
  unitLabel: z.string(),
  /** QA-23 · Estimación de ingresos DERIVADA; `null` sin ventas recientes para calcular el ticket promedio (ver `chatEstimatedRevenueSchema`). */
  estimatedRevenue: chatEstimatedRevenueSchema.nullable(),
  /** Puntos día-a-día dentro del rango (para un gráfico, si el frontend lo quiere). */
  points: z.array(forecastPointSchema),
  /** Factores exógenos (feriados/quincena/clima) dentro del mismo rango. */
  drivers: z.array(forecastDriverSchema),
});
export type ChatForecastMeta = z.infer<typeof chatForecastMetaSchema>;

/** Respuesta del endpoint (dentro del sobre ApiResponse<T>). */
export const chatQueryResponseSchema = z.object({
  /** Respuesta humanizada en lenguaje natural (o mensaje genérico de fallback). */
  answer: z.string(),
  /** SQL ejecutado (post-validación, con LIMIT garantizado). Vacío cuando no se generó SQL (future/out_of_domain/ambiguous). */
  sql: z.string(),
  /** Nombres de columnas del resultado. Vacío cuando no se generó SQL. */
  columns: z.array(z.string()),
  /** Filas del resultado (valores serializables a JSON). Vacío cuando no se generó SQL. */
  rows: z.array(z.array(z.unknown())),
  /** Proveedor LLM que generó el SQL (openai | anthropic | xai | mock), o "system" cuando la respuesta no vino de un LLM. */
  provider: z.string(),
  /** Modelo LLM usado, o un identificador interno (e.g. "intent-classifier", "forecast-run") cuando no hubo LLM. */
  model: z.string(),
  /** ADITIVO (LOTE B3) · clasificación de la pregunta. Ausente en respuestas de versiones previas. */
  kind: chatQueryKindSchema.optional(),
  /** ADITIVO (LOTE B3) · solo presente en respuestas `kind: 'future'` con datos disponibles. */
  forecast: chatForecastMetaSchema.optional(),
});
export type ChatQueryResponse = z.infer<typeof chatQueryResponseSchema>;

// ---------------------------------------------------------------------------
// Contratos internos: NestJS → core-ai (snake_case, formato Python)
// ---------------------------------------------------------------------------

/** Body de `POST /chat/nl2sql` en core-ai. */
export const coreAiNl2SqlRequestSchema = z.object({
  question: z.string(),
  schema_context: z.string(),
  dialect: z.literal('postgresql'),
  max_rows: z.number().int().positive(),
});
export type CoreAiNl2SqlRequest = z.infer<typeof coreAiNl2SqlRequestSchema>;

/** Respuesta de `POST /chat/nl2sql` de core-ai. */
export const coreAiNl2SqlResponseSchema = z.object({
  sql: z.string(),
  provider: z.string(),
  model: z.string(),
  notes: z.string().optional(),
});
export type CoreAiNl2SqlResponse = z.infer<typeof coreAiNl2SqlResponseSchema>;

/** Body de `POST /chat/answer` en core-ai. */
export const coreAiAnswerRequestSchema = z.object({
  question: z.string(),
  columns: z.array(z.string()),
  rows: z.array(z.array(z.unknown())),
  provider: z.string().optional(),
});
export type CoreAiAnswerRequest = z.infer<typeof coreAiAnswerRequestSchema>;

/** Respuesta de `POST /chat/answer` de core-ai. */
export const coreAiAnswerResponseSchema = z.object({
  answer: z.string(),
  provider: z.string(),
});
export type CoreAiAnswerResponse = z.infer<typeof coreAiAnswerResponseSchema>;
