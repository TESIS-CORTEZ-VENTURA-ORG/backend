# HU-06-06/07 — Cierre de periodo mensual + Comparativo Costo Real vs Teórico

> **Épica:** E06 (Costeo Dinámico y Márgenes) · **Sprint:** S4/S5 · **Should/Could** · **Estado:** 🟢 hecho (Inc 2).
> **Increment 2** del épica E06 (cierra E06 a 7/7). Construye sobre Inc 1 (PR #28): `overhead_costs`, `CostingService.dishes()` (costeo de platos + prorrateo de CIF), parsing de período `[YYYY-MM-01, mes+1-01)` UTC, moneda como string `.toFixed(2)`, sujeto CASL `Report`.

Sin módulo nuevo: se extiende `costing` (`CostingService` + `CostingController`). Se añade el modelo `CostingClose` y se reutiliza `RecipesService` (vía `CostingService.dishes`) + `inventory_movements` (lectura directa, sin importar `InventoryService` — se respeta la frontera de módulos leyendo la tabla con `runInTenant`).

## CASL — sujeto reutilizado `Report`
Igual que en Inc 1, el costeo es **información de gestión**:
- **Lectura** (`GET /api/costing/closes`, `/:period`, `/cost-variance`) → `@RequireAbility('read', 'Report')` (owner + manager; **staff → 403**).
- **Cierre** (`POST /api/costing/close`) → `@RequireAbility('manage', 'Report')` (owner = `manage all`; manager = `manage Report`; staff → 403).

La matriz ya está aseverada en `src/authz/casl-ability.factory.spec.ts` ("costeo (E06): reutiliza Report…"); no se añade sujeto nuevo.

## Modelo de datos (RLS FORCE — riesgo R4)
- **`costing_closes`** (`CostingClose`, HU-06-06):
  - `id` uuid, `tenantId` uuid, `period` `String` (`YYYY-MM`).
  - `totalCIF` `Decimal(12,2)`, `totalUnits` `Int`, `totalIngredientCost` `Decimal(12,2)`, `totalRevenue` `Decimal(12,2)`, `totalContribution` `Decimal(12,2)`.
  - `snapshot` `Json` — el **reporte de platos completo** (`PeriodCostingView`) al momento del cierre (cifra histórica inmutable).
  - `closedAt` `DateTime @default(now())`, `userId` `String?` (quién cerró, del JWT `sub`), `createdAt`.
  - **`@@unique([tenantId, period])`** — un solo cierre por mes. Índice en `tenantId`. Relación `Tenant → costingCloses`.
- Migración `costing_closes` (`--create-only`); bloque **RLS FORCE** (`ENABLE` + `FORCE ROW LEVEL SECURITY` + policy `tenant_isolation`) apendizado a mano. Verificado `relforcerowsecurity='t'`. `tenant_id` siempre desde el JWT; todo el acceso vía `runInTenant`.

Toda la moneda se devuelve como **string** `.toFixed(2)` (PEN). Cálculos con `Prisma.Decimal` (Prisma 6).

## HU-06-06 · Cierre de periodo mensual
```gherkin
GIVEN ultimo dia del mes
WHEN gerente solicita cierre
THEN se calculan totales finales (ventas, costos directos, CIF distribuidos)
AND el cost_period queda CLOSED (no editable)
AND se generan DishCostHistory finales
AND queda disponible para reportes y comparativos
```
- **`POST /api/costing/close`** · `manage Report` · `@Audited('costing.close')`. Body `{ period: 'YYYY-MM' }`.
  - Reutiliza `CostingService.dishes(tenantId, period)` → reporte de platos del período.
  - Agrega los totales finales a partir del reporte:
    - `totalCIF` = del reporte.
    - `totalUnits` = del reporte.
    - `totalIngredientCost` = `Σ (unitsSold · ingredientCost)` por plato (costo directo de lo efectivamente vendido).
    - `totalRevenue` = `Σ (unitsSold · sellPrice)` por plato.
    - `totalContribution` = `Σ (unitsSold · contributionMargin)` por plato.
  - Persiste un `CostingClose` con `snapshot` = el reporte completo (`PeriodCostingView`), `userId` = JWT `sub`.
  - Si el período **ya está cerrado** (`@@unique([tenantId, period])`) → **409 Conflict** (no editable / no recerrable).
  - Devuelve `CostingCloseView`.
- **`GET /api/costing/closes`** · `read Report` → lista de cierres del tenant (desc por `period`).
- **`GET /api/costing/closes/:period`** · `read Report` → el cierre de un período; **404** si no existe.

`CostingCloseView`:
```jsonc
{
  "id", "period",
  "totalCIF", "totalUnits", "totalIngredientCost", "totalRevenue", "totalContribution",  // strings (units = number)
  "closedAt",          // ISO
  "userId",            // string | null
  "snapshot": { period, totalCIF, totalUnits, cifPerUnit, allocationBase, dishes[] }       // PeriodCostingView histórico
}
```

> El "cierre = no editable" se materializa con la **unicidad por período** (segundo cierre del mismo mes → 409) + el `snapshot` inmutable. No se añade un estado `CLOSED` a un `cost_period` separado: el costeo se calcula on-demand (Inc 1) y el `CostingClose` es la foto final consultable para reportes/comparativos. `DishCostHistory` del Gherkin se representa por el `snapshot.dishes[]`.

## HU-06-07 · Comparativo Costo Real vs Costo Teórico
```gherkin
GIVEN ventas del periodo
WHEN comparo Costo Teorico (suma BOM por venta) vs Costo Real (movimientos de inventario)
THEN veo diferencia y % de desviacion
AND identifico productos con mayor desviacion
AND uso eso para investigar mermas no registradas o porciones excesivas
```
- **`GET /api/costing/cost-variance?period=YYYY-MM`** · `read Report`.
  - **`theoreticalCost`** = `Σ (unitsSold · ingredientCost)` sobre los platos del período (del reporte `CostingService.dishes`) — el costo de ingredientes **que debió consumirse** según el BOM por lo vendido.
  - **`realCost`** = salida valorizada de inventario en el mes = `Σ |qty| · ingredient.unitCost` sobre los `inventory_movements` con `type ∈ {sale, waste}` y `createdAt` dentro de `[YYYY-MM-01, mes+1-01)` (UTC).
  - **`variance`** = `realCost − theoreticalCost`. **`variancePct`** = `variance / theoreticalCost · 100` (0 si `theoreticalCost = 0`).
  - **`byType`** = `{ waste, sale }` — el `realCost` desglosado por tipo de movimiento (cada uno `Σ |qty|·unitCost`).
  - **`note`** = aclaración de la limitación (ver abajo).
  - Respuesta:
```jsonc
{ "period", "theoreticalCost", "realCost", "variance", "variancePct", "byType": { "waste", "sale" }, "note" }
```

### ⚠️ Limitación documentada (clave para no malinterpretar el comparativo)
Hoy **pagar una orden NO descuenta stock automáticamente**: el cobro (E04) **no crea un movimiento de inventario `sale` de consumo** — ese enlace POS↔inventario es una **integración futura** (fuera del alcance de esta HU; **no se construye aquí**). En consecuencia, el `realCost` calculado refleja **principalmente mermas (`waste`) + salidas manuales registradas con `type='sale'`**, no el consumo teórico por cada venta. El comparativo es válido como herramienta para **detectar mermas no registradas / porciones excesivas** sobre las salidas que SÍ se registran, pero **no debe leerse** como "consumo real total de todas las ventas" mientras la auto-deducción no exista. Esta misma aclaración va embebida en el campo `note` de la respuesta.

> Texto exacto del `note`: ver `COST_VARIANCE_NOTE` en `costing.service.ts`.

## Contrato Zod (`src/shared/costing/costing.ts`)
- `closePeriodSchema` = `z.object({ period: periodSchema })` (body del cierre).
- `costVarianceQuerySchema` = `z.object({ period: periodSchema })` (query del comparativo).
- Reutiliza `periodSchema` de Inc 1. Exportado en `src/shared/index.ts`.

## Pruebas — `test/costing-close.e2e-spec.ts`
Período **aislado** `2031-05` (las ventas se siembran **directamente** con el cliente admin fijando `issuedAt`/`createdAt` en ese mes, porque el endpoint de cobro emite con `now()`). Seed: tenant + owner/staff; insumo `unitCost 10` → receta (1 ítem → costo 10) → plato `price 40`; **CIF 100** (`2031-05`); una **orden con 5 unidades** del plato + **venta `issued`** con `issuedAt` en `2031-05`; dos `inventory_movements` en `2031-05`: una **merma** (`waste`, `qty −2`, unitCost 10 → 20) y una **salida manual** (`sale`, `qty −3`, unitCost 10 → 30).
- **HU-06-06 cierre**: `POST /api/costing/close { period:'2031-05' }` → persiste; `totalCIF "100.00"`, `totalUnits 5`, `totalIngredientCost "50.00"` (5·10), `totalRevenue "200.00"` (5·40), `totalContribution "50.00"` (5·(40−30)); `snapshot.dishes` presente. Segundo cierre del mismo período → **409**.
- **HU-06-06 lectura**: `GET /api/costing/closes` lista ≥1; `GET /api/costing/closes/2031-05` devuelve el cierre; período inexistente → **404**.
- **HU-06-07 comparativo**: `GET /api/costing/cost-variance?period=2031-05` → `theoreticalCost "50.00"` (del reporte: 5·10), `realCost "50.00"` (merma 20 + salida 30), `byType.waste "20.00"`, `byType.sale "30.00"`, `variance "0.00"`, `variancePct` calculado, `note` presente (no vacío).
- **RBAC**: `staff` → `POST /api/costing/close` y `GET /api/costing/cost-variance` → **403**.
- Moneda como **string** en todos los montos.

## Decisiones / fuera de alcance
- **CASL**: reutiliza `Report` (Inc 1); cierre = `manage Report`, lectura = `read Report`; staff → 403.
- **Cierre inmutable** vía `@@unique([tenantId, period])` + `snapshot` Json (no se modela un `cost_period` con estado).
- **HU-06-07 — auto-consumo NO construido**: pagar una orden no genera movimiento `sale` de inventario (integración POS↔inventario diferida); `realCost` ≈ mermas + salidas manuales. Documentado en `note` y aquí.
- Otras bases de prorrateo (% ventas/horas), categoría por CIF, multi-moneda: fuera de alcance (PEN).
