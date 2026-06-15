# HU-05 (refinamiento) — Auto-descuento de stock al vender (POS↔Inventario) + `waiterName` en el POS

> **Épica:** E05 (Inventario) · **Integra:** E03 (POS) + E04 (Cobros) + E06 (Costeo) · **Sprint:** S5 · **Refinamiento (sin nuevo número de HU)** · **Estado:** 🟢 hecho.
> Cierra dos brechas inter-épicas detectadas tras E01–E07. Construye sobre el cobro de E04 (`BillingService.pay`), el motor BOM de E02 (`RecipesService`), el kardex de E05 (`inventory_movements`) y el comparativo de E06 (`HU-06-07`). **Sin tablas ni migraciones nuevas** (reutiliza `inventory_movements` y `ingredients.stock`). Moneda/cantidades como **string** (`Prisma.Decimal.toFixed()`); todo el acceso vía `runInTenant` (tenant_id del JWT); RLS FORCE ya vigente en las tablas tocadas.

Este refinamiento NO introduce un número de HU nuevo: es la **integración** entre HU-04-04 (registrar pago) y HU-05-03 (salida de stock) que el comparativo HU-06-07 anticipaba como "integración futura". Referencia: la limitación documentada en `specs/e06/HU-06-06-07-cierre-variance.spec.md` queda **cerrada** por esta pieza.

## Gap A · `waiterName` en los read models del POS (HU-03-02/04)
Hoy `OrderView` y `TableView` exponen solo `waiterId` (uuid); el mapa de mesas del POS no puede mostrar el **nombre** del mesero sin un lookup extra.

**Implementado ✅** (campo aditivo — los esquemas Zod `.object` ignoran extras, así que es retro-compatible con el frontend):
- **`OrderView.waiterName: string | null`** (`src/pos/orders.service.ts`): se resuelve uniendo `User.name` por `order.waiterId` dentro de la **misma** `runInTenant` que arma la vista (`buildView`). Si `waiterId` es `null` → `waiterName = null`. Aplica a todos los consumidores de la vista: `GET /api/orders/:id`, abrir/tomar orden, y la vista que reutiliza E04 al cobrar.
- **`TableView.waiterName: string | null`** (`src/pos/tables.service.ts`): junto al `waiterId` ya existente, en el **listado** (`GET /api/tables`) y en el **detalle** (`GET /api/tables/:id`). Se resuelve el nombre del mesero de la **orden actual** de la mesa (null cuando la mesa está libre o la orden no tiene mesero). `TableOrderSummary` (resumen por mesa, sin N+1) gana `waiterName` alimentado por el mismo batch de órdenes vivas; los nombres se resuelven en una sola consulta `users` por los `waiterId` presentes.

> Decisión: el nombre se resuelve **leyendo `users` directamente** dentro de `runInTenant` (no se inyecta `UsersService`), igual que el resto de los read models del POS que leen `dining_tables`/`orders` directamente. Es lectura tenant-scoped por RLS; no cruza la frontera de módulos con un import de servicio.

## Gap B · Auto-consumo de stock al vender (E03 cobro → E05 inventario)
```gherkin
GIVEN una orden con ítems del menú (cada plato tiene su receta/BOM)
WHEN el cajero cobra la orden (la marca como pagada)
THEN por cada insumo del BOM explotado de lo vendido se registra un movimiento de inventario type='sale' (qty negativo)
AND el stock del insumo se descuenta por la cantidad consumida
AND el cobro NUNCA se bloquea por falta de stock (el stock puede quedar negativo, solo se registra)
AND el comparativo Costo Real vs Teórico (HU-06-07) refleja el consumo real de las ventas
```

**Implementado ✅** en `BillingService.pay` (`src/billing/billing.service.ts`), dentro de la **MISMA** transacción `runInTenant` que ya emite el ticket y registra los pagos, **después** de persistir el `Sale` (y de cerrar la orden / liberar la mesa):
1. Para cada `order_item` vivo de la orden:
   - Resuelve `menuItem` → `recipeId` (`menu_items` por `order_item.menuItemId`, dentro de la tx). Si el plato no tiene receta resoluble, ese ítem no consume (no rompe el cobro).
   - **Consumo de una unidad vendida** = `explodeIngredientsTx(tx, recipeId, 1/recipe.yield)` (BOM explotado a cantidades de insumo por unidad de plato). **Consumo del ítem** = ese mapa **multiplicado por `order_item.qty`**.
   - Se acumula por `ingredientId` en un único mapa `ingredientId → qtyConsumida` (Decimal) para toda la orden (un movimiento por insumo, no uno por ítem).
2. Por cada `ingredientId` consumido (qty > 0):
   - Crea **un** `inventory_movements` con `type='sale'`, `qty = consumida.negated()` (delta **negativo**), `note = 'Venta <saleId>'`, `reason = null`, `userId = null` (el consumo es del sistema por la venta, no de un movimiento manual de un usuario).
   - Descuenta `ingredient.stock -= consumida`. **Se permite que el stock quede NEGATIVO**: una venta nunca se bloquea por falta de stock (a diferencia de la salida manual HU-05-03, que sí valida ≥ 0). El stock negativo se **registra** tal cual y queda visible en el kardex/alertas (señal de inventario descuadrado / faltante de recepción), pero el cobro procede.

### Política de stock negativo (decisión explícita)
La salida **manual** (HU-05-03, `InventoryService.createMovement`) **rechaza** dejar el stock negativo (400) para no descuadrar el kardex por error humano. El **auto-consumo de venta es distinto**: el evento de negocio (cobro) ya ocurrió y es la fuente de verdad — **bloquearlo perdería la venta**. Por eso aquí se permite el negativo y se registra; corregirlo es trabajo de inventario (recepción de OC / ajuste / conteo), no del cajero. Documentado también en el código (`consumeStockForSale`).

### `explodeIngredientsTx` — explosión del BOM a cantidades (nuevo, público en `RecipesService`)
Espeja la recursión de costo (`recipeCost`/`itemCost`) pero **acumula cantidades de insumo** en vez de costo:
```ts
explodeIngredientsTx(
  tx: Prisma.TransactionClient,
  recipeId: string,
  multiplier: Prisma.Decimal | number = 1,
): Promise<Map<string /* ingredientId */, Prisma.Decimal /* qty */>>
```
- **Línea de ingrediente:** acumula `qty · (1 + wasteFactor) · multiplier` en el `ingredientId`.
- **Línea de sub-receta:** recurse con `multiplier' = multiplier · (qty · (1 + wasteFactor)) / sub.yield` (mismo factor por-unidad que el costo: `effQty` de la línea repartido entre el rendimiento de la sub-receta), y **fusiona** el mapa resultante en el acumulador.
- **Mismo manejo de ciclo y profundidad** que el costo: `MAX_DEPTH = 5` (excede → 400), set `visiting` para detectar ciclos (→ 400), `sub.yield = 0` → contribuye 0 (no divide por cero).
- El `wasteFactor` **se conserva** en la explosión (el consumo incluye la merma de receta), igual que en el costo — el comparativo HU-06-07 NO debe perder el manejo de merma.

> El motor de costo (`recipeCost`/`itemCost`) **no se refactoriza** sobre `explodeIngredientsTx` en este incremento: el costo necesita el `unitCost` por insumo y el por-unidad de sub-receta en el punto de la recursión, así que un refactor "costo = Σ explosión·unitCost" sería válido pero menos directo de lo que vale aquí. Se deja el costo intacto (riesgo bajo) y se añade la explosión en paralelo, espejando exactamente la misma aritmética de `effQty`/`yield`.

## Efecto en E06 (HU-06-07 · Costo Real vs Teórico)
Con el auto-consumo activo, `GET /api/costing/cost-variance?period=` ahora ve los movimientos `type='sale'` **de consumo real por venta** (antes solo veía mermas + salidas manuales). El `realCost` (`Σ |qty|·ingredient.unitCost` sobre `type∈{sale,waste}`) refleja el **consumo real de las ventas + mermas**, que es el comparativo que la HU pedía. El campo `note` (`COST_VARIANCE_NOTE` en `costing.service.ts`) se actualiza para reflejar que el enlace POS↔inventario **ya existe** (se quita la afirmación "pagar una orden NO descuenta stock"); **el manejo de merma se mantiene intacto** (no se elimina el `waste` del cálculo ni del desglose `byType`).

## Contrato — sin endpoints nuevos
- No hay rutas nuevas. El cobro sigue siendo `POST /api/orders/:id/pay` (E04); ahora además genera los movimientos de consumo en la misma transacción.
- Los movimientos de consumo son visibles vía los endpoints de E05 ya existentes: `GET /api/inventory/movements?ingredientId=<uuid>` los lista con `type='sale'`, `qty` negativo y `note='Venta <saleId>'`; impactan `GET /api/inventory/stock` y `GET /api/inventory/alerts`.
- `OrderView`/`TableView` ganan `waiterName` (aditivo). No cambia el RBAC (cobrar = `create Sale` = staff; leer mesas/órdenes = los abilities ya vigentes).

## Multi-tenant / consistencia
Todo ocurre dentro del **único** `runInTenant` de `pay` → atomicidad: si algo falla, ni el ticket, ni los pagos, ni los movimientos de consumo se persisten (no hay venta a medio descontar). `inventory_movements` e `ingredients` ya tienen RLS FORCE (E05); el consumo se inserta con el `tenant_id` del JWT. La explosión del BOM lee `recipes`/`recipe_items`/`ingredients` con el cliente de la misma tx (tenant-scoped).

## Pruebas — `test/stock-consumption.e2e-spec.ts`
Siembra tenant + owner/staff; insumo (`stock 100`, `unitCost 10`); receta que usa **2 unidades** del insumo (`yield 1`); plato del menú sobre esa receta. Flujo HTTP:
- **Consumo en venta:** el staff abre una mesa nueva (queda como mesero) + añade **3 unidades** del plato; cobra (`POST /api/orders/:id/pay`). Tras cobrar:
  - `GET /api/inventory/movements?ingredientId=` muestra **1 movimiento `type='sale'`** (uno agregado por insumo) con `qty = '-6.000'` (2·3) y `note` que empieza con `'Venta '`.
  - `GET /api/inventory/stock` → el insumo bajó de `100.000` a `94.000` (100 − 6).
- **Stock negativo permitido:** con el insumo en `94`, vender una orden que consume más que el stock (p. ej. 50 unidades → 100 consumidas) **no falla** (`pay` → 201) y deja `stock` **negativo** (`-6.000`); el movimiento `sale` queda registrado.
- **Gap A — `waiterName`:** tras abrir la mesa con el staff, `GET /api/tables/:id` y `GET /api/orders/:id` devuelven `waiterName` = el `name` del usuario staff (no null); una mesa libre → `waiterName` null en el listado.
- Cantidades aseveradas como **string** (`.toFixed(3)`).

## Decisiones / fuera de alcance
- **Reversa de consumo al anular el ticket** (`POST /api/sales/:id/void`): fuera de alcance (consistente con E04, que ya documenta "reversar orden/stock al anular ticket" como futuro). Un ticket anulado deja sus movimientos de consumo; corregir = ajuste manual de inventario.
- **Modificadores que cambian receta/consumo:** los modificadores (E03) ajustan precio (snapshot en el ítem), no el BOM; el consumo se calcula desde la receta base del plato. Variar el BOM por modificador = futuro.
- **`unitCost` del movimiento `sale`:** el `inventory_movements` no almacena costo por línea; el comparativo HU-06-07 valoriza con `ingredient.unitCost` vigente (consistente con mermas/salidas), suficiente para el comparativo.
- Sin tablas ni migración nuevas; sin servicios externos.
