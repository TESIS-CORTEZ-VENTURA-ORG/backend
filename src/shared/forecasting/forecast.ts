import { z } from 'zod';

/**
 * E08 · Contrato del seam de forecasting. La serie de demanda agregada que
 * produce el backend (a partir de `sales_history`) es exactamente la entrada que
 * consume el microservicio `core-ai` (`POST /forecast/run`, body `history:[{ds,y}]`,
 * `frequency:"D"`). Este es el único punto donde el histórico de ventas se
 * transforma en una serie temporal lista para inferir.
 *
 * Ámbito (`scope`):
 *  - `total`    → una sola serie con la demanda diaria agregada de todo el menú.
 *  - `menuItem` → la serie diaria de un plato concreto (`menuItemId` requerido).
 *
 * `from`/`to` son opcionales; por defecto se usa TODO el histórico disponible
 * (forecasting quiere la mayor ventana posible, a diferencia de los reportes que
 * default-ean a "hoy").
 */
export const demandSeriesScopeSchema = z.enum(['total', 'menuItem']);
export type DemandSeriesScope = z.infer<typeof demandSeriesScopeSchema>;

export const demandSeriesQuerySchema = z
  .object({
    scope: demandSeriesScopeSchema.default('total'),
    menuItemId: z.uuid().optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((q) => q.scope !== 'menuItem' || q.menuItemId !== undefined, {
    message: 'menuItemId es requerido cuando scope=menuItem',
    path: ['menuItemId'],
  });
export type DemandSeriesQueryInput = z.infer<typeof demandSeriesQuerySchema>;
