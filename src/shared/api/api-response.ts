import { z, type ZodType } from 'zod';

/**
 * Sobre de respuesta compartido con el frontend (frontend_context.md §6,
 * backend.md §7). Fuente de verdad del contrato REST. Mantener IDÉNTICO a
 * `frontend/shared/types/api.ts` hasta unificar en `packages/shared` (monorepo).
 */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
  meta?: { totalCount: number; page: number };
}

/** Metadatos de paginación del envelope. */
export interface ApiMeta {
  totalCount: number;
  page: number;
}

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export const apiMetaSchema = z.object({
  totalCount: z.number().int().nonnegative(),
  page: z.number().int().nonnegative(),
});

/** Builder de envelope de éxito. `meta` se omite si no se provee (R2). */
export function ok<T>(data: T, meta?: ApiMeta): ApiResponse<T> {
  return meta ? { success: true, data, meta } : { success: true, data };
}

/**
 * Factory de schema Zod que valida un envelope con un `data` tipado (R3).
 * Útil en tests de contrato y para validar respuestas de servicios externos.
 */
export function apiResponseSchema<T extends ZodType>(data: T) {
  return z.object({
    success: z.boolean(),
    data,
    error: apiErrorSchema.optional(),
    meta: apiMetaSchema.optional(),
  });
}
