import { z } from 'zod';

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

/** Respuesta del endpoint (dentro del sobre ApiResponse<T>). */
export const chatQueryResponseSchema = z.object({
  /** Respuesta humanizada en lenguaje natural (o mensaje genérico de fallback). */
  answer: z.string(),
  /** SQL ejecutado (post-validación, con LIMIT garantizado). */
  sql: z.string(),
  /** Nombres de columnas del resultado. */
  columns: z.array(z.string()),
  /** Filas del resultado (valores serializables a JSON). */
  rows: z.array(z.array(z.unknown())),
  /** Proveedor LLM que generó el SQL (openai | anthropic | xai | mock). */
  provider: z.string(),
  /** Modelo LLM usado (e.g. mock-v1, gpt-4o-mini, claude-haiku-4-5). */
  model: z.string(),
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
