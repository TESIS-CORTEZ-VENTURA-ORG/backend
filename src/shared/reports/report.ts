import { z } from 'zod';
import { periodSchema } from '../costing/costing';

/**
 * E07 · Contrato de los reportes/dashboards (read-only). Las fechas del query son
 * ISO 8601 (`?from=&to=`); si se omiten, el servicio usa la ventana de "hoy"
 * (00:00..ahora) en la zona del tenant (America/Lima). Toda la moneda viaja como
 * string `.toFixed(2)` (PEN). No hay tablas nuevas: todo agrega ventas emitidas.
 */

// HU-07-10 · Formato de salida de un reporte. `json` (default) = envelope ApiResponse;
// `csv` = descarga RFC-4180 (text/csv + Content-Disposition). PDF/Excel = futuro
// (requieren librería externa; documentado en la spec). Sin el param → json.
export const reportFormatSchema = z.enum(['json', 'csv']);
export type ReportFormat = z.infer<typeof reportFormatSchema>;

// Ventana de fechas opcional para dashboards/reportes. `from`/`to` son ISO; el
// servicio valida que `from <= to`. Vacío → ventana de hoy en la zona del tenant.
export const reportWindowQuerySchema = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
export type ReportWindowQueryInput = z.infer<typeof reportWindowQuerySchema>;

// HU-07-04 · Agrupación de la serie del reporte de ventas.
export const salesGroupBySchema = z.enum(['day', 'method', 'docType']);
export type SalesGroupBy = z.infer<typeof salesGroupBySchema>;

// HU-07-04/10 · Query del reporte de ventas: ventana + agrupación (default `day`)
// + formato de exportación opcional (`?format=csv`).
export const salesReportQuerySchema = reportWindowQuerySchema.extend({
  groupBy: salesGroupBySchema.optional(),
  format: reportFormatSchema.optional(),
});
export type SalesReportQueryInput = z.infer<typeof salesReportQuerySchema>;

// HU-07-05/10 · Query del reporte de inventario: solo formato de exportación
// (la valoración es del stock actual; sin ventana — ver spec).
export const inventoryReportQuerySchema = z.object({
  format: reportFormatSchema.optional(),
});
export type InventoryReportQueryInput = z.infer<
  typeof inventoryReportQuerySchema
>;

// HU-07-06/10 · Query del reporte de food cost: período obligatorio (YYYY-MM) +
// formato de exportación opcional.
export const foodCostReportQuerySchema = z.object({
  period: periodSchema,
  format: reportFormatSchema.optional(),
});
export type FoodCostReportQueryInput = z.infer<
  typeof foodCostReportQuerySchema
>;

// HU-07-07/10 · Query del reporte de mermas: ventana `?from=&to=` + formato.
export const wasteReportQuerySchema = reportWindowQuerySchema.extend({
  format: reportFormatSchema.optional(),
});
export type WasteReportQueryInput = z.infer<typeof wasteReportQuerySchema>;
