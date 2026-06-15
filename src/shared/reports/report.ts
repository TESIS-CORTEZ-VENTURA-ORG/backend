import { z } from 'zod';

/**
 * E07 · Contrato de los reportes/dashboards (read-only). Las fechas del query son
 * ISO 8601 (`?from=&to=`); si se omiten, el servicio usa la ventana de "hoy"
 * (00:00..ahora) en la zona del tenant (America/Lima). Toda la moneda viaja como
 * string `.toFixed(2)` (PEN). No hay tablas nuevas: todo agrega ventas emitidas.
 */

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

// HU-07-04 · Query del reporte de ventas: ventana + agrupación (default `day`).
export const salesReportQuerySchema = reportWindowQuerySchema.extend({
  groupBy: salesGroupBySchema.optional(),
});
export type SalesReportQueryInput = z.infer<typeof salesReportQuerySchema>;
