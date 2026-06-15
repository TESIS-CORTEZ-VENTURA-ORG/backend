# HU-07-05/06/07/10 — Reportes operativos (inventario, food cost, mermas) y exportación CSV

> **Épica:** E07 (Reportes, Dashboards y KPIs) · **Sprint:** S4/S5 · **Must/Should** · **Estado:** 🟢 hecho (Inc 2).
> **Increment 2** de E07 — y el **último incremento construible del backend**. Endpoints de **agregación read-only** + **exportación CSV**: **NO** añaden tablas ni migración (incremento limpio, bajo riesgo). Construye sobre E05 (`ingredients`/`inventory_movements`) y E06 (costo de ingredientes por BOM y reporte de food cost por plato, vía la misma lógica que `CostingService`).

Extiende el módulo **`reports`** (`src/reports/`): se añaden tres GET de agregación a `ReportsController`/`ReportsService` y se habilita la **exportación CSV** como variante (`?format=csv`) de los reportes que devuelven tablas. Se respeta la frontera de módulos: los datos (`ingredients`, `inventory_movements`, `menu_items`, `order_items`, `sales`) se leen **directamente** vía `prisma.runInTenant`; la **única** dependencia inyectada de otro contexto sigue siendo `RecipesService` (provider exportado por `CatalogModule`, igual que E06) para el costo de ingredientes por BOM.

## Alcance del incremento
- **HU-07-05** (reporte de inventario) — valoración del stock actual.
- **HU-07-06** (reporte de food cost) — food cost % global y por plato.
- **HU-07-07** (reporte de mermas) — mermas agregadas por insumo y por razón en una ventana.
- **HU-07-10** (exportación) — **CSV** de los reportes que devuelven tablas (ventas, inventario, food cost, mermas).

Con esto **E07 → 10/10** construible. **HU-07-09 (Cierre Z)** ya vive en E04 (`/api/cash-close*`). Lo que requiere servicio externo (PDF/Excel con librería, R2, correo, IA) queda **diferido** — ver §Exportación y §Fuera de alcance.

## CASL — por endpoint (sin cambios en la matriz)
Toda la información de estos reportes es de **gestión** → sujeto **`Report`** (igual que el resto de E07/E06):
- **Reporte de inventario / food cost / mermas + sus exportaciones CSV** → `@RequireAbility('read', 'Report')` (owner + manager; **staff → 403**).

No se añade sujeto ni cambia `casl-ability.factory.ts`: `manager` ya tiene `read all` y `owner` `manage all`; el `staff` **no** tiene `read Report`. La matriz está aseverada en `src/authz/casl-ability.factory.spec.ts`. El gate corre en `PoliciesGuard` **antes** del handler, por lo que el `staff` recibe **403** también para `?format=csv`.

## Moneda, cantidades y períodos
- **Moneda** como **string** `.toFixed(2)` (PEN); **cantidades** de inventario/merma como string `.toFixed(3)` (igual que `InventoryService`/kardex). Cálculos con `Prisma.Decimal` (Prisma 6).
- **Ventana** de mermas: query **`?from=ISO&to=ISO`** (ISO 8601 con offset), misma `resolveWindow` de Inc 1 (default = hoy en **America/Lima**; `from <= to` → si no, 400). Las mermas se filtran por `inventory_movements.createdAt ∈ [from, to]`.
- **Período** de food cost: **`?period=YYYY-MM`** (obligatorio, `periodSchema` de E06; mes calendario). Reutiliza la lógica de unidades vendidas / food cost por plato de `CostingService` (ventas `issued` con `issuedAt` en el mes).

## HU-07-05 · Reporte de inventario — `GET /api/reports/inventory`
```gherkin
GIVEN gerente en reportes
WHEN selecciona "Inventario" con fecha de corte
THEN ve por producto: stock, costo unitario, valor total
AND ve totales por categoria
AND puede exportar a Excel
```
- `read Report`. Valoración del **stock actual** (fecha de corte = ahora; el kardex no guarda snapshots históricos por fecha — ver Fuera de alcance):
```jsonc
{
  "generatedAt",        // ISO del instante de generación
  "totalSkus",          // nº de insumos vivos (deletedAt=null)
  "totalStockValue",    // Σ stock·unitCost (string PEN)
  "lowStockCount",      // insumos con minStock>0 && stock<minStock (HU-05-10)
  "criticalCount",      // insumos con status='critical' (stock ≤ minStock·0.5)
  "items": [
    {
      "ingredientId", "name", "unit",
      "stock",          // string .toFixed(3)
      "minStock",       // string .toFixed(3)
      "unitCost",       // string .toFixed(2)
      "stockValue",     // stock·unitCost (string .toFixed(2))
      "status"          // 'ok' | 'low' | 'critical' (misma regla que InventoryService.statusFor)
    }
  ]
}
```
- `status` reutiliza la regla de E05: `critical` si `stock ≤ minStock·0.5`; `low` si `stock < minStock`; si no `ok` (con `minStock ≤ 0` → siempre `ok`). `items` ordenados por `name` asc (igual que `listStock`).
> **"Totales por categoría":** el campo `ingredients.category` es texto libre y opcional; los totales globales (`totalStockValue`, conteos) cubren el núcleo del Gherkin. El desglose por categoría es un refinamiento que el frontend puede derivar de `items`; no se añade aquí para no inventar un agrupador que el catálogo no garantiza poblado.

## HU-07-06 · Reporte de food cost — `GET /api/reports/food-cost?period=YYYY-MM`
```gherkin
GIVEN gerente en reportes
WHEN selecciona "Food Cost" con periodo
THEN ve por plato: costo, precio, food_cost_%, ranking
AND alerta sobre platos con FC > 35%
AND comparativo con periodos anteriores
```
- `read Report`. Food cost % **global** y **por plato** del período:
```jsonc
{
  "period",                 // YYYY-MM
  "overallFoodCostPct",     // Σ(ingredientCost·unitsSold) / Σ(revenue) · 100 (string)
  "targetFoodCostPct": "30.00",  // objetivo de referencia (constante)
  "dishes": [
    {
      "name", "sellPrice",  // precio de venta (string PEN)
      "ingredientCost",     // costo de ingredientes/unidad por BOM (string PEN)
      "foodCostPct",        // ingredientCost/sellPrice·100 (string)
      "unitsSold",          // unidades vendidas en el período (número)
      "revenue"             // sellPrice·unitsSold (string PEN)
    }
  ]
}
```
- **`overallFoodCostPct`** = `Σ(ingredientCost·unitsSold) / Σ(revenue) · 100`, con `revenue = Σ sellPrice·unitsSold` de los platos con ventas. Si el revenue total es 0 → `0.00`.
- **`foodCostPct`** por plato = `ingredientCost/sellPrice·100` (food cost teórico, mismo cálculo que `CostingService.dishes`). `dishes` ordenado por **`foodCostPct` desc** (los más caros de producir primero = ranking del Gherkin; desempate por nombre).
- **`ingredientCost`** se obtiene del **BOM recursivo** (`RecipesService.costPerYieldTx`, reutilizado de E06). `unitsSold` = Σ `qty` de `order_items` vivos de las ventas `issued` con `issuedAt` en el mes (misma definición que E06).
> **Alerta FC>35% y comparativo vs períodos anteriores:** el umbral objetivo viaja como `targetFoodCostPct` (la UI resalta los `foodCostPct` que lo superen); el comparativo multi-período se difiere (refinamiento — un período por request, igual que el costeo de E06).

## HU-07-07 · Reporte de mermas — `GET /api/reports/waste?from=&to=`
```gherkin
GIVEN gerente en reportes
WHEN selecciona "Mermas" con rango y filtros
THEN ve: total mermas en S/, top 10 productos, distribucion por razon, tendencia mensual
AND identifica anomalias detectadas por IA
```
- `read Report`. Mermas (`inventory_movements.type='waste'`) en la ventana, agregadas:
```jsonc
{
  "from", "to",
  "totalWasteQty",          // Σ |qty| (string .toFixed(3))
  "totalWasteCost",         // Σ |qty|·ingredient.unitCost (string PEN)
  "byIngredient": [ { "ingredientId", "name", "qty", "cost" } ],  // desc por cost
  "byReason":     [ { "reason", "qty", "cost" } ],                // desc por cost
  "movements":    [ { "id", "ingredientId", "ingredientName", "qty", "unit", "reason", "createdAt" } ]
}
```
- **`cost`** de cada merma = `|qty|·ingredient.unitCost` (mismo cálculo que `InventoryService.listWaste` y el `realCost`/`byType.waste` de E06). `qty` siempre se reporta como **magnitud** (`|qty|`, positivo).
- `byIngredient` agrupa por insumo (desc por `cost`); `byReason` agrupa por `reason` (mermas sin razón se agrupan bajo `'sin razón'`; desc por `cost`). `movements` es el detalle (desc por `createdAt`).
> **Top 10 / tendencia mensual / anomalías IA:** `byIngredient` ya viene ordenado desc (el frontend toma el top 10); la **tendencia mensual** (serie por mes) y la **detección de anomalías por IA** (HU-05-11, Waste Agent) se difieren a **E08** (servicio de IA, fuera del backend construible).

## HU-07-10 · Exportación CSV — `?format=csv` en los GET de reportes
```gherkin
GIVEN un reporte generado
WHEN gerente hace click en "Exportar"
THEN puede elegir formato (PDF, Excel, CSV)
AND el archivo se genera asincronamente para reportes grandes
AND se notifica cuando esta listo y se descarga desde R2
```
- `read Report`. La exportación se implementa como **variante de los reportes que devuelven tablas** mediante el query param **`?format=csv`** (consistente en los 4: `sales`, `inventory`, `food-cost`, `waste`). Sin el param (o `format=json`, el default) responden el envelope JSON `ApiResponse<T>` de siempre.
- Cuando `format=csv`, el handler responde con la **fila de detalle** del reporte en **CSV RFC‑4180** y fija las cabeceras vía la `FastifyReply` (`@Res({ passthrough: true })`):
  - `Content-Type: text/csv; charset=utf-8`
  - `Content-Disposition: attachment; filename="<reporte>-<fecha>.csv"` (p. ej. `inventory-2026-06-15.csv`; `<fecha>` = día local Lima de generación).
- **Formato CSV:** separador coma, fin de línea CRLF, **primera fila = cabeceras**; los campos que contienen coma, comillas o salto de línea se entrecomillan y las comillas internas se duplican (`"` → `""`). La moneda viaja como texto (mismas cifras que el JSON). Mapeo de filas:
  - `sales` → la **serie** (`key,revenue,count`).
  - `inventory` → los **items** (`ingredientId,name,unit,stock,minStock,unitCost,stockValue,status`).
  - `food-cost` → los **dishes** (`name,sellPrice,ingredientCost,foodCostPct,unitsSold,revenue`).
  - `waste` → los **movements** (`id,ingredientId,ingredientName,qty,unit,reason,createdAt`).
- **Sin nuevas dependencias.** El serializador CSV es una utilidad pura local (`csv.util.ts`) — no se añade ninguna librería ni se llama a ningún servicio externo.
> **PDF / Excel y generación asíncrona + descarga desde R2 = FUTURO.** PDF/Excel requieren una **librería de terceros** (p. ej. `pdfkit`/`exceljs`) y el flujo asíncrono con notificación + R2 requiere **object storage + cola + correo** (servicios externos). En esta entrega **solo CSV** (síncrono, sin deps). El query soporta `format ∈ {json, csv}`; añadir `pdf|xlsx` será trivial cuando exista la librería/infra.

## Frontera de módulos (R: no cross-module imports)
`ReportsService` agrega leyendo las tablas con `prisma.runInTenant` (`ingredient`, `inventory_movement`, `menu_item`, `order_item`, `sale`). La **única** dependencia inyectada de otro contexto sigue siendo `RecipesService` (provider exportado por `CatalogModule`), igual que en E06 e Inc 1 — dependencia de módulo declarada, no import de archivo cruzado. `tenant_id` siempre desde el JWT.

## Pruebas — `test/reports-ops.e2e-spec.ts`
Siembra (cliente admin) un tenant + owner/staff, carta (Pizza precio 40 / costo ing. 10; Agua precio 10 / costo ing. 2), insumos con `stock`/`unitCost`/`minStock` (uno bajo el mínimo, uno crítico), un par de mermas con razones distintas y ventas `issued` de un período. Asserts:
- **Inventario** (`GET /api/reports/inventory`): `totalStockValue` = Σ stock·unitCost, `lowStockCount` y `criticalCount` correctos, `items[].stockValue`/`status` por insumo, moneda/cantidad como strings.
- **Food cost** (`GET /api/reports/food-cost?period=`): `overallFoodCostPct` = Σ(ingredientCost·unitsSold)/Σrevenue·100; por plato `foodCostPct` (pizza 10/40=25.00, agua 2/10=20.00), `unitsSold`/`revenue`; orden desc por `foodCostPct`; `targetFoodCostPct='30.00'`.
- **Mermas** (`GET /api/reports/waste?from=&to=`): `totalWasteCost`/`totalWasteQty`, `byReason` y `byIngredient` con totales por razón/insumo, `movements` con el detalle.
- **CSV** (`?format=csv` en inventory/food-cost/waste/sales): `Content-Type: text/csv; charset=utf-8`, `Content-Disposition` con `attachment; filename="<reporte>-<fecha>.csv"`, cuerpo con **fila de cabeceras** + filas de datos (campos con coma entrecomillados).
- **RBAC:** `staff` → **403** en inventory/food-cost/waste (también con `?format=csv`).
- Moneda como **string** en JSON (CSV es texto).

Unit: `csv.util.spec.ts` — quoting RFC‑4180 (coma/comilla/salto de línea), CRLF, fila de cabeceras.
