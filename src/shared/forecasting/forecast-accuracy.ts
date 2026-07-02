import { z } from 'zod';

/**
 * HU-08-08 · Contrato de `GET /forecasting/accuracy` — el sistema se
 * autoevalúa: para las corridas `completed` pasadas (mismo `scope`/`menuItemId`
 * que `GET /forecasting/predictions`), compara lo predicho contra la demanda
 * REAL de `sales_history` día a día (mismo seam que usa el resto de E08 — ver
 * `ForecastingService.dailyTotals`/`maxActualDay`; NO se duplica la agregación).
 *
 * A diferencia de `GET /forecasting/validation` (que solo mira la ÚLTIMA
 * corrida), `accuracy` combina TODAS las corridas `completed` del ámbito: si
 * varias corridas predijeron el mismo día (re-forecasts), gana la predicción de
 * la corrida MÁS RECIENTE para ese día — es la que mejor refleja qué hubiera
 * mostrado el sistema en ese momento. `runsEvaluated` cuenta las corridas que
 * aportaron al menos un día ya transcurrido.
 *
 * Nunca 404/500 por falta de datos: con pocos días transcurridos, la respuesta
 * es válida con lo que haya y `needsMoreData: true` (+ `message` explicando el
 * motivo), para que el dashboard muestre un estado "aún reuniendo datos" en vez
 * de un error.
 */

/** Un día ya transcurrido: lo predicho (con banda) vs. lo realmente vendido. */
export const forecastAccuracyPointSchema = z.object({
  date: z.iso.date(),
  predicted: z.number(),
  actual: z.number(),
  yhatLo: z.number(),
  yhatHi: z.number(),
});
export type ForecastAccuracyPoint = z.infer<typeof forecastAccuracyPointSchema>;

/**
 * Métricas agregadas sobre `series`. `smapeRealized`/`mapeRealized` son SMAPE y
 * MAPE reales (no el `backtest` académico de la corrida, que es holdout interno
 * de core-ai) — SMAPE no se rompe cuando el real es 0 (insumos/platos de baja
 * rotación), por eso es la métrica principal; MAPE se expone también por ser el
 * estándar más conocido. `coveragePct` = % de días cuyo real cayó dentro de la
 * banda [yhatLo, yhatHi] (calibración del intervalo). `points` = nº de días
 * comparados (== `series.length`).
 */
export const forecastAccuracyMetricsSchema = z.object({
  smapeRealized: z.number().nullable(),
  mapeRealized: z.number().nullable(),
  coveragePct: z.number().nullable(),
  points: z.number().int().nonnegative(),
});
export type ForecastAccuracyMetrics = z.infer<
  typeof forecastAccuracyMetricsSchema
>;

export const forecastAccuracyResponseSchema = z.object({
  series: z.array(forecastAccuracyPointSchema),
  metrics: forecastAccuracyMetricsSchema,
  /** Nº de corridas `completed` que aportaron al menos un día ya transcurrido. */
  runsEvaluated: z.number().int().nonnegative(),
  /**
   * `true` cuando hay muy pocos días transcurridos para que las métricas sean
   * representativas (umbral: `MIN_ACCURACY_POINTS` en `ForecastingService`) —
   * incluye el caso de 0 corridas o 0 días transcurridos.
   */
  needsMoreData: z.boolean(),
  /** Mensaje explicativo cuando `needsMoreData` (o sin corridas). Ausente si hay datos suficientes. */
  message: z.string().optional(),
});
export type ForecastAccuracyResponse = z.infer<
  typeof forecastAccuracyResponseSchema
>;
