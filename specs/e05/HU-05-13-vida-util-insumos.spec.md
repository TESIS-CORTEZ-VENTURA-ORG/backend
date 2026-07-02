# HU-05-13 (Lote B4) · Vida útil de insumos — cobertura efectiva (MVP SIN lotes)

**Módulo:** `inventory` | **Sprint:** post-S4 (Lote B4) | **MoSCoW:** SHOULD
**Endpoint:** `GET /api/inventory/ingredients/:id/coverage` (EXTIENDE HU-05-11, mismo endpoint)
**CASL:** `read Inventory`
**Relacionado:** `HU-08-09-tope-vida-util-compras` (E08, tope de la sugerencia de compra)

---

## Problema

`HU-05-11` mide la cobertura de stock **solo por consumo**: 8 kg de pescado ÷ 0.8 kg/día = "10 días". Pero si el pescado aguanta 3 días antes de perderse, el widget da **falsa tranquilidad**: 5.6 kg se van a la basura antes de esos 10 días proyectados. El negocio necesita saber cuál restricción se activa primero — consumo o vencimiento — no un promedio de ambas.

## Solución

Combinar la cobertura por consumo existente con la vida útil del insumo (`Ingredient.shelfLifeDays`, nuevo, nullable) y la fecha de su **última compra** (`inventory_movements.type='purchase'`, MVP sin modelo de lotes: es la única referencia de frescura posible sin lotes físicos). La cobertura **efectiva** es el **mínimo** de ambas restricciones (regla de negocio central, validada con el usuario: nunca un promedio).

**Alcance explícito del MVP:** vida útil a nivel de **insumo** (un solo valor por insumo, sin lotes). FEFO real con trazabilidad por lote (fecha de recepción por unidad física, consumo First-Expired-First-Out) queda **fuera de alcance** — trabajo futuro declarado.

---

## Requisitos (EARS)

- **R1.** El sistema DEBE calcular `estimatedExpiryAt = lastPurchaseAt + shelfLifeDays días`, usando el último movimiento `type='purchase'` del insumo como `lastPurchaseAt`.
- **R2.** Sin `shelfLifeDays` configurado (`null`) O sin ningún movimiento `purchase` registrado, el sistema NO DEBE inventar una estimación: `lastPurchaseAt`/`estimatedExpiryAt`/`freshnessStatus`/`atRiskQty`/`atRiskCost` DEBEN ser `null`, y `effectiveCoverageDays` DEBE degradar a `daysLeft` (comportamiento HU-05-11 sin cambios).
- **R3.** El sistema DEBE calcular `effectiveCoverageDays = min(daysLeft, díasRestantesDeVidaÚtil)` — el cuello de botella real, NUNCA un promedio. Si `daysLeft=null` (consumo=0), la vida útil restante manda sola.
- **R4.** El sistema DEBE clasificar `freshnessStatus` así: `expired` si ya pasó `estimatedExpiryAt`; `expiring_soon` si quedan ≤2 días **O** ≤30% de la vida útil total (`shelfLifeDays`) — lo que se cumpla primero; `fresh` en cualquier otro caso.
- **R5.** El sistema DEBE calcular `atRiskQty = max(0, currentStock − avgDailyConsumption·díasRestantesDeVidaÚtil)` (stock que NO se alcanza a consumir antes de vencer) y `atRiskCost = atRiskQty · unitCost`, ambos Decimal-precisos (sin floats).
- **R6.** Todos los campos nuevos son ADITIVOS al contrato `IngredientCoverageResponse` (no rompen consumidores existentes de `daysLeft`/`avgDailyConsumption`).
- **R7.** El endpoint sigue protegido con CASL `read Inventory` y RLS FORCE (`runInTenant`); `tenant_id` SIEMPRE del JWT.

---

## Escenarios Gherkin

```gherkin
Feature: Cobertura efectiva de stock (vida útil + consumo)

  Scenario: Cobertura efectiva = min(consumo, vida útil) — escenario del ticket
    Given el insumo tiene stock=8kg, consumo=0.8kg/día (daysLeft=10) y shelfLifeDays=3
    And la última compra fue "ahora" (vida útil restante ≈ 3 días)
    When el owner llama GET /api/inventory/ingredients/:id/coverage
    Then responde 200 con effectiveCoverageDays≈3 (NO 10)
    And atRiskQty≈5.6kg (8 − 0.8×3) y atRiskCost = atRiskQty × unitCost

  Scenario: min(10 vs 3) → 3, nunca un promedio
    Given daysLeft=10 y días restantes de vida útil=3
    When se calcula effectiveCoverageDays
    Then el resultado es 3 (el mínimo), no 6.5 (el promedio)

  Scenario: Sin compras registradas → no se inventa una estimación
    Given el insumo tiene shelfLifeDays configurado pero NUNCA se registró un movimiento purchase
    When el owner llama GET /api/inventory/ingredients/:id/coverage
    Then lastPurchaseAt, estimatedExpiryAt, freshnessStatus, atRiskQty y atRiskCost son null
    And effectiveCoverageDays = daysLeft (sin cambios)

  Scenario: Sin shelfLifeDays configurado (no perecible) → comportamiento HU-05-11 intacto
    When el owner llama GET /api/inventory/ingredients/:id/coverage de un insumo sin shelfLifeDays
    Then freshnessStatus es null y effectiveCoverageDays = daysLeft
```

---

## Contrato de respuesta (extiende `IngredientCoverageResponse`, `packages/shared`)

```ts
IngredientCoverageResponse = {
  ingredientId: string;
  currentStock: string;
  avgDailyConsumption: string;
  basedOnDays: 30;
  daysLeft: string | null;
  // Lote B4 — vida útil de insumos (aditivo):
  shelfLifeDays: number | null;
  lastPurchaseAt: string | null;       // ISO, último movimiento type='purchase'
  estimatedExpiryAt: string | null;    // ISO, lastPurchaseAt + shelfLifeDays días
  freshnessStatus: 'fresh' | 'expiring_soon' | 'expired' | null;
  effectiveCoverageDays: string | null; // min(daysLeft, vida útil restante)
  atRiskQty: string | null;             // stock que no se alcanza a consumir antes de vencer
  atRiskCost: string | null;            // atRiskQty · unitCost (S/)
}
```

---

## Decisión: extender el endpoint existente (no crear uno nuevo)

Se EXTIENDE `GET /api/inventory/ingredients/:id/coverage` (mismo endpoint, mismo CASL) en vez de agregar un endpoint hermano, porque:

1. Es la MISMA pregunta de negocio ("¿cuánto me dura el stock?") — separar en dos llamadas obligaría al frontend a combinar dos respuestas para mostrar un solo número (`effectiveCoverageDays`).
2. Los campos nuevos son 100% ADITIVOS — Zod no rompe consumidores que solo leían `daysLeft`/`avgDailyConsumption`.
3. Ya existe precedente en el propio módulo E08 (`shopping-suggestions` extendido aditivamente con `drivers`/`contextStatus` en HU-08-07 fase 2, sin crear un endpoint nuevo).

---

## Migración

`Ingredient.shelfLifeDays Int?` (nullable, **sin default en DB** — no se inventa un valor para insumos existentes). Migración aditiva `20260702130000_ingredient_shelf_life`. No requiere tocar la política RLS de `ingredients` (ya `FORCE`, filtra por `tenant_id`, ajeno a esta columna).

---

## Trazabilidad

| Requisito  | Test                                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| R1, R3, R4 | `src/inventory/ingredient-freshness.util.spec.ts` (lógica pura, 9 casos)                                               |
| R2         | `src/inventory/ingredient-freshness.util.spec.ts` + `test/ingredient-coverage.e2e-spec.ts` — "sin compras registradas" |
| R5         | `src/inventory/ingredient-freshness.util.spec.ts` — escenario 8kg/0.8kg-día/3d → 5.6kg                                 |
| R6         | `test/ingredient-coverage.e2e-spec.ts` — todos los casos (aserciones sobre `daysLeft` intactas)                        |
| R7         | `test/ingredient-coverage.e2e-spec.ts` — CASL 403 staff (heredado de HU-05-11), 401 sin token                          |
