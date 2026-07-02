# HU-08-07 · Variables exógenas peruanas (contexto: calendario + clima) — fase 2/3

**Módulo:** `forecasting` | **Sprint:** S4 | **MoSCoW:** MUST
**Endpoints tocados:** `POST /api/forecasting/run` (plumbing interno, sin cambio de contrato de entrada), `GET /api/forecasting/predictions`, `GET /api/forecasting/shopping-suggestions?horizon=<n>` (campos nuevos), `GET /api/forecasting/insights` (**nuevo**)
**CASL:** `read Report` (insights, predictions, shopping-suggestions) / `manage Report` (run) — staff → 403 en todos.
**Fuente de verdad:** `team-core-ai/README.md` §"Exogenous context — HU-08-07" (contrato ya desplegado en `gastronomia-core-ai`, fase 1/3). Esta spec cubre la **fase 2/3**: NestJS activa el contexto y expone lo que core-ai ya calcula.

---

## Problema

`core-ai` ya sabe enriquecer el pronóstico con calendario peruano (feriados oficiales + calendario gastronómico curado) y clima de Lima (Open-Meteo), y con eso puede entrenar un motor `ml` (LightGBM) que compite contra el baseline estadístico. Pero el backend NestJS todavía llama a `POST /forecast/run` sin pedir ese contexto (`use_context` nunca se envía) y no persiste ni expone lo que core-ai ya sabe devolver (`drivers`, `context_status`, `backtest.model_smape_no_context`). El resultado: el pronóstico es más preciso en core-ai, pero el negocio (lista de compras, dashboard) no se entera de POR QUÉ cambia la demanda proyectada.

## Solución

1. Toda corrida de negocio (manual `POST /run` y el cron semanal HU-08-03) pide contexto a core-ai: `use_context: true`, `engine: "auto"` (NUNCA se hardcodea `"ml"` — core-ai decide si aplica según la historia disponible; con poca historia degrada solo a `statsforecast`, sin romper el calendario).
2. `location` viaja con las coordenadas del tenant si existen (`Tenant.latitude/longitude`, plumbing nuevo, sin UI); si no, se omite y core-ai aplica su propio default (Lima).
3. Se persisten `drivers` y `context_status` junto a la corrida (`forecast_runs.drivers`, `forecast_runs.context_status` — migración aditiva, columnas nullable).
4. `shopping-suggestions` devuelve además los `drivers` acotados a la ventana de días realmente proyectada y el `context_status` de la corrida usada, para narrar el shortfall ("Fiestas Patrias en 12 días: +35%").
5. Nuevo `GET /forecasting/insights`: resumen narrable para el dashboard — próximos eventos del horizonte con impacto, estado del contexto y la comparativa de backtest con/sin contexto (`improvement_pct`, `model_smape_no_context`, mejora relativa derivada).

---

## Requisitos (EARS)

- **R1.** El sistema DEBE pedir `use_context: true` a core-ai en toda corrida de negocio (manual y cron), sin excepción y sin exponerlo como opción del cliente.
- **R2.** El sistema DEBE pedir `engine: "auto"` por defecto (nunca `"ml"` hardcodeado); el llamador puede forzar otro motor explícito vía `input.engine`, pero el default de negocio es `auto`.
- **R3.** El sistema DEBE enviar `location` con las coordenadas del tenant cuando `Tenant.latitude`/`longitude` no son `null`; en caso contrario DEBE omitir `location` (core-ai aplica su default Lima).
- **R4.** El sistema DEBE persistir `drivers` y `context_status` de la respuesta de core-ai en la corrida (`ForecastRun`), incluso cuando `drivers` viene vacío.
- **R5.** El sistema DEBE seguir aceptando y sirviendo corridas creadas antes de esta migración (`drivers`/`context_status` en `NULL`) sin romper `GET /runs/:id`, `/predictions`, `/validation` — se proyectan como `[]`/`null`.
- **R6.** `GET /forecasting/shopping-suggestions` DEBE incluir `drivers` (acotados a la ventana de días efectivamente proyectada, no todo el horizonte original de la corrida) y `contextStatus` de la corrida usada.
- **R7.** `GET /forecasting/insights` DEBE devolver, para la última corrida `completed` (`scope=total`): los `drivers` con fecha ≥ hoy (Lima), el `contextStatus`, y la comparativa de backtest (`modelSmape`, `baselineSmape`, `improvementPct`, `modelSmapeNoContext`, `contextImprovementPct` derivado). Si no hay corrida completada, DEBE devolver `200` con `needsForecast: true` (no `404`).
- **R8.** `GET /forecasting/insights` DEBE estar protegido con CASL `read Report`; el rol `staff` recibe 403.
- **R9.** Si core-ai degrada a `context_status: "calendar_only"` (Open-Meteo caído), el sistema DEBE persistir y exponer ese estado tal cual — sin tratarlo como error (sigue siendo `200`/corrida `completed`).

---

## Escenarios Gherkin

```gherkin
Feature: Forecast contextual (calendario peruano + clima)

  Scenario: La corrida de negocio siempre pide contexto y motor "auto"
    Given un tenant con historial de ventas suficiente
    When se encola un forecast vía POST /api/forecasting/run
    Then la llamada a core-ai incluye use_context=true y engine="auto"
    And si el tenant no tiene coordenadas configuradas, la llamada NO incluye "location"

  Scenario: Los drivers y el estado de contexto se persisten con la corrida
    Given core-ai devuelve drivers=[...] y context_status="full" para la corrida
    When el worker completa la corrida
    Then GET /api/forecasting/runs/:id expone esos mismos drivers y contextStatus

  Scenario: Degradación elegante — clima caído, calendario sigue funcionando
    Given core-ai devuelve context_status="calendar_only" con drivers de calendario poblados
    When el worker completa la corrida
    Then la corrida queda status=completed (NO failed)
    And contextStatus="calendar_only" y los drivers de calendario siguen presentes

  Scenario: La lista de compras narra el porqué del shortfall
    Given existe una corrida completada con drivers dentro del horizonte proyectado
    When el owner llama GET /api/forecasting/shopping-suggestions?horizon=14
    Then la respuesta incluye drivers (acotados a esos 14 días) y contextStatus

  Scenario: Insights — resumen narrable para el dashboard
    Given existe una corrida completada con backtest.model_smape_no_context
    When el owner llama GET /api/forecasting/insights
    Then responde 200 con upcomingDrivers, contextStatus y backtest.contextImprovementPct

  Scenario: Insights sin corrida completada — needsForecast, no error
    Given el tenant no completó ninguna corrida
    When el owner llama GET /api/forecasting/insights
    Then responde 200 con needsForecast=true

  Scenario: Staff no accede a insights
    When un usuario staff llama GET /api/forecasting/insights
    Then responde 403

  Scenario: Corrida legacy (sin las claves nuevas) sigue sirviéndose
    Given una corrida fue creada antes de esta migración (drivers/context_status = NULL en BD)
    When se consulta GET /api/forecasting/predictions
    Then responde 200 con drivers=[] y contextStatus=null, sin romper el resto de la vista
```

---

## Contrato (Zod en `src/shared/forecasting`)

```ts
ForecastDriver = {
  date: string;        // YYYY-MM-DD
  kind: 'holiday' | 'gastro_event' | 'weather' | 'weekend';
  label: string;
  impact_pct: number | null; // null si no hay ocurrencia previa en el historial (core-ai nunca la adivina)
}

ForecastContextStatus = 'full' | 'calendar_only' | 'off';

// Extiende BacktestMetrics existente:
BacktestMetrics.model_smape_no_context: number | null; // solo con motor "ml" + use_context

// Extiende ForecastRunView existente:
ForecastRunView.drivers: ForecastDriver[];
ForecastRunView.contextStatus: ForecastContextStatus | null;

// Extiende ShoppingSuggestionsResponse existente:
ShoppingSuggestionsResponse.drivers: ForecastDriver[];
ShoppingSuggestionsResponse.contextStatus: ForecastContextStatus | null;

// Nuevo — GET /forecasting/insights:
ForecastInsightsResponse = {
  runId: string | null;
  status: 'running' | 'completed' | 'failed' | null;
  contextStatus: ForecastContextStatus | null;
  horizon: number | null;
  generatedAt: string | null; // ISO, completedAt de la corrida
  upcomingDrivers: ForecastDriver[]; // date >= hoy (Lima)
  backtest: {
    modelSmape: number;
    baselineSmape: number;
    improvementPct: number;
    modelSmapeNoContext: number | null;
    contextImprovementPct: number | null; // (sinContexto - conContexto) / sinContexto * 100
  } | null;
  needsForecast: boolean;
}
```

---

## Trazabilidad

| Requisito  | Test                                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| R1, R2, R3 | `test/forecast-context.e2e-spec.ts` — "pide use_context/engine/location"                                                      |
| R4, R5     | `test/forecast-context.e2e-spec.ts` — "persiste drivers/contextStatus" + `test/forecast-async.e2e-spec.ts` (regresión legacy) |
| R6         | `test/forecast-context.e2e-spec.ts` — "shopping-suggestions expone drivers"                                                   |
| R7, R8     | `test/forecast-context.e2e-spec.ts` — "insights" (happy path + needsForecast + 403 staff)                                     |
| R9         | `test/forecast-context.e2e-spec.ts` — "degradación calendar_only"                                                             |
