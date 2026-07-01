# HU-03-13 · Sugerencias de upsell basadas en ventas reales

**Módulo:** `pos` | **Sprint:** S2 | **MoSCoW:** SHOULD  
**Endpoint:** `GET /api/orders/:id/suggestions?limit=3`  
**CASL:** `read Order`

---

## Problema

Los meseros necesitan sugerir platos adicionales a los clientes para incrementar el ticket promedio. Hoy no tienen una herramienta que les muestre qué platos son los más populares y todavía no están en la orden.

## Solución

Calcular los platos más vendidos (por cantidad en `order_items` de los últimos 30 días) que no estén ya en la orden actual y que estén actualmente disponibles en el menú.

---

## Requisitos (EARS)

- **R1.** El sistema DEBE devolver los N platos (default 3, max 10) con mayor `SUM(qty)` en `order_items` de los últimos 30 días.
- **R2.** El sistema DEBE excluir los platos ya presentes en la orden actual.
- **R3.** El sistema DEBE incluir solo platos con `isActive=true` y `deletedAt IS NULL`.
- **R4.** El endpoint DEBE protegerse con CASL `read Order`.
- **R5.** Si la orden no existe, responde 404.

---

## Escenarios Gherkin

```gherkin
Feature: Sugerencias de upsell en orden

  Scenario: Devuelve top platos no en la orden
    Given la orden #X tiene el plato "Lomo Saltado"
    And los platos más vendidos son "Ceviche" y "Pisco Sour"
    When el mesero llama GET /api/orders/:id/suggestions?limit=2
    Then responde 200 con ["Ceviche", "Pisco Sour"]
    And "Lomo Saltado" NO aparece en la lista

  Scenario: Orden no encontrada devuelve 404
    When llama GET /api/orders/no-existe/suggestions
    Then responde 404

  Scenario: Platos inactivos no aparecen en sugerencias
    Given el plato más vendido está marcado isActive=false
    When llama GET /api/orders/:id/suggestions
    Then el plato inactivo no aparece
```

---

## Contrato de respuesta

```ts
UpsellSuggestion = {
  menuItemId: string;
  name: string;
  price: string;       // Decimal serializado
  timesSold: number;   // qty total en el período
}
UpsellSuggestionsResponse = UpsellSuggestion[]
```

---

## Trazabilidad

| Requisito  | Test                                                    |
| ---------- | ------------------------------------------------------- |
| R1, R2, R3 | `test/order-suggestions.e2e-spec.ts` — happy path       |
| R4         | `test/order-suggestions.e2e-spec.ts` — CASL (sin token) |
| R5         | `test/order-suggestions.e2e-spec.ts` — 404              |
