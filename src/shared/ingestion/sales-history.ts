import { z } from 'zod';

/**
 * E11 · HU-11-03/04/05 — Importación de histórico de ventas por CSV.
 *
 * El cliente/BFF lee el archivo CSV/Excel y envía su texto crudo en `content`
 * (cabecera + filas); el servidor parsea, valida e importa (espeja HU-02-02).
 * `dryRun=true` ejecuta solo la pre-validación (HU-11-05: "validar antes de
 * importar") y NO escribe nada, devolviendo el mismo reporte con `created=0`.
 */
export const importSalesHistorySchema = z.object({
  content: z.string().min(1),
  dryRun: z.boolean().optional(),
});
export type ImportSalesHistoryInput = z.infer<typeof importSalesHistorySchema>;

/**
 * HU-11-03 · Query de la lista/agregado del histórico en una ventana `?from=&to=`
 * (ISO 8601, opcionales; el servicio valida `from <= to`). Sirve para verificar la
 * importación y, a futuro, alimentar reportes/forecasting (cold-start).
 */
export const salesHistoryQuerySchema = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
export type SalesHistoryQueryInput = z.infer<typeof salesHistoryQuerySchema>;
