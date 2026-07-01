# HU-08-06 · Sugerencias de compra basadas en el pronóstico de demanda

**Módulo:** `forecasting` | **Sprint:** S4 | **MoSCoW:** MUST  
**Endpoint:** `GET /api/forecasting/shopping-suggestions?horizon=<n>`  
**CASL:** `read Report`  
**Fuente de verdad:** pronóstico completado (`ForecastRun.scope='total', status='completed'`) + BOM (`recipe_items`) + stock actual (`ingredients.stock`).

---

## Problema

El responsable del restaurante necesita saber, antes de hacer una compra, qué insumos le van a faltar en los próximos N días según el pronóstico de demanda ya calculado. Hoy esto se hace manualmente y con frecuencia genera desabastecimiento o compras excesivas.

## Solución

Tomar la última corrida completada de forecasting (`scope=total`, `horizon=N días`) y, a través del BOM de cada plato, calcular el consumo previsto por insumo. Compararlo con el stock actual y devolver los insumos con déficit proyectado.

---

## Requisitos (EARS)

- **R1.** El sistema DEBE tomar la corrida más reciente con `status='completed'` y `scope='total'` del tenant.
- **R2.** El sistema DEBE sumar `yhat` de los puntos del pronóstico comprendidos en el horizonte solicitado.
- **R3.** El sistema DEBE explotar el BOM de cada receta activa (incluyendo sub-recetas hasta nivel 2) para calcular consumo por insumo: `Σ (dishForecastQty × itemQty × (1 + wasteFactor))`.
- **R4.** El sistema DEBE devolver solo los insumos donde `forecastConsumption > currentStock` (shortfall > 0).
- **R5.** Si no existe ninguna corrida completada, el sistema DEBE devolver `{ needsForecast: true, suggestions: [] }` en lugar de un error.
- **R6.** El endpoint DEBE estar protegido con CASL `read Report`; el rol `staff` recibe 403.

---

## Escenarios Gherkin

```gherkin
Feature: Sugerencias de compra basadas en pronóstico

  Scenario: Devuelve insumos en déficit cuando existe un pronóstico completado
    Given existe una corrida completada scope=total con puntos de demanda
    And el BOM de los platos usa los insumos A y B
    And el stock de A es insuficiente para el horizonte
    When el owner llama GET /api/forecasting/shopping-suggestions?horizon=14
    Then responde 200 con success=true
    And la lista incluye el insumo A con shortfall > 0
    And la lista NO incluye el insumo B si tiene stock suficiente

  Scenario: Devuelve needsForecast cuando no hay corrida completada
    Given no existe ninguna corrida completada para el tenant
    When el owner llama GET /api/forecasting/shopping-suggestions?horizon=14
    Then responde 200 con needsForecast=true y suggestions=[]

  Scenario: Staff recibe 403
    When un usuario staff llama GET /api/forecasting/shopping-suggestions
    Then responde 403
```

---

## Contrato de respuesta (Zod en `packages/shared`)

```ts
ShoppingSuggestionsResponse = {
  horizon: number;
  source: 'forecast';
  runId: string | null;
  needsForecast: boolean;
  suggestions: {
    ingredientId: string;
    name: string;
    unit: string;
    currentStock: string;       // Decimal serializado
    forecastConsumption: string; // Decimal serializado
    shortfall: string;           // forecastConsumption - currentStock
    suggestedQty: string;        // = shortfall (simplificado)
  }[];
}
```

---

## Trazabilidad

| Requisito      | Test                                                    |
| -------------- | ------------------------------------------------------- |
| R1, R2, R3, R4 | `test/shopping-suggestions.e2e-spec.ts` — happy path    |
| R5             | `test/shopping-suggestions.e2e-spec.ts` — needsForecast |
| R6             | `test/shopping-suggestions.e2e-spec.ts` — CASL 403      |
