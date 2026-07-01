import { z } from 'zod';

/**
 * HU-05-11 · Contrato de cobertura de stock por consumo real (E05).
 *
 * `avgDailyConsumption` = promedio de movimientos type='sale' últimos 30 días.
 * `daysLeft` es null cuando no hay consumo (cobertura teóricamente indefinida).
 * Ambos campos son Decimal-precisos (strings), nunca floats.
 */
export const ingredientCoverageResponseSchema = z.object({
  ingredientId: z.string().uuid(),
  /** Stock on-hand actual (Decimal serializado). */
  currentStock: z.string(),
  /** Consumo diario promedio en los últimos 30 días (Decimal serializado). */
  avgDailyConsumption: z.string(),
  /** Siempre 30 (ventana fija de análisis). */
  basedOnDays: z.literal(30),
  /** Días estimados de cobertura; null si avgDailyConsumption = 0. */
  daysLeft: z.string().nullable(),
});
export type IngredientCoverageResponse = z.infer<
  typeof ingredientCoverageResponseSchema
>;
