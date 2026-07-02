import { z } from 'zod';

/**
 * HU-05-11 · Contrato de cobertura de stock por consumo real (E05).
 *
 * `avgDailyConsumption` = promedio de movimientos type='sale' últimos 30 días.
 * `daysLeft` es null cuando no hay consumo (cobertura teóricamente indefinida).
 * Ambos campos son Decimal-precisos (strings), nunca floats.
 *
 * Lote B4 (vida útil de insumos, MVP SIN modelo de lotes) — EXTIENDE este
 * mismo endpoint/schema en vez de crear uno nuevo: son la misma pregunta de
 * negocio ("¿cuánto me dura el stock?"), los campos nuevos son aditivos
 * (Zod los agrega sin romper consumidores que ya leían `daysLeft`), y separar
 * en dos llamadas obligaría al frontend a combinar dos respuestas para
 * mostrar UN solo número (`effectiveCoverageDays`). Regla central: la
 * cobertura EFECTIVA = min(cobertura por consumo, vida útil restante) — el
 * cuello de botella real, NUNCA un promedio (ver `ingredient-freshness.util.ts`).
 * Fecha de referencia de frescura (MVP sin lotes): fecha del ÚLTIMO
 * movimiento `purchase` del insumo en el kardex — sin lotes no existe una
 * fecha de recepción por unidad física, así que se asume que TODO el stock
 * on-hand entró con la última compra (simplificación explícita del MVP; FEFO
 * real con lotes queda como trabajo futuro).
 */
export const freshnessStatusSchema = z.enum([
  'fresh',
  'expiring_soon',
  'expired',
]);
export type FreshnessStatus = z.infer<typeof freshnessStatusSchema>;

export const ingredientCoverageResponseSchema = z.object({
  ingredientId: z.string().uuid(),
  /** Stock on-hand actual (Decimal serializado). */
  currentStock: z.string(),
  /** Consumo diario promedio en los últimos 30 días (Decimal serializado). */
  avgDailyConsumption: z.string(),
  /** Siempre 30 (ventana fija de análisis). */
  basedOnDays: z.literal(30),
  /** Días estimados de cobertura por consumo; null si avgDailyConsumption = 0. */
  daysLeft: z.string().nullable(),
  /** Vida útil configurada del insumo (días). `null` = no perecible / sin configurar. */
  shelfLifeDays: z.number().int().positive().nullable(),
  /** Fecha ISO del último movimiento `purchase` en el kardex; `null` si nunca se compró. */
  lastPurchaseAt: z.string().nullable(),
  /** `lastPurchaseAt + shelfLifeDays` días (ISO); `null` si falta alguno de los dos. */
  estimatedExpiryAt: z.string().nullable(),
  /** Estado de frescura frente a `estimatedExpiryAt`; `null` sin datos suficientes. */
  freshnessStatus: freshnessStatusSchema.nullable(),
  /** min(daysLeft, días restantes de vida útil) — la cobertura real (cuello de botella). */
  effectiveCoverageDays: z.string().nullable(),
  /** Stock que NO se alcanza a consumir antes de `estimatedExpiryAt` (Decimal, unidad del insumo). */
  atRiskQty: z.string().nullable(),
  /** `atRiskQty · unitCost` (Decimal, S/). */
  atRiskCost: z.string().nullable(),
});
export type IngredientCoverageResponse = z.infer<
  typeof ingredientCoverageResponseSchema
>;
