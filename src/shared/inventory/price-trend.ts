import { z } from 'zod';

/**
 * HU-05-12 · Contrato del historial de precio de un insumo (E05).
 *
 * Se alimenta automáticamente al recepcionar una OC (source='purchase_order')
 * y permite a los gestores detectar tendencias inflacionarias por insumo.
 * La tabla subyacente (`ingredient_price_history`) tiene RLS FORCE por tenant.
 */

/** Fuentes válidas de un registro de precio. */
export const priceHistorySourceSchema = z.enum([
  'purchase_order',
  'manual',
] as const);
export type PriceHistorySource = z.infer<typeof priceHistorySourceSchema>;

/** Un punto del historial de precios. */
export const priceTrendItemSchema = z.object({
  /** Fecha/hora en que se registró el precio (ISO 8601 con zona). */
  recordedAt: z.string().datetime({ offset: true }),
  /** Costo unitario en PEN (Decimal serializado con 2 decimales). */
  unitCost: z.string(),
  source: priceHistorySourceSchema,
});
export type PriceTrendItem = z.infer<typeof priceTrendItemSchema>;

/** Query params de `GET /inventory/ingredients/:id/price-trend`. */
export const priceTrendQuerySchema = z.object({
  /** Número máximo de registros a devolver (default 12, max 50). */
  limit: z.coerce.number().int().positive().max(50).default(12),
});
export type PriceTrendQuery = z.infer<typeof priceTrendQuerySchema>;

/** Respuesta: lista de puntos en orden descendente de fecha. */
export const priceTrendResponseSchema = z.array(priceTrendItemSchema);
export type PriceTrendResponse = z.infer<typeof priceTrendResponseSchema>;
