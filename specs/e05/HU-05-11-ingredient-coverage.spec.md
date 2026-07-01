# HU-05-11 · Cobertura de días de stock por consumo real

**Módulo:** `inventory` | **Sprint:** S3 | **MoSCoW:** SHOULD  
**Endpoint:** `GET /api/inventory/ingredients/:id/coverage`  
**CASL:** `read Inventory`

---

## Problema

El gestor de compras necesita saber cuántos días le quedan de stock de un insumo basándose en el consumo real (no estimado). Hoy calcula esto manualmente con registros de Excel.

## Solución

Calcular el consumo diario promedio de los últimos 30 días a partir de los movimientos de tipo `sale` en `inventory_movements`, y dividir el stock actual por ese promedio.

---

## Requisitos (EARS)

- **R1.** El sistema DEBE calcular `avgDailyConsumption = Σ|qty| de type='sale' últimos 30 días / 30`.
- **R2.** Cuando `avgDailyConsumption = 0`, `daysLeft` DEBE ser `null` (cobertura indefinida).
- **R3.** El resultado DEBE ser Decimal-preciso (sin conversión float).
- **R4.** El endpoint DEBE protegerse con CASL `read Inventory`; `staff` recibe 403.
- **R5.** Si el insumo no existe, responde 404.

---

## Escenarios Gherkin

```gherkin
Feature: Cobertura de días de stock

  Scenario: Cobertura finita con consumo real
    Given el insumo X tiene stock=10, consumo sale=2kg/día en 30 días
    When el owner llama GET /api/inventory/ingredients/:id/coverage
    Then responde 200 con daysLeft=5, avgDailyConsumption=2

  Scenario: Cobertura indefinida sin consumo
    Given el insumo Y no tiene movimientos type=sale en 30 días
    When llama GET /api/inventory/ingredients/:id/coverage
    Then daysLeft=null

  Scenario: Staff recibe 403
    When un staff llama el endpoint
    Then responde 403
```

---

## Contrato de respuesta

```ts
IngredientCoverageResponse = {
  ingredientId: string;
  currentStock: string;
  avgDailyConsumption: string;
  basedOnDays: 30;
  daysLeft: string | null;
}
```

---

## Trazabilidad

| Requisito  | Test                                                |
| ---------- | --------------------------------------------------- |
| R1, R2, R3 | `test/ingredient-coverage.e2e-spec.ts` — happy path |
| R4         | `test/ingredient-coverage.e2e-spec.ts` — CASL 403   |
| R5         | `test/ingredient-coverage.e2e-spec.ts` — 404        |
