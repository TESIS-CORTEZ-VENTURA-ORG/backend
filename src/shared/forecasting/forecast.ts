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
 * pero responden 501 hasta que se implemente su adapter. `ml` (HU-08-07, LightGBM
 * con features de calendario/clima) ya está implementado; `auto` solo lo prefiere
 * cuando la corrida pide contexto (`use_context`) y hay historia suficiente
 * (≥ 4 estaciones) — nunca se hardcodea desde NestJS (`ForecastingService`
 * siempre pide `engine: "auto"` para las corridas de negocio; core-ai decide).
 */
export const forecastEngineSchema = z.enum([
  'auto',
  'statsforecast',
  'seasonalnaive',
  'ml',
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
  /**
   * HU-08-07 · Mismo holdout, motor `ml`, SIN features de contexto — la
   * comparativa académica con/sin variables exógenas. Solo se calcula cuando
   * `use_context=true` y el motor resuelto fue `ml`; `null` en cualquier otro
   * caso. `optional` además de `nullable` porque el shape "legacy" (pre
   * HU-08-07) de `backtest` no incluye la clave — se normaliza a `null` al
   * mapear (`ForecastingService.toView`), nunca queda `undefined` en la vista.
   */
  model_smape_no_context: z.number().nullable().optional(),
});
export type BacktestMetrics = z.infer<typeof backtestMetricsSchema>;

/**
 * HU-08-07 · Tipo de factor exógeno detectado por core-ai dentro del
 * horizonte pronosticado. `weekend` no depende del calendario peruano; el
 * resto sí. `gastro_event` es el calendario gastronómico curado (no oficial).
 */
export const driverKindSchema = z.enum([
  'holiday',
  'gastro_event',
  'weather',
  'weekend',
]);
export type DriverKind = z.infer<typeof driverKindSchema>;

/**
 * HU-08-07 · Un factor narrable dentro del horizonte (p. ej. "Fiestas Patrias
 * en 12 días: +35% demanda proyectada"). `impact_pct` es el alza/baja
 * histórica promedio de ese evento vs. días equivalentes sin evento —
 * `null` cuando el historial enviado no tiene una ocurrencia previa (core-ai
 * NUNCA la adivina; ver `team-core-ai/README.md` §HU-08-07).
 */
export const forecastDriverSchema = z.object({
  date: z.iso.date(),
  kind: driverKindSchema,
  label: z.string(),
  impact_pct: z.number().nullable(),
});
export type ForecastDriver = z.infer<typeof forecastDriverSchema>;

/**
 * HU-08-07 · Estado del contexto exógeno de la corrida. `off` = no se pidió
 * contexto (nunca ocurre en corridas de negocio, que siempre piden
 * `use_context: true`); `calendar_only` = degradación elegante (Open-Meteo
 * caído/timeout, el calendario peruano igual aplica porque no depende de
 * red); `full` = calendario + clima resueltos.
 */
export const forecastContextStatusSchema = z.enum([
  'full',
  'calendar_only',
  'off',
]);
export type ForecastContextStatus = z.infer<typeof forecastContextStatusSchema>;

export const coreAiForecastResponseSchema = z.object({
  series_id: z.string(),
  engine: z.string(),
  model: z.string(),
  baseline: z.string(),
  frequency: z.string(),
  points: z.array(forecastPointSchema),
  backtest: backtestMetricsSchema.nullable(),
  // Siempre presentes en el shape de core-ai (`[]`/`"off"` por defecto) — el
  // `.default(...)` es solo defensa de borde si algún día se omiten.
  drivers: z.array(forecastDriverSchema).default([]),
  context_status: forecastContextStatusSchema.default('off'),
});
export type CoreAiForecastResponse = z.infer<
  typeof coreAiForecastResponseSchema
>;

/**
 * HU-08-07 (fase 2) · Respuesta de `GET /forecasting/insights` — resumen
 * narrable para el dashboard de gestión: próximos factores exógenos dentro
 * del horizonte de la última corrida `completed` (`scope=total`), el estado
 * del contexto y la mejora del backtest con/sin contexto. Mismo criterio que
 * `shoppingSuggestionsResponseSchema`: `needsForecast: true` (no 404) cuando
 * el tenant todavía no completó ninguna corrida — el dashboard debe poder
 * renderizar un estado vacío en vez de manejar un error.
 */
export const forecastInsightsBacktestSchema = z.object({
  modelSmape: z.number(),
  baselineSmape: z.number(),
  improvementPct: z.number(),
  /** `null` si la corrida no usó el motor `ml` (no hay comparativa con/sin contexto). */
  modelSmapeNoContext: z.number().nullable(),
  /**
   * Mejora relativa de `modelSmape` sobre `modelSmapeNoContext`
   * (`(sinContexto − conContexto) / sinContexto × 100`). `null` salvo que
   * `modelSmapeNoContext` esté disponible y sea > 0 — evita división por 0 y
   * evita "inventar" una mejora cuando no hay comparativa real.
   */
  contextImprovementPct: z.number().nullable(),
});
export type ForecastInsightsBacktest = z.infer<
  typeof forecastInsightsBacktestSchema
>;

export const forecastInsightsResponseSchema = z.object({
  runId: z.string().uuid().nullable(),
  status: forecastRunStatusSchema.nullable(),
  contextStatus: forecastContextStatusSchema.nullable(),
  horizon: z.number().int().nullable(),
  /** `completedAt` de la corrida usada (ISO), para que el frontend fechee el resumen. */
  generatedAt: z.iso.datetime().nullable(),
  /** Solo los drivers con `date >= hoy (Lima)` — nunca se narra un evento ya pasado. */
  upcomingDrivers: z.array(forecastDriverSchema),
  backtest: forecastInsightsBacktestSchema.nullable(),
  needsForecast: z.boolean(),
});
export type ForecastInsightsResponse = z.infer<
  typeof forecastInsightsResponseSchema
>;
