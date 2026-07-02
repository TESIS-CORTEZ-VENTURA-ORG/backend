# HU-08-08 — Evaluación realizada del modelo (predicho vs. real, multi-corrida)

> **Épica:** E08 (Motor de Forecasting con IA) · **Sprint:** Lote B1 (post-E08/E10) · **Should** · **Estado:** 🟢 hecho. `HU-08-05-validation.spec.md` ya cubría MAPE/backtest de la ÚLTIMA corrida; este incremento agrega la vista "el sistema se autoevalúa" combinando TODAS las corridas completadas del ámbito.

## Motivo del incremento

`GET /forecasting/validation` (HU-08-05) responde con la corrida `completed` **más reciente** únicamente — útil para "¿qué tan bien predijo la última corrida?", pero no para "¿cómo viene funcionando el modelo en el tiempo?". `GET /forecasting/accuracy` cierra esa brecha: agrega TODAS las corridas completadas del ámbito y compara predicho vs. real día a día para las fechas ya transcurridas, dando una serie temporal + métricas acumuladas (SMAPE/MAPE realizados, cobertura del intervalo).

## Alcance del incremento

**Construido:**

- **`GET /forecasting/accuracy?scope=&menuItemId=`** — combina TODAS las corridas `completed` del ámbito (mismo query shape que `/predictions`/`/validation`). `read Report` (owner/manager; staff → 403).
- **Merge multi-corrida**: si dos corridas predijeron el mismo día (re-forecasts a lo largo del tiempo), gana la predicción de la corrida **MÁS RECIENTE** para ese día (se itera asc por `completedAt` y se sobreescribe el mapa) — es la que mejor refleja lo que el sistema mostraba en ese momento. `runsEvaluated` cuenta las corridas que aportaron al menos un día ya transcurrido.
- **Solo días transcurridos**: un `target_date` entra a `series` si `<= último día con ventas` del ámbito (mismo criterio que `/validation`, proxy determinista de "ya pasó").
- **Métricas**: `smapeRealized` (SMAPE — no se rompe con `actual=0`, principal), `mapeRealized` (MAPE clásico, para comparación con el estándar), `coveragePct` (% de días cuyo real cayó dentro de `[yhatLo, yhatHi]`), `points` (= `series.length`).
- **Nunca 404/500 por falta de datos**: 0 corridas, 0 corridas con días transcurridos, o pocos puntos (`< MIN_ACCURACY_POINTS = 3`) → 200 con `needsMoreData: true` (+ `message` explicando el motivo) y la serie parcial que haya.

**Diferido:** gráfico (frontend); accuracy por-plato agregada a nivel dashboard (hoy es por `scope`/`menuItemId`, igual que el resto de E08).

## Gherkin cubierto

```gherkin
GIVEN corridas de forecast pasadas cuyas fechas proyectadas ya transcurrieron
WHEN el gerente abre "Precisión del modelo"
THEN ve, por día, lo predicho vs. lo realmente vendido (con banda yhatLo/yhatHi)
AND ve SMAPE/MAPE realizados y la cobertura del intervalo
AND si hay pocos días transcurridos, ve un estado "reuniendo datos" (nunca un error)
```

## Diseño

- **Cero lógica duplicada**: reusa `dailyTotals`/`maxActualDay` (mismo seam que arma la historia para `core-ai`) y `compareForecastVsActual` (el mismo comparador puro de HU-08-05) — el único código nuevo es el merge multi-corrida (`Map<date, ForecastPointLike>` iterado asc) y el ensamblado de la respuesta.
- **SMAPE agregado a `forecast-validation.util.ts`**: `compareForecastVsActual` ahora también computa `smapePct` por fila y `summary.smape` — denominador = promedio de `|actual|` y `|yhat|`, por lo que (a diferencia del MAPE/APE) no se rompe cuando `actual = 0` (común en insumos/platos de baja rotación). Esto es **aditivo**: `GET /forecasting/validation` (HU-08-05) también expone `smape`/`smapePct` ahora, sin romper el contrato existente.
- `getAccuracy` (`ForecastingService`) vive en el mismo servicio, `runInTenant` (RLS FORCE); `tenant_id` SIEMPRE del JWT.

## Contrato Zod (`src/shared/forecasting/forecast-accuracy.ts`)

```ts
forecastAccuracyResponseSchema = {
  series: Array<{ date: string; predicted: number; actual: number; yhatLo: number; yhatHi: number }>,
  metrics: {
    smapeRealized: number | null;
    mapeRealized: number | null;
    coveragePct: number | null;
    points: number; // == series.length
  },
  runsEvaluated: number,
  needsMoreData: boolean,
  message?: string,
}
```

Reusa `predictionsQuerySchema` (`{ scope, menuItemId }`) — mismo shape que `/predictions`/`/validation`, sin duplicar el schema.

## Tests

- **Unit** — extensión de `forecast-validation.util.spec.ts` (+2): SMAPE con `actual=0` (no se rompe, a diferencia del APE), y el único caso indefinido (`actual=0` Y `yhat=0`).
- **e2e** — `test/forecast-accuracy.e2e-spec.ts` (4, requiere DB): 2 corridas completadas donde la más reciente re-predice 2 de los 3 días ya transcurridos (merge correcto, `runsEvaluated=2`); `mapeRealized`/`smapeRealized`/`coveragePct` verificados a mano; staff → 403; tenant con 1 solo día transcurrido → `needsMoreData:true` (200, serie parcial); tenant sin corridas → `needsMoreData:true` (200, serie vacía, nunca 404).
- **Verificación live**: en el tenant demo (`maria@motif.pe`), `sales_history` (cold-start import, E11) tiene su último día fijo (no se re-alimenta con las ventas POS del seed en vivo) — por diseño, ninguna corrida nueva tiene fechas "ya transcurridas" respecto a ese corte, así que el endpoint responde correctamente `needsMoreData:true` en el snapshot demo actual. Confirmado NO es un bug: es una propiedad de cómo se puebla `sales_history` (ver `specs/e11/HU-11-03-04-05-sales-history-import.spec.md`), documentada aquí para que el próximo incremento sepa que, para demostrar `accuracy` poblado en vivo, `sales_history` debe re-importarse con fechas que se solapen con el horizonte de una corrida completada.
