# HU-05-12 · Tendencia de precio de insumos (historial de compras)

**Módulo:** `inventory` | **Sprint:** S3 | **MoSCoW:** SHOULD  
**Tabla nueva:** `ingredient_price_history`  
**Endpoint:** `GET /api/inventory/ingredients/:id/price-trend?limit=12`  
**CASL:** `read Inventory`  
**Alimentación:** al recepcionar una OC (`PATCH /purchase-orders/:id/receive`), se inserta una fila por línea de la OC.

---

## Problema

El gerente necesita ver la evolución del precio de un insumo a lo largo del tiempo para detectar tendencias inflacionarias y negociar mejor con proveedores.

## Solución

Crear la tabla `ingredient_price_history` (referenciada en `backend.md §5` pero no construida), alimentarla automáticamente en la recepción de órdenes de compra, y exponer el historial ordenado por fecha descendente.

---

## Requisitos (EARS)

- **R1.** La tabla `ingredient_price_history` DEBE tener `tenant_id UUID NOT NULL` con política RLS FORCE.
- **R2.** Al recepcionar una OC, el sistema DEBE insertar una fila por línea con `unit_cost`, `recorded_at=NOW()`, `source='purchase_order'`.
- **R3.** El endpoint DEBE devolver los últimos N registros (default 12, max 50) ordenados por `recorded_at DESC`.
- **R4.** El endpoint DEBE protegerse con CASL `read Inventory`; `staff` recibe 403.
- **R5.** La suite RLS DEBE cubrir los 4 vectores para `ingredient_price_history`.

---

## Escenarios Gherkin

```gherkin
Feature: Historial de precio de insumos

  Scenario: Se registra precio al recepcionar una OC
    Given una OC con línea: ingrediente X, unitCost=38.50
    When se recibe la OC (PATCH /purchase-orders/:id/receive)
    Then existe una fila en ingredient_price_history con unit_cost=38.50 y source=purchase_order

  Scenario: Devuelve historial ordenado
    Given hay 5 registros de precio para el insumo X en fechas distintas
    When llama GET /api/inventory/ingredients/:id/price-trend?limit=3
    Then devuelve los 3 más recientes en orden descendente de fecha

  Scenario: Staff recibe 403
    When un staff llama el endpoint
    Then responde 403

  Scenario: RLS cross-read bloqueado
    Given tenantA tiene 3 registros de precio para insumo X
    And tenantB intenta listar price-trend de un insumo de tenantA
    Then tenantB no ve ningún registro
```

---

## Contrato de respuesta

```ts
PriceTrendItem = {
  recordedAt: string;  // ISO 8601
  unitCost: string;    // Decimal serializado
  source: 'purchase_order' | 'manual';
}
PriceTrendResponse = PriceTrendItem[]
```

---

## Trazabilidad

| Requisito | Test                                                     |
| --------- | -------------------------------------------------------- |
| R1, R5    | `test/ingredient-price-history-rls.e2e-spec.ts`          |
| R2        | `test/price-trend.e2e-spec.ts` — alimentación en receive |
| R3, R4    | `test/price-trend.e2e-spec.ts` — happy path + 403        |
