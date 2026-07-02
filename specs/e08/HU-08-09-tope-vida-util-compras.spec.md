# HU-08-09 (Lote B4) · Tope de vida útil en la sugerencia de compra

**Módulo:** `forecasting` | **Sprint:** post-S4 (Lote B4) | **MoSCoW:** SHOULD
**Endpoint:** `GET /api/forecasting/shopping-suggestions?horizon=<n>` (EXTIENDE HU-08-06, mismo endpoint)
**CASL:** `read Report`
**Relacionado:** `HU-05-13-vida-util-insumos` (E05, cobertura efectiva con vida útil)

---

## Problema

`HU-08-06` sugiere comprar exactamente el `shortfall` (déficit proyectado en TODO el horizonte). Para un insumo perecible con vida útil corta (p. ej. pescado, 2-3 días) y un horizonte largo (p. ej. 14 días), esto sugiere comprar de más: parte de esa cantidad se va a vencer antes de poder usarse. No tiene sentido recomendar comprar más de lo que se alcanza a consumir antes de que el insumo se pierda.

## Solución

Topar `suggestedQty` de un insumo perecible (`shelfLifeDays` configurado) por lo que realmente se alcanza a consumir dentro de su vida útil: `min(shortfall, consumo proyectado en min(horizon, shelfLifeDays) − stock actual)`, nunca negativa. Insumos sin `shelfLifeDays` configurado mantienen el comportamiento actual intacto (`suggestedQty = shortfall`).

**Por qué no hace falta re-explotar el BOM por sub-ventana:** la demanda se reparte entre platos con una participación (`dishShare`) constante en el tiempo (últimos 30 días de ventas). Por eso el consumo proyectado de cualquier insumo es una función LINEAL de `totalForecast` (Σ `yhat` de la ventana usada) — basta escalar `forecastConsumption` por la fracción de demanda que cae dentro de la sub-ventana de vida útil. Resultado EXACTO, no una aproximación, dado el mismo modelo que ya usa `shoppingSuggestions`.

---

## Requisitos (EARS)

- **R1.** Para un insumo con `shelfLifeDays` configurado, el sistema DEBE topar `suggestedQty = max(0, min(shortfall, consumoProyectado(min(horizon, shelfLifeDays)) − currentStock))`.
- **R2.** Para un insumo SIN `shelfLifeDays` configurado (`null`), el sistema DEBE mantener `suggestedQty = shortfall` (comportamiento HU-08-06 intacto).
- **R3.** Cuando el tope reduce `suggestedQty` por debajo de `shortfall`, el sistema DEBE exponer `cappedByShelfLife: true` y `uncappedSuggestedQty` (= `shortfall`, sin topar) para que el frontend explique la diferencia.
- **R4.** Cuando NO se topa (sin `shelfLifeDays`, o `shelfLifeDays ≥ horizon`), el sistema DEBE exponer `cappedByShelfLife: false` y `uncappedSuggestedQty: null`.
- **R5.** El insumo sigue apareciendo en la lista de sugerencias mientras `shortfall > 0` (criterio HU-08-06 sin cambios) — el tope solo afecta `suggestedQty`, no el filtro de inclusión.
- **R6.** Los campos nuevos son ADITIVOS al contrato `ShoppingSuggestionItem` (no rompen consumidores existentes de `suggestedQty`/`shortfall`).
- **R7.** El endpoint sigue protegido con CASL `read Report` y RLS FORCE; `tenant_id` SIEMPRE del JWT.

---

## Escenarios Gherkin

```gherkin
Feature: Tope de vida útil en sugerencias de compra

  Scenario: Insumo perecible con horizonte largo → suggestedQty topada
    Given un insumo con shelfLifeDays=2, horizon=14, shortfall=13.5kg (consumo total 14d)
    And el consumo proyectado en los primeros 2 días (antes de vencer) menos el stock = 1.5kg
    When el owner llama GET /api/forecasting/shopping-suggestions?horizon=14
    Then suggestedQty=1.5kg (NO 13.5kg)
    And cappedByShelfLife=true y uncappedSuggestedQty=13.5kg

  Scenario: Insumo sin shelfLifeDays → sin tope (comportamiento intacto)
    Given un insumo sin shelfLifeDays configurado con shortfall=60.6kg
    When el owner llama GET /api/forecasting/shopping-suggestions?horizon=14
    Then suggestedQty=60.6kg (= shortfall)
    And cappedByShelfLife=false y uncappedSuggestedQty=null

  Scenario: shelfLifeDays ≥ horizon → el tope no llega a activarse
    Given un insumo con shelfLifeDays=30 y horizon=14
    When se calcula suggestedQty
    Then suggestedQty=shortfall (la sub-ventana cubre TODO el horizonte)
    And cappedByShelfLife=false
```

---

## Contrato de respuesta (extiende `ShoppingSuggestionItem`, `packages/shared`)

```ts
ShoppingSuggestionItem = {
  ingredientId: string;
  name: string;
  unit: string;
  currentStock: string;
  forecastConsumption: string;
  shortfall: string;               // sin cambios: forecastConsumption − currentStock
  suggestedQty: string;            // Lote B4: puede ser < shortfall si se topó
  // Lote B4 — tope de vida útil (aditivo):
  cappedByShelfLife: boolean;
  uncappedSuggestedQty: string | null; // = shortfall SOLO si cappedByShelfLife=true
}
```

---

## Decisión: extender el endpoint existente (no crear uno nuevo)

Mismo criterio que `HU-05-13`: es la MISMA sugerencia de compra (HU-08-06), el tope es un refinamiento aditivo del mismo cálculo, y ya existe precedente en el propio endpoint (`drivers`/`contextStatus` agregados aditivamente en HU-08-07 fase 2).

---

## Trazabilidad

| Requisito | Test                                                                                                                                                |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1, R3    | `src/forecasting/shelf-life-cap.util.spec.ts` — caso "shelfLifeDays < horizon"                                                                      |
| R2, R4    | `src/forecasting/shelf-life-cap.util.spec.ts` — caso "shelfLifeDays ≥ horizon"; `test/shopping-suggestions.e2e-spec.ts` — Pescado sin shelfLifeDays |
| R5        | `test/shopping-suggestions.e2e-spec.ts` — Cilantro perecible sigue apareciendo, topado                                                              |
| R6        | `test/shopping-suggestions.e2e-spec.ts` — todos los casos (aserciones sobre `shortfall` intactas)                                                   |
| R7        | `test/shopping-suggestions.e2e-spec.ts` — CASL 403 staff (heredado de HU-08-06), 401 sin token                                                      |
