import { z } from 'zod';

/**
 * HU-03-13 · Contrato de sugerencias de upsell en una orden (E03/POS).
 *
 * Calcula los platos más vendidos (últimos 30 días, por qty en order_items)
 * que NO estén ya en la orden y estén activos en el menú. Permite al mesero
 * sugerir adicionales al cliente, incrementando el ticket promedio.
 *
 * `price` es Decimal serializado (PEN). `timesSold` = qty total en el período.
 */

/** Query params de `GET /orders/:id/suggestions`. */
export const upsellQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(10).default(3),
});
export type UpsellQuery = z.infer<typeof upsellQuerySchema>;

/** Un plato sugerido como upsell. */
export const upsellSuggestionSchema = z.object({
  menuItemId: z.string().uuid(),
  name: z.string(),
  /** Precio de venta en PEN (Decimal serializado). */
  price: z.string(),
  /** Unidades vendidas en los últimos 30 días en el tenant. */
  timesSold: z.number().int().nonnegative(),
});
export type UpsellSuggestion = z.infer<typeof upsellSuggestionSchema>;

/** Respuesta: lista de platos sugeridos, de mayor a menor popularidad. */
export const upsellSuggestionsResponseSchema = z.array(upsellSuggestionSchema);
export type UpsellSuggestionsResponse = z.infer<
  typeof upsellSuggestionsResponseSchema
>;
