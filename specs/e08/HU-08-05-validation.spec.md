# HU-08-05 — Comparar predicho vs real (validación + MAPE)

> **Épica:** E08 (Motor de Forecasting con IA) · **Sprint:** S5 · **Should** · **Estado:** 🟢 hecho (validación por día + MAPE acumulado + cobertura del intervalo). El gráfico overlay es frontend.

Cierra el ciclo de calidad del modelo: compara el último pronóstico **completado** contra la demanda **real** (de `sales_history`), por día y agregado. Da al gerente confianza cuantitativa (criterio de tesis).

## Alcance del incremento

**Construido:**

- **`GET /forecasting/validation?scope=&menuItemId=`** — toma la corrida `completed` más reciente del ámbito y la compara contra el real. `read Report` (owner/manager; staff → 403). 404 si no hay corrida.
- **Por día** (`rows`): `predicho (yhat)` vs `actual`, `errorPct` (APE = `|real − yhat| / real`), `inInterval` (real ∈ `[yhat_lo, yhat_hi]`), `status` (`compared` | `pending`).
- **Resumen** (`summary`): `comparedDays`, **`mape`** (promedio de los APE de días con real > 0), `intervalCoveragePct` (% de días comparados con el real dentro del intervalo q10–q90).
- **Solo días transcurridos**: un día se compara si `target_date <= último día con ventas` del ámbito (proxy determinista de "ya pasó"); los futuros quedan `pending`. Días transcurridos sin ventas cuentan como `0`.

**Diferido:** gráfico overlay (frontend); validación de una corrida específica por id (hoy se valida la última completada).

## HU-08-05 (Gherkin cubierto)

```gherkin
GIVEN un forecast pasado y ventas reales
WHEN el gerente abre "Validación"
THEN ve por día: predicho vs real, error % y MAPE acumulado
AND ve si el real cae dentro del intervalo q10–q90
```

## Diseño

- **Util pura** `forecast-validation.util.ts` (`compareForecastVsActual(points, actualByDay)`) → testeable sin DB: arma las filas, omite del MAPE los días con real 0 (no se puede dividir), calcula cobertura.
- El servicio (`validateLatest`) lee la corrida vía `runInTenant` (RLS FORCE), agrega el real por día (Lima, mismo `dailyTotals` que el seam — reutilizado), determina el último día con datos (`maxActualDay`) y arma `actualByDay` solo con días transcurridos.
- `tenant_id` SIEMPRE del JWT; nunca se filtra en la app (RLS).

## Tests

- **Unit** — `src/forecasting/forecast-validation.util.spec.ts` (4): error %/intervalo/MAPE; días `pending`; real 0 no rompe el MAPE; sin puntos.
- **e2e** — `test/forecast-validation.e2e-spec.ts` (3, requiere DB): siembra una corrida completada (3 puntos) + ventas reales (08-01=11, 09-01=25) y verifica `errorPct` (9.09 / 20), `inInterval` (✓/✗), día 2099 `pending`, **MAPE 14.55** y cobertura **50%**; staff → 403; sin corrida → 404.
- Suites completas: **68 unit + 192 e2e** verdes (sin regresiones).
