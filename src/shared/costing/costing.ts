import { z } from 'zod';

// E06 · Período de costeo en formato `YYYY-MM` (mes calendario). Es la clave para
// registrar CIF (HU-06-02) y para prorratearlos sobre las ventas del mes (HU-06-03).
export const periodSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'El período debe tener formato YYYY-MM');
export type Period = z.infer<typeof periodSchema>;

// HU-06-02 · Costo indirecto (CIF) mensual. `concept` = nombre del gasto
// (alquiler, sueldos, servicios…); `amount` = monto del mes (PEN). El `period`
// agrupa los CIF que se prorratean juntos. `tenant_id` viene del JWT (no del body).
export const createOverheadCostSchema = z.object({
  period: periodSchema,
  concept: z.string().min(1),
  amount: z.number().positive(),
});
export type CreateOverheadCostInput = z.infer<typeof createOverheadCostSchema>;

// HU-06-02 · Actualización parcial de un CIF. El `period` puede cambiar (reasignar
// un gasto a otro mes). Al menos un campo presente.
export const updateOverheadCostSchema = z
  .object({
    period: periodSchema.optional(),
    concept: z.string().min(1).optional(),
    amount: z.number().positive().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Debe enviar al menos un campo a actualizar',
  });
export type UpdateOverheadCostInput = z.infer<typeof updateOverheadCostSchema>;

// HU-06-02 · Filtro opcional del listado de CIF por período (query `?period=`).
export const overheadCostQuerySchema = z.object({
  period: periodSchema.optional(),
});
export type OverheadCostQueryInput = z.infer<typeof overheadCostQuerySchema>;

// HU-06-01/03/04 · Query del costeo de platos: el período es OBLIGATORIO.
export const costingDishesQuerySchema = z.object({
  period: periodSchema,
});
export type CostingDishesQueryInput = z.infer<typeof costingDishesQuerySchema>;

// HU-06-05 · Query de la sugerencia de precio. `targetMarginPct` llega como string
// en el query → se coacciona a número y se acota a [0, 99].
export const suggestPriceQuerySchema = z.object({
  menuItemId: z.uuid(),
  targetMarginPct: z.coerce.number().min(0).max(99),
  period: periodSchema,
});
export type SuggestPriceQueryInput = z.infer<typeof suggestPriceQuerySchema>;

// HU-06-06 · Body del cierre de período mensual. El cierre fija las cifras finales
// del mes y guarda el reporte de platos como snapshot inmutable (un cierre por mes).
export const closePeriodSchema = z.object({
  period: periodSchema,
});
export type ClosePeriodInput = z.infer<typeof closePeriodSchema>;

// HU-06-07 · Query del comparativo costo real vs teórico (período obligatorio).
export const costVarianceQuerySchema = z.object({
  period: periodSchema,
});
export type CostVarianceQueryInput = z.infer<typeof costVarianceQuerySchema>;
