# HU-06-01/02/03/04/05 — Costeo dinámico, CIF, prorrateo, margen por plato y sugerencia de precio

> **Épica:** E06 (Costeo Dinámico y Márgenes) · **Sprint:** S3/S4 · **Must/Should** · **Estado:** 🟢 hecho (Inc 1).
> **Increment 1** del épica E06. **Diferido a Inc 2:** HU-06-06 (cierre de período mensual) y HU-06-07 (comparativo costo real vs teórico).
> **IA:** el backlog cruza HU-06-05 con HU-09-01 ("agente Costing"). En este alcance la **sugerencia de precio es una FÓRMULA determinista** — **NO depende de ningún servicio de IA**. El "impacto (forecast)/alerta +20%" del Gherkin se deja para E08/frontend.

Módulo nuevo `costing` (`src/costing/`): `CostingController` + `CostingService` + `OverheadController` + `OverheadService`. Importa `PlatformModule`, `AuthModule`, `AuthzModule` y **`CatalogModule`** (que ahora **exporta `RecipesService`**) para reutilizar el costo de ingredientes por BOM recursivo. Registrado en `app.module`.

## CASL — sujeto reutilizado `Report`
El costeo es **información de gestión**. Se **reutiliza el sujeto `Report`** (no se añade sujeto nuevo):
- **Lectura de costeo y de CIF** → `@RequireAbility('read', 'Report')` (owner + manager; **staff → 403**, ya que `staff` no tiene `read Report`).
- **Escritura de CIF** (crear/editar/eliminar) → `@RequireAbility('manage', 'Report')` (owner = `manage all`; manager = `manage Report`; staff → 403).

Aserción en `src/authz/casl-ability.factory.spec.ts` ("costeo (E06): reutiliza Report…").

## Modelo de datos (RLS FORCE — riesgo R4)
- **`overhead_costs`** (`OverheadCost`, HU-06-02): `id` uuid, `tenantId`, `period` `String` (`YYYY-MM`), `concept` `String`, `amount` `Decimal(12,2)`, `createdAt`/`updatedAt`/`deletedAt` (soft-delete). Índices en `tenantId` y `period`; relación `Tenant → overheadCosts`.
- Migración `overhead_costs` (`--create-only`); bloque **RLS FORCE** (`ENABLE` + `FORCE ROW LEVEL SECURITY` + policy `tenant_isolation`) **apendizado** a mano. Verificado `relforcerowsecurity='t'`. `tenant_id` siempre desde el JWT; todo el acceso vía `runInTenant`.

Toda la moneda se devuelve como **string** `.toFixed(2)` (PEN). Cálculos con `Prisma.Decimal` (Prisma 6).

## HU-06-02 · Gestión de CIF mensuales — CRUD `/api/overhead-costs`
```gherkin
GIVEN gerente en modulo de costeo
WHEN registra costo indirecto (nombre, monto mensual)
THEN queda activo y disponible para distribuir
```
- **`GET /api/overhead-costs?period=YYYY-MM`** · `read Report`. Lista los CIF vivos del tenant (filtro opcional por período).
- **`POST /api/overhead-costs`** · `manage Report` · `@Audited('overhead.create')`. Body `{ period, concept, amount }`.
- **`PATCH /api/overhead-costs/:id`** · `manage Report` · `@Audited('overhead.update')`. Body parcial `{ period?, concept?, amount? }`.
- **`DELETE /api/overhead-costs/:id`** · `manage Report` · `@Audited('overhead.delete')`. Soft-delete → `{ deleted: true }`.

> El backlog menciona `categoria` y `base de distribucion` por CIF. En Inc 1 el CIF se modela con `concept` + `amount`; la **base de distribución es global del período** (ver prorrateo). Categorías por CIF = refinamiento futuro.

## HU-06-01/03/04 · Costo, prorrateo y margen por plato — `GET /api/costing/dishes?period=YYYY-MM`
```gherkin
# HU-06-01: costo dinamico
THEN costo total = suma (cantidad * costo_actual_insumo) + sub-recetas + waste_factor  # via RecipesService
AND el costo se actualiza al cambiar el precio de un insumo                              # se recalcula en vivo
# HU-06-04: margen
THEN margen = sale_price - total_cost (directo + indirecto) AND margen % = margen/sale_price*100
```
`read Report`. Para cada **MenuItem activo** (`deletedAt=null`, `isActive=true`) devuelve:
```jsonc
{
  "period", "totalCIF", "totalUnits", "cifPerUnit", "allocationBase": "units",
  "dishes": [{
    "menuItemId", "name", "sellPrice",
    "ingredientCost",       // costo directo: RecipesService.costPerYieldTx(recipeId) (BOM recursivo, vivo)
    "unitsSold",            // unidades vendidas del plato en el período
    "cifPerUnit",           // CIF prorrateado por unidad (factor del período)
    "fullCost",             // = ingredientCost + cifPerUnit
    "foodCostPct",          // = ingredientCost / sellPrice · 100
    "marginPct",            // = (sellPrice − fullCost) / sellPrice · 100
    "contributionMargin"    // = sellPrice − fullCost  (margen unitario PEN)
  }]
}
```

### Prorrateo de CIF (HU-06-03) — base de distribución documentada
```gherkin
GIVEN cierre de mes y CIF activos WHEN se ejecuta distribucion
THEN se calcula factor (CIF total / total_ventas) AND cada plato recibe su parte indirecta
```
- `totalCIF = Σ overhead_costs.amount` (vivos) del período.
- `unitsSold` por plato = **`Σ qty`** de los `order_items` (vivos) cuyas ventas (`Sale`) están **EMITIDAS** (`status='issued'`) con `issuedAt` dentro del mes `[YYYY-MM-01, mes+1-01)` (UTC). Las ventas **anuladas** (`void`) se ignoran.
- `totalUnits = Σ unitsSold` de **todos** los platos.
- **`cifPerUnit = totalUnits > 0 ? totalCIF / totalUnits : 0`** — **asignación por partes iguales por unidad vendida** (`allocationBase = 'units'`). Si `totalUnits = 0` → `cifPerUnit = 0` (no hay base sobre la cual prorratear) y `fullCost = ingredientCost`.

> **Base de distribución elegida:** unidades vendidas (equal-per-unit). Es la base más simple y verificable para Inc 1. El backlog también menciona "% ventas / horas / fijo"; quedan como evolución (el `allocationBase` ya está en el contrato para versionarlo). El "cierre de mes" formal (cost_period CLOSED) es **HU-06-06 → Inc 2**; aquí el costeo se calcula **on-demand** para cualquier período.

## HU-06-05 · Sugerencia de precio por margen objetivo — `GET /api/costing/suggest-price`
```gherkin
GIVEN un menu_item WHEN gerente ingresa margen objetivo (ej 35%)
THEN se calcula precio sugerido
```
`read Report`. Query `?menuItemId=&targetMarginPct=&period=`. `targetMarginPct ∈ [0, 99]` (fuera → 400):
```
suggestedPrice = fullCost / (1 − targetMarginPct/100)
```
Devuelve `{ menuItemId, period, fullCost, targetMarginPct, suggestedPrice }` (strings). `fullCost` = el del plato en ese período (ingredientes + CIF prorrateado). **Fórmula pura** (sin IA). El impacto de demanda/forecast y la alerta "+20%" del Gherkin se difieren (E08/frontend).

## Contrato Zod (`src/shared/costing/costing.ts`)
`periodSchema` (`/^\d{4}-\d{2}$/`), `createOverheadCostSchema`, `updateOverheadCostSchema` (≥1 campo), `overheadCostQuerySchema`, `costingDishesQuerySchema` (period requerido), `suggestPriceQuerySchema` (`targetMarginPct` con `z.coerce.number().min(0).max(99)`). Exportado en `src/shared/index.ts`.

## Pruebas — `test/costing.e2e-spec.ts` (7)
Seed: tenant + owner/staff; insumo `unitCost 10` → receta (1 ítem → costo 10) → plato `price 40`; orden con `qty 5` cobrada (boleta, ticket `issued`, `issuedAt=now`); 2 CIF del mes actual sumando 100.
- **HU-06-02**: el período sembrado lista 2 CIF (filtro `?period=`) sumando 100; CRUD (crear/editar/eliminar) en un período aislado.
- **HU-06-01/03/04**: `dishes` → `ingredientCost "10.00"`, `unitsSold 5`, `totalCIF "100.00"`, `cifPerUnit "20.00"` (100/5), `fullCost "30.00"`, `foodCostPct "25.00"`, `marginPct "25.00"`, `contributionMargin "10.00"`.
- **HU-06-05**: `targetMarginPct 50` → `suggestedPrice "60.00"` (30/(1−0.5)); `targetMarginPct 100` → **400**.
- **RBAC**: `staff` → `GET /api/costing/dishes`, `suggest-price` y `GET/POST /api/overhead-costs` → **403**.
- **Sin ventas**: período `2099-01` con CIF 500 → `totalUnits 0`, `cifPerUnit "0.00"`, `fullCost "10.00"` (solo ingredientes).

## Decisiones / fuera de alcance
- **CASL**: reutiliza `Report` (no se crea sujeto `Costing`). Costeo = info de gestión (owner/manager); staff no accede.
- **Prorrateo** por unidades vendidas (equal-per-unit); otras bases (% ventas/horas) = futuro.
- **HU-06-06** (cierre de período inmutable) y **HU-06-07** (real vs teórico, consume `inventory_movements`) → **Inc 2**.
- **HU-06-05 sin IA**: fórmula determinista; impacto de demanda/forecast diferido a E08.
- Categoría/base por CIF, multi-moneda: fuera de alcance (PEN; `concept`+`amount`).
