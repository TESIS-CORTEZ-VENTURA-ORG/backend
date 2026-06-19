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

/**
 * Motores de forecasting expuestos por `core-ai`. `auto` (default) elige el mejor
 * disponible y degrada al baseline; `timesfm`/`chronos` están cableados en core-ai
 * pero responden 501 hasta que se implemente su adapter.
 */
export const forecastEngineSchema = z.enum([
  'auto',
  'statsforecast',
  'seasonalnaive',
  'timesfm',
  'chronos',
]);
export type ForecastEngine = z.infer<typeof forecastEngineSchema>;

/**
 * Input de `POST /forecasting/run`: arma la serie (igual que el seam) y pide el
 * pronóstico a `core-ai`. `horizon` = nº de días a pronosticar (default 14).
 */
export const runForecastSchema = z
  .object({
    scope: demandSeriesScopeSchema.default('total'),
    menuItemId: z.uuid().optional(),
    horizon: z.number().int().positive().max(365).default(14),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    engine: forecastEngineSchema.optional(),
  })
  .refine((q) => q.scope !== 'menuItem' || q.menuItemId !== undefined, {
    message: 'menuItemId es requerido cuando scope=menuItem',
    path: ['menuItemId'],
  });
export type RunForecastInput = z.infer<typeof runForecastSchema>;

/** Estado de una corrida de forecasting (async). */
export const forecastRunStatusSchema = z.enum([
  'running',
  'completed',
  'failed',
]);
export type ForecastRunStatus = z.infer<typeof forecastRunStatusSchema>;

/** Query de `GET /forecasting/predictions`: últimas predicciones por ámbito. */
export const predictionsQuerySchema = z
  .object({
    scope: demandSeriesScopeSchema.default('total'),
    menuItemId: z.uuid().optional(),
  })
  .refine((q) => q.scope !== 'menuItem' || q.menuItemId !== undefined, {
    message: 'menuItemId es requerido cuando scope=menuItem',
    path: ['menuItemId'],
  });
export type PredictionsQueryInput = z.infer<typeof predictionsQuerySchema>;

/**
 * Mirror del contrato de respuesta de `core-ai` (`POST /forecast/run`). Zod es la
 * única fuente de verdad; Pydantic la espeja del lado Python. Se valida la
 * respuesta del microservicio antes de devolverla (defensa de borde).
 */
export const forecastPointSchema = z.object({
  target_date: z.iso.date(),
  yhat: z.number(),
  yhat_lo: z.number(),
  yhat_hi: z.number(),
});
export type ForecastPoint = z.infer<typeof forecastPointSchema>;

export const backtestMetricsSchema = z.object({
  holdout_size: z.number().int(),
  model_smape: z.number(),
  baseline_smape: z.number(),
  improvement_pct: z.number(),
});
export type BacktestMetrics = z.infer<typeof backtestMetricsSchema>;

export const coreAiForecastResponseSchema = z.object({
  series_id: z.string(),
  engine: z.string(),
  model: z.string(),
  baseline: z.string(),
  frequency: z.string(),
  points: z.array(forecastPointSchema),
  backtest: backtestMetricsSchema.nullable(),
});
export type CoreAiForecastResponse = z.infer<
  typeof coreAiForecastResponseSchema
>;
