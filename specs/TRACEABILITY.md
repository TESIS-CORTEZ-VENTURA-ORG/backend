# Trazabilidad Backlog ↔ Implementación — Backend GastronomIA

> Mapea las HU de `Product Backlog.md` (fuente de verdad) con specs, PRs y tests.
> Evidencia de trazabilidad (ABET SO7). Actualizado: 2026-06-15 (E11 — importación de histórico de ventas por CSV HU-11-03/04/05, módulo `ingestion`, tabla `sales_history` con RLS FORCE; PR #34. Wizard HU-11-01 = frontend; magic-upload R2/IA y SalesDailyAggregate/forecasting diferidos).

## Decisiones de reconciliación

1. **Roles = 3** (`owner`/`manager`/`staff`), no los 5 del backlog original. HU-01-04 actualizado.
2. **IDs oficiales** del backlog (`HU-01-XX`, `HU-12-XX`); la numeración previa `HU-E01-0X` quedó obsoleta.

## E01 — Identity, Multi-Tenancy y Seguridad (10 HU)

| HU       | Título                           | Estado                   | Spec                              | PR     |
| -------- | -------------------------------- | ------------------------ | --------------------------------- | ------ |
| HU-01-01 | Registro de restaurante (tenant) | 🟡 Parcial               | `HU-01-01-y-02-registro-login`    | #5     |
| HU-01-02 | Login con email y password       | 🟢 Hecho (lockout incl.) | `HU-01-01-y-02` / `HU-01-03-y-08` | #5, #8 |
| HU-01-03 | Refresh token con rotación       | 🟢 Hecho                 | `HU-01-03-y-08-session`           | #8     |
| HU-01-04 | Roles y permisos (RBAC)          | 🟢 Hecho                 | `HU-01-04-rbac`                   | #7     |
| HU-01-05 | Invitación de usuarios por email | 🔲 Diferido (correo)     | —                                 | —      |
| HU-01-06 | Cambio de contraseña             | 🟢 Hecho                 | `HU-01-06-change-password`        | #11    |
| HU-01-07 | Recuperación de contraseña       | 🔲 Diferido (correo)     | —                                 | —      |
| HU-01-08 | Cierre de sesión                 | 🟢 Hecho (backend)       | `HU-01-03-y-08-session`           | #8     |
| HU-01-09 | Audit log                        | 🟢 Hecho                 | `HU-01-09-audit-log`              | #10    |
| HU-01-10 | Configuración del local          | 🟢 Hecho                 | `HU-01-10-tenant-config`          | #9     |

**E01: 8/10 funcionales** (7 completas + HU-01-01 parcial). 2 diferidas por requerir servicio de correo.

### Gaps / diferidos (todos requieren correo o son refinamientos)

- **HU-01-01**: email de bienvenida (correo). El RUC se setea vía config (HU-01-10).
- **HU-01-05 / HU-01-07**: invitación y recuperación de contraseña → **requieren servicio de correo** (Resend); diferidas.
- **HU-01-06**: notificación por email del cambio (correo).
- **HU-01-08**: el BFF del frontend debe llamar a `POST /api/auth/logout` (hoy solo limpia la cookie) — follow-up frontend.
- **HU-01-09**: `before/after` detallado por entidad; retención 5 años (política de storage).

## E02 — Catálogo, Recetas y Menú (14 HU)

| HU       | Título                                | Estado                   | Spec                                 | PR  |
| -------- | ------------------------------------- | ------------------------ | ------------------------------------ | --- |
| HU-02-01 | CRUD de insumos                       | 🟢 Hecho                 | `HU-02-01-ingredients`               | #13 |
| HU-02-02 | Carga masiva de insumos vía Excel/CSV | 🟢 Hecho                 | `HU-02-02-import`                    | #19 |
| HU-02-03 | Unidades de medida con conversión     | 🟢 Hecho                 | `HU-02-03-04-units-categories`       | #14 |
| HU-02-04 | Categorías jerárquicas                | 🟢 Hecho                 | `HU-02-03-04-units-categories`       | #14 |
| HU-02-05 | CRUD de proveedores                   | 🟢 Hecho                 | `HU-02-05-06-suppliers`              | #15 |
| HU-02-06 | Asociar productos con proveedores     | 🟢 Hecho                 | `HU-02-05-06-suppliers`              | #15 |
| HU-02-07 | Crear receta estandarizada (BOM)      | 🟢 Hecho                 | `HU-02-07-09-recipes`                | #16 |
| HU-02-08 | Sub-recetas anidadas                  | 🟢 Hecho                 | `HU-02-07-09-recipes`                | #16 |
| HU-02-09 | Versionado de recetas                 | 🟢 Hecho                 | `HU-02-07-09-recipes`                | #16 |
| HU-02-10 | Crear plato del menú (margen)         | 🟢 Hecho                 | `HU-02-10-12-menu`                   | #17 |
| HU-02-11 | Gestión de modificadores              | 🟢 Hecho                 | `HU-02-11-13-modifiers-availability` | #18 |
| HU-02-12 | Categorías del menú                   | 🟢 Hecho                 | `HU-02-10-12-menu`                   | #17 |
| HU-02-13 | Disponibilidad por horario            | 🟢 Hecho                 | `HU-02-11-13-modifiers-availability` | #18 |
| HU-02-14 | Foto del plato                        | 🔲 Diferido (storage R2) | —                                    | —   |

**E02: 13/14 hechas** (Inc A–F). Única diferida: **HU-02-14** foto del plato (requiere object storage R2 — servicio externo). Todo lo construible vía código está completo.

## E03 — POS, Salón y Cocina/KDS (12 HU)

| HU       | Título                     | Estado                                             | Spec                             | PR  |
| -------- | -------------------------- | -------------------------------------------------- | -------------------------------- | --- |
| HU-03-01 | Configurar zonas y mesas   | 🟢 Hecho                                           | `HU-03-01-02-salon`              | #21 |
| HU-03-02 | Mapa de mesas con estado   | 🟢 Hecho (datos; real-time vía polling)            | `HU-03-01-02-salon`              | #21 |
| HU-03-03 | Abrir mesa                 | 🟢 Hecho                                           | `HU-03-03-04-05-10-11-12-orders` | #22 |
| HU-03-04 | Tomar orden                | 🟢 Hecho                                           | `HU-03-03-04-05-10-11-12-orders` | #22 |
| HU-03-05 | Aplicar modificadores      | 🟢 Hecho                                           | `HU-03-03-04-05-10-11-12-orders` | #22 |
| HU-03-06 | Enviar comanda a cocina    | 🟢 Hecho                                           | `HU-03-06-09-kitchen`            | #23 |
| HU-03-07 | Vista KDS por estación     | 🟢 Hecho                                           | `HU-03-06-09-kitchen`            | #23 |
| HU-03-08 | Marcar ítem en preparación | 🟢 Hecho                                           | `HU-03-06-09-kitchen`            | #23 |
| HU-03-09 | Marcar ítem listo          | 🟢 Hecho                                           | `HU-03-06-09-kitchen`            | #23 |
| HU-03-10 | Marcar ítem servido        | 🟢 Hecho                                           | `HU-03-03-04-05-10-11-12-orders` | #22 |
| HU-03-11 | Anular orden con razón     | 🟢 Hecho                                           | `HU-03-03-04-05-10-11-12-orders` | #22 |
| HU-03-12 | Solicitar cuenta           | 🟢 Hecho (vía `PATCH /api/tables {status:'bill'}`) | `HU-03-03-04-05-10-11-12-orders` | #22 |

**E03: 12/12 backend** (Inc A — salón: 2 · Inc B — órdenes: 6 · Inc C — cocina/KDS: 4). Real-time por **polling** (push SSE = mejora; no requiere servicio externo). HU-03-12 "solicitar cuenta" no añade endpoint: reutiliza `PATCH /api/tables/:id { status:'bill' }`. Inc C añade `kitchen_stations` (RLS FORCE), `menu_categories.kitchen_station_id`, `POST /api/orders/:id/send-to-kitchen`, `/api/kitchen/stations` + `/api/kitchen/queue` + `PATCH /api/kitchen/items/:itemId`, y el read-model de mesas (`GET /api/tables/:id` + campos `currentOrderId/openedAt/guests/waiterId` en el listado). Nota: el frontend aún NO tiene **pantalla KDS** (se construirá; el backend ya la habilita).

## E04 — Tickets, Cobros y Pagos (8 HU)

| HU       | Título                                         | Estado                  | Spec                              | PR  |
| -------- | ---------------------------------------------- | ----------------------- | --------------------------------- | --- |
| HU-04-01 | Generar pre-cuenta                             | 🟢 Hecho                | `HU-04-01-02-04-05-06-07-billing` | #26 |
| HU-04-02 | Generar cuenta final (ticket)                  | 🟢 Hecho                | `HU-04-01-02-04-05-06-07-billing` | #26 |
| HU-04-03 | División de cuenta por comensal                | 🟢 Hecho                | `HU-04-03-08-split-cierre-z`      | #27 |
| HU-04-04 | Registrar pago en efectivo                     | 🟢 Hecho                | `HU-04-01-02-04-05-06-07-billing` | #26 |
| HU-04-05 | Registrar pago electrónico (Yape/Plin/tarjeta) | 🟢 Hecho (sin pasarela) | `HU-04-01-02-04-05-06-07-billing` | #26 |
| HU-04-06 | Pago mixto                                     | 🟢 Hecho                | `HU-04-01-02-04-05-06-07-billing` | #26 |
| HU-04-07 | Anular ticket                                  | 🟢 Hecho                | `HU-04-01-02-04-05-06-07-billing` | #26 |
| HU-04-08 | Cierre Z del día                               | 🟢 Hecho                | `HU-04-03-08-split-cierre-z`      | #27 |

**E04: 8/8 backend (Inc 1 + Inc 2)** — módulo nuevo `billing` (`Billing{Controller,Service}`). Esquema `sales` + `payments` (RLS FORCE ambas, verificado `relforcerowsecurity=t`; FK `payments→sales ON DELETE CASCADE`; `sales` con `@@unique([orderId])` = un ticket por orden y `@@unique([tenantId, serie, number])` = correlativo). **Precios INCLUYEN IGV**: `total = Σ unitPrice·qty`; `subtotal = total/(1+igvRate)` (del `tenant.igvRate`, default 0.18); `igv = total−subtotal`. Series: boleta `B001`, factura `F001`; `number = max+1` por tenant+serie. Endpoints: `GET /api/orders/:id/pre-bill` (preview, no persiste), `POST /api/orders/:id/pay` (emite ticket + N pagos + cierra orden `paid` + libera mesa `free`, una sola tx `runInTenant`; reutiliza `OrdersService.buildView` en la misma tx), `GET /api/sales` + `/api/sales/:id`, `POST /api/sales/:id/void`. `SaleView` = espejo del `Sale` del frontend (moneda como string; adaptador BFF trivial sobre `orders/[id]/pay.post.ts`). **RBAC:** el cajero es `staff` → `can('create','Sale')` (cobra); **anular** = manager/owner (`update Sale`; staff → 403). **SUNAT:** el backlog pide "schema preparado para SUNAT"; la **emisión/envío electrónico es externo y queda fuera de alcance** (solo se registra el ticket). **Fuera de alcance (documentado):** vuelto en efectivo y referencia de pago electrónico (no se persisten); reversar orden/stock al anular ticket.

**Inc 2 (HU-04-03 + HU-04-08)** — extiende `billing`. **HU-04-03 división de cuenta** (`POST /api/orders/:id/split`, `read Sale`, **cómputo sin persistir**): `mode='equal'` divide el `total` de la orden en `parts` partes (default = `order.guests` si ≥ 2) con el **resto de redondeo en la primera parte** → `Σ shares.total == order.total` exacto; `mode='items'` agrupa por `assignments[{label,itemIds}]` validando que **cada ítem vivo esté asignado exactamente una vez** (si no → 400). `subtotal`/`igv` por parte desde su `total` con el `igvRate` del tenant. Orden `paid`/`void` → 409. "Un ticket por parte" = alcance futuro (pagar sigue siendo el `pay` de Inc 1). **HU-04-08 cierre Z**: nueva tabla `cash_closes` (`CashClose`, RLS FORCE verificado `relforcerowsecurity=t`; índice `tenantId`; relación `Tenant→cashCloses`; append-only/inmutable) con `openedAt`/`closedAt`/`salesCount`/`voidCount`/`totalGross Decimal(12,2)`/`byMethod Json {cash,card,yape,plin}`/`userId?`. `GET /api/cash-close/preview` (`read Sale`) agrega ventas **issued** desde el último `closedAt` (o all-time): `{ periodStart, salesCount, voidCount, totalGross, byMethod, openSince }` (Σ `payment.amount` por método). `POST /api/cash-close` (`update Sale`, **manager/owner**; staff → 403; `@Audited('cash.close')`) persiste el agregado (`openedAt` = último `closedAt` o `issuedAt` de la 1ª venta; `closedAt=now`; `userId`=JWT `sub`) → tras cerrar, el siguiente preview arranca ventana fresca. `GET /api/cash-close` (`read Sale`) lista desc por `closedAt`. **SUNAT:** envío electrónico sigue **diferido/externo** (schema-ready). **E04 → 8/8.**

## E05 — Inventario, Compras y Mermas (11 HU)

| HU       | Título                              | Estado                                   | Spec                                | PR  |
| -------- | ----------------------------------- | ---------------------------------------- | ----------------------------------- | --- |
| HU-05-01 | Ver stock actual (kardex)           | 🟢 Hecho                                 | `HU-05-01-stock-movimientos-mermas` | #24 |
| HU-05-02 | Registrar entrada manual de stock   | 🟢 Hecho                                 | `HU-05-01-stock-movimientos-mermas` | #24 |
| HU-05-03 | Registrar salida manual             | 🟢 Hecho                                 | `HU-05-01-stock-movimientos-mermas` | #24 |
| HU-05-04 | Crear orden de compra               | 🟢 Hecho                                 | `HU-05-04-06-07-purchase-orders`    | #25 |
| HU-05-05 | Enviar OC al proveedor              | 🟡 Parcial (solo estado; email diferido) | `HU-05-04-06-07-purchase-orders`    | #25 |
| HU-05-06 | Recepcionar OC (parcial/total)      | 🟢 Hecho                                 | `HU-05-04-06-07-purchase-orders`    | #25 |
| HU-05-07 | Cancelar OC                         | 🟢 Hecho                                 | `HU-05-04-06-07-purchase-orders`    | #25 |
| HU-05-08 | Registrar merma con razón           | 🟢 Hecho                                 | `HU-05-01-stock-movimientos-mermas` | #24 |
| HU-05-09 | Ver histórico de mermas             | 🟢 Hecho                                 | `HU-05-01-stock-movimientos-mermas` | #24 |
| HU-05-10 | Alertas de stock bajo               | 🟢 Hecho                                 | `HU-05-01-stock-movimientos-mermas` | #24 |
| HU-05-11 | Detectar anomalías de mermas con IA | 🔲 Diferido (IA/E08)                     | —                                   | —   |

**E05: 9/11 backend** (Inc 1 = 6 · Inc 2 = 3) + HU-05-05 status-only. **Inc 1** (#24): stock/kardex, movimientos (entrada/salida), mermas con razón, histórico de mermas y alertas de stock bajo (`inventory_movements`, RLS FORCE, kardex event-sourced con delta firmado; `ingredients` gana `stock`/`minStock` `Decimal(12,3)`). **Inc 2** (#25): órdenes de compra — `purchase_orders` + `purchase_order_items` (RLS FORCE ambas, FK PO `ON DELETE CASCADE`), `PurchaseOrders{Controller,Service}` en el módulo `inventory`. HU-05-04 crear (`draft`, `total = Σ qtyOrdered·unitCost`); HU-05-06 recepcionar parcial/total → crea movimiento `purchase` + sube `stock` + fija `unitCost` (last purchase price), estado `partially_received`/`received` (reutiliza la lógica de movimiento de Inc 1, misma transacción `runInTenant`); HU-05-07 cancelar (`{draft,sent}→cancelled`, 409 si ya recibió). **HU-05-05** = solo transición `draft→sent`; el **email/PDF al proveedor está diferido** (servicio de correo externo, como E01). **HU-05-11** anomalías de merma = **servicio de IA (E08)**, diferido. Endpoints Inc 2: `POST/GET /api/purchase-orders`, `GET /api/purchase-orders/:id`, `POST /api/purchase-orders/:id/{send,receive,cancel}`.

**Refinamiento inter-épico E05/E03 — auto-consumo de stock al vender + `waiterName`** (`HU-05-consumo-en-venta`, sin nuevo número de HU): cierra la brecha POS↔inventario. Al **cobrar** una orden (`POST /api/orders/:id/pay`, E04), dentro de la **misma** tx `runInTenant` y **después** de persistir el `Sale`, se **explota el BOM** de cada plato vendido a cantidades de insumo (nuevo `RecipesService.explodeIngredientsTx(tx, recipeId, multiplier)` que espeja `recipeCost`/`itemCost` acumulando cantidades: ingrediente → `qty·(1+waste)·multiplier`; sub-receta → recurse con `multiplier'=multiplier·(qty·(1+waste))/sub.yield`; mismo MAX_DEPTH=5/ciclo/yield). Por insumo consumido se crea **un** `inventory_movements` `type='sale'`, `qty` negativo (= consumo·`orderItem.qty`, con `consumo unidad = explode(recipe, 1/yield)`), `note='Venta <saleId>'`, y se descuenta `ingredient.stock`. **Política de stock negativo:** una venta NUNCA se bloquea por falta de stock → se permite que el stock quede negativo y se registra (≠ salida manual HU-05-03, que sí rechaza negativo). `BillingModule` ahora importa `CatalogModule` (que exporta `RecipesService`). **Cierra la limitación de E06-07** (ver abajo). **`waiterName` (Gap A):** `OrderView` y `TableView` (+ `TableOrderSummary`) ganan `waiterName: string|null` (junto a `waiterId`), resuelto leyendo `users` directamente dentro de `runInTenant`; aditivo (Zod `.object` ignora extras → retro-compatible). Tests: `test/stock-consumption.e2e-spec.ts`. Sin tablas ni migración nuevas.

## E06 — Costeo Dinámico y Márgenes (7 HU)

| HU       | Título                                       | Estado                                              | Spec                                                     | PR  |
| -------- | -------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------- | --- |
| HU-06-01 | Cálculo dinámico de costo por plato          | 🟢 Hecho                                            | `HU-06-01-05-costeo`                                     | #28 |
| HU-06-02 | Gestión de costos indirectos (CIF) mensuales | 🟢 Hecho                                            | `HU-06-01-05-costeo`                                     | #28 |
| HU-06-03 | Distribución prorrateada de CIF              | 🟢 Hecho                                            | `HU-06-01-05-costeo`                                     | #28 |
| HU-06-04 | Cálculo de margen unitario por plato         | 🟢 Hecho                                            | `HU-06-01-05-costeo`                                     | #28 |
| HU-06-05 | Sugerencia de precio por margen objetivo     | 🟢 Hecho (fórmula, sin IA)                          | `HU-06-01-05-costeo`                                     | #28 |
| HU-06-06 | Cierre de período mensual                    | 🟢 Hecho                                            | `HU-06-06-07-cierre-variance`                            | #29 |
| HU-06-07 | Comparativo Costo Real vs Costo Teórico      | 🟢 Hecho (auto-consumo activo — limitación cerrada) | `HU-06-06-07-cierre-variance` · `HU-05-consumo-en-venta` | #29 |

**E06: 7/7 backend (Inc 1 + Inc 2)** — Inc 2 (PR #29) extiende el módulo `costing` con **HU-06-06** (cierre de período) y **HU-06-07** (comparativo real vs teórico). Esquema nuevo **`costing_closes`** (`CostingClose`, RLS FORCE verificado `relforcerowsecurity='t'`; `@@unique([tenantId,period])` = un cierre por mes; índice `tenantId`; relación `Tenant→costingCloses`): `totalCIF`/`totalIngredientCost`/`totalRevenue`/`totalContribution` `Decimal(12,2)`, `totalUnits` `Int`, `snapshot` `Json` (el `PeriodCostingView` completo al cierre = cifra histórica inmutable), `closedAt`, `userId?`. **CASL:** reutiliza `Report` (cierre = `manage Report` + `@Audited('costing.close')`; lectura = `read Report`; staff → 403). **HU-06-06** `POST /api/costing/close { period }` reutiliza `CostingService.dishes()`, agrega totales (ingredientes/revenue/contribución = Σ por plato de `unitsSold·{ingredientCost|sellPrice|contributionMargin}`), persiste el `CostingClose`; **segundo cierre del mismo período → 409**; `GET /api/costing/closes` + `GET /api/costing/closes/:period` (404 si no existe). **HU-06-07** `GET /api/costing/cost-variance?period=` → `theoreticalCost` (= Σ `unitsSold·ingredientCost` del reporte), `realCost` (= salida valorizada de inventario: Σ `|qty|·ingredient.unitCost` sobre `inventory_movements` con `type∈{sale,waste}` y `createdAt` en el mes), `variance` (=real−teórico), `variancePct`, `byType:{waste,sale}`, `note`. **✅ Limitación CERRADA (refinamiento E05/E03 `HU-05-consumo-en-venta`):** pagar una orden **ahora SÍ** descuenta stock automáticamente — el cobro crea movimientos `type='sale'` de consumo del BOM explotado en la misma tx (ver E05 arriba), así que `realCost` ya refleja el **consumo real de las ventas + mermas** (el comparativo que la HU pedía). El `note` (`COST_VARIANCE_NOTE`) se actualizó en consecuencia; **el manejo de merma se mantiene** (no se quitó el `waste` del cálculo ni del desglose `byType`).

**E06: 5/7 backend (Inc 1)** — módulo nuevo `costing` (`CostingController` + `CostingService` + `OverheadController` + `OverheadService`). Esquema nuevo `overhead_costs` (`OverheadCost`, RLS FORCE verificado `relforcerowsecurity='t'`; índices `tenantId`+`period`; soft-delete; relación `Tenant→overheadCosts`). **Reutiliza** `RecipesService.costPerYieldTx` (BOM recursivo) para el costo de ingredientes — `CatalogModule` ahora **exporta** `RecipesService`. **CASL:** se **reutiliza el sujeto `Report`** (no se crea sujeto `Costing`): costeo = info de gestión → lectura (`read Report`) y escritura de CIF (`manage Report`) = owner/manager; **staff → 403** (aserción en `casl-ability.factory.spec.ts`). **HU-06-02** CRUD `/api/overhead-costs` (`{ period:YYYY-MM, concept, amount }`, `@Audited`). **HU-06-01/03/04** `GET /api/costing/dishes?period=` → por plato activo: `ingredientCost` (receta), `unitsSold` (Σ qty de `order_items` de ventas `issued` con `issuedAt` en el mes), `cifPerUnit` (= `totalCIF/totalUnits`, **prorrateo por partes iguales por unidad vendida**; `allocationBase='units'`; si `totalUnits=0` → 0), `fullCost` (= ingredientes + CIF), `foodCostPct`, `marginPct`, `contributionMargin` (moneda string). **HU-06-05** `GET /api/costing/suggest-price?menuItemId=&targetMarginPct=&period=` → `suggestedPrice = fullCost/(1−targetMarginPct/100)`, `targetMarginPct∈[0,99]` (**fórmula determinista, sin IA** pese al cross-ref HU-09-01; el impacto de demanda/forecast y alerta +20% se difieren a E08). **HU-06-06** (cierre de período inmutable) y **HU-06-07** (real vs teórico, consumirá `inventory_movements`) → **Inc 2**.

## E07 — Reportes, Dashboards y KPIs (10 HU)

| HU       | Título                             | Estado                                               | Spec                                          | PR  |
| -------- | ---------------------------------- | ---------------------------------------------------- | --------------------------------------------- | --- |
| HU-07-01 | Dashboard de admin (ejecutivo)     | 🟢 Hecho                                             | `HU-07-01-02-03-04-08-reportes`               | #30 |
| HU-07-02 | Dashboard de gerente (operativo)   | 🟢 Hecho                                             | `HU-07-01-02-03-04-08-reportes`               | #30 |
| HU-07-03 | Dashboard de cajero (caja del día) | 🟢 Hecho                                             | `HU-07-01-02-03-04-08-reportes`               | #30 |
| HU-07-04 | Reporte de ventas                  | 🟢 Hecho (filtros mesero/mesa + comparativo = Inc 2) | `HU-07-01-02-03-04-08-reportes`               | #30 |
| HU-07-05 | Reporte de inventario              | 🟢 Hecho                                             | `HU-07-05-06-07-10-reportes-ops`              | #31 |
| HU-07-06 | Reporte de food cost               | 🟢 Hecho                                             | `HU-07-05-06-07-10-reportes-ops`              | #31 |
| HU-07-07 | Reporte de mermas                  | 🟢 Hecho                                             | `HU-07-05-06-07-10-reportes-ops`              | #31 |
| HU-07-08 | Análisis Pareto de platos          | 🟢 Hecho                                             | `HU-07-01-02-03-04-08-reportes`               | #30 |
| HU-07-09 | Cierre Z (cierre del día)          | 🟢 Ya cubierto por E04 (cash-close)                  | `HU-04-03-08-split-cierre-z`                  | #27 |
| HU-07-10 | Exportación CSV                    | 🟢 Hecho (CSV; PDF/Excel futuro)                     | `HU-07-05-06-07-10-reportes-ops`              | #31 |
| HU-07-11 | Menu Engineering (Kasavana-Smith)  | 🟢 Hecho                                             | `e07/HU-07-11-12-menu-engineering-prime-cost` | —   |
| HU-07-12 | Prime Cost (food+labor / revenue)  | 🟢 Hecho                                             | `e07/HU-07-11-12-menu-engineering-prime-cost` | —   |

**E07: 12/12 backend** (Inc 1 #30 + Inc 2 #31 + Inc 3 HU-07-11/12). **Inc 2** (#31): reporte de inventario (valoración de stock), food cost (global + por plato), mermas (por insumo/razón) y **exportación CSV** (`?format=csv` en sales/inventory/food-cost/waste → RFC-4180, text/csv + Content-Disposition; PDF/Excel = futuro con librería, sin servicio externo). Solo agregación read-only, sin tablas/migración. **Backend construible COMPLETO (E01–E07).** Pendiente solo lo que requiere servicio externo: E08 forecasting + E09 chat (IA/FastAPI), E10 notificaciones + correos (invitaciones/OC/SUNAT), E11 ingesta (parseo AI de documentos).

**E07 Inc 1 (#30):** módulo `reports` (`ReportsController` + `ReportsService`). **Endpoints de agregación READ-ONLY: sin tablas nuevas ni migración** (incremento limpio, bajo riesgo). Base de todos los agregados = ventas **emitidas** (`Sale.status='issued'`) con `issuedAt` en la ventana `?from=ISO&to=ISO` (default = **hoy** en **America/Lima**, UTC-5; lógica pura en `report-window.util.ts` + unit spec). Moneda como **string** `.toFixed(2)`. **CASL (sin cambios en la matriz):** dashboards admin/gerente + reporte de ventas + Pareto = `read Report` (owner/manager; **staff → 403**); **dashboard de cajero** = `read Sale` (el `staff` ya lo tiene → **200**). Se respeta la frontera de módulos: los datos (`sales`/`payments`/`orders`/`order_items`/`dining_tables`/`ingredients`/`menu_items`) se leen **directamente** vía `runInTenant`; la **única** dependencia inyectada es `RecipesService` (exportado por `CatalogModule`, igual que E06) para el costo de ingredientes del margen/contribución. Endpoints: `GET /api/reports/dashboard/{cashier,manager,admin}`, `GET /api/reports/sales?from=&to=&groupBy=day|method|docType`, `GET /api/reports/pareto-dishes?from=&to=` (ABC: A ≤80% acumulado, B ≤95%, C resto). **HU-07-09 (Cierre Z)** NO se reconstruye: ya existe en **E04** (`/api/cash-close*`, `CashClose` inmutable). **Inc 2 (pendiente):** HU-07-05 (reporte de inventario), HU-07-06 (food cost), HU-07-07 (mermas), HU-07-10 (exportación PDF/Excel/CSV — requiere R2). Difiere también: filtros mesero/mesa + comparativo vs período anterior del reporte de ventas, "ventas vs forecast" (E08) y "tiempo de servicio" del dashboard de gerente.

## E10 — Notificaciones y Alertas (4 HU)

| HU       | Título                       | Estado                                            | Spec                          | PR  |
| -------- | ---------------------------- | ------------------------------------------------- | ----------------------------- | --- |
| HU-10-01 | Notificación in-app          | 🟢 Hecho                                          | `HU-10-01-03-notificaciones`  | #33 |
| HU-10-02 | Notificación por email       | 🔲 Diferido (correo/Resend)                       | —                             | —   |
| HU-10-03 | Preferencias de notificación | 🟢 Hecho                                          | `HU-10-01-03-notificaciones`  | #33 |
| HU-10-04 | Alertas accionables de IA    | 🟢 Hecho (`forecast_shortfall`, E10×E08, Lote B1) | `HU-10-04-forecast-shortfall` | —   |

**E10: 3/4 backend** (HU-10-04 cerrada en el Lote B1, ver abajo) — módulo nuevo `notifications` (`NotificationsController` + `NotificationsService`, registrado en `app.module.ts`). Dos tablas nuevas **`notifications`** y **`notification_preferences`** (RLS FORCE ambas, verificado `relforcerowsecurity='t'`; relaciones `Tenant→notifications`/`notificationPreferences`). **Notificaciones por usuario** (no nuevo sujeto CASL — son personales): cada usuario lee **las suyas** (dirigidas, `userId`) **más** las broadcast del tenant (`userId = null`); endpoints solo con `JwtAuthGuard`, alcance por `claims.sub`. **Crear es interno** (service-to-service vía `NotificationsService.create`/`createTx` tx-aware — espeja `RecipesService.costPerYieldTx`); **sin endpoint público** para crear. **HU-10-01:** `GET /api/notifications?unreadOnly=&limit=` → `{ items:[{id,type,title,body,data,readAt,createdAt}], unreadCount }` (desc por `createdAt`; `unreadCount` = badge, cuenta TODAS las no leídas ignorando filtros), `POST /api/notifications/:id/read` (404 si no es suya/broadcast; idempotente), `POST /api/notifications/read-all` → `{updated}`. `type`: `low_stock|order_ready|bill_requested|system`; `data Json?` lleva el deep-link/action button. **HU-10-03:** `GET /api/notifications/preferences` → `{items:[{type,inApp,email}]}` (default = `inApp:true,email:false` para tipos sin fila), `PATCH /api/notifications/preferences {type,inApp?,email?}` (upsert, `@@unique[tenantId,userId,type]`). **El sistema respeta la preferencia al crear:** dirigida → mira la fila del usuario; broadcast → se omite si existe un opt-out (`inApp=false`) de ese tipo en el tenant (correcto en el piloto mono-usuario; filtrado por-destinatario multi-usuario = futuro). **Trigger real cableado (POS↔inventario↔notificaciones, HU-05-10 → notificación):** `InventoryModule` importa `NotificationsModule`; `InventoryService` inyecta `NotificationsService` y, en `createMovement`, dentro de la **misma** `runInTenant` y tras aplicar el delta, emite una notificación `low_stock` **broadcast** (`userId=null`, vía `createTx`) **solo cuando el movimiento CRUZA el umbral**: stock **previo ≥ minStock** y **nuevo < minStock** (crossing-only = idempotente → no spamea en cada salida posterior estando ya bajo; sin umbral `minStock≤0` nunca cruza; el cruce a crítico reutiliza la misma notificación con `status` en `data`). **HU-10-02 email** diferido → **Resend** (servicio de correo, como E01; `NotificationPreference.email` reserva el canal). **HU-10-04 alertas de IA** → cerrada en el **Lote B1** (`forecast_shortfall`, ver abajo). Tests: `test/notifications.e2e-spec.ts`. **PUSH** fuera de alcance (sin app móvil).

**Lote B1 (E10×E08) — Notificaciones proactivas del forecast (`HU-10-04`) + evaluación realizada del modelo (`HU-08-08`).** Dos features backend-only:

- **`forecast_shortfall`** (`HU-10-04-forecast-shortfall.spec.md`): al completar una corrida `scope='total'`, se reusa `shoppingSuggestions` (HU-08-06) para detectar insumos en déficit y notificar a **owner/manager** (dirigida, NO broadcast — `staff` no gestiona compras). Nuevo `NotificationsService.createForRolesTx` (roles vía `hasSome` sobre `User.roles`) + `isDedupSuppressed` (antispam: JSON path `data.dedupKey`, ventana 24h o no-leída — sin esto, el cron semanal HU-08-03 + corridas manuales spamearían el mismo shortfall). Agrupa en UNA notificación si hay > 3 insumos (`forecast-shortfall.util.ts`, puro/testeable); menciona el driver exógeno (HU-08-07) más narrable. `ForecastingModule` importa `NotificationsModule` (mismo patrón de import directo que `InventoryModule`→`low_stock`). Verificado que el frontend tolera el tipo nuevo sin cambios (`notifications-adapter.ts` coerciona a `system`/`info`).
- **`GET /forecasting/accuracy`** (`HU-08-08-accuracy.spec.md`): combina TODAS las corridas `completed` del ámbito (a diferencia de `/validation`, que solo mira la última) — merge multi-corrida (la más reciente gana el día repetido), SMAPE realizado (agregado a `compareForecastVsActual`, no se rompe con `actual=0`) + MAPE + cobertura del intervalo. Nunca 404/500: `needsMoreData:true` (200) con pocos días transcurridos o sin corridas.
- **Bugfix bloqueante encontrado en el camino**: `driverKindSchema` (`src/shared/forecasting/forecast.ts`) no incluía `'payday'` — `core-ai` (desarrollo paralelo del otro equipo) ya emite ese `kind` en `drivers`, y cualquier corrida real con una quincena en el horizonte rompía la validación Zod de la respuesta (`test/forecast-async.e2e-spec.ts` en rojo). Se agregó `'payday'` al enum (aditivo, sin migración — es un campo `Json`).
- Migración: **ninguna** (ambas features reusan tablas/columnas existentes — `Notification.data Json?` para el `dedupKey`, `ForecastRun.points/drivers` para `/accuracy`). Suite: **202 unit** (+9) / **307 e2e** (+6) verdes.

## E11 — Migración desde ERPs Legacy (5 HU)

| HU       | Título                                                  | Estado                                 | Spec                                  | PR  |
| -------- | ------------------------------------------------------- | -------------------------------------- | ------------------------------------- | --- |
| HU-11-01 | Wizard de migración guiado                              | 🔲 Frontend (pasos UI; pausar/retomar) | —                                     | —   |
| HU-11-02 | Importar productos desde Excel/CSV                      | 🟢 Hecho (= HU-02-02)                  | `e02/HU-02-02-import-insumos`         | #16 |
| HU-11-03 | Importar histórico de ventas                            | 🟢 Hecho                               | `HU-11-03-04-05-sales-history-import` | #34 |
| HU-11-04 | Idempotencia de la importación                          | 🟢 Hecho                               | `HU-11-03-04-05-sales-history-import` | #34 |
| HU-11-05 | Validar/identificar errores antes de importar (dry-run) | 🟢 Hecho                               | `HU-11-03-04-05-sales-history-import` | #34 |

**E11: 4/5 backend** (HU-11-02 ya por HU-02-02). Módulo nuevo **`ingestion`** (`SalesHistoryController` + `SalesHistoryImportService` + `SalesHistoryService`, registrado en `app.module.ts`). Tabla nueva **`sales_history`** (RLS FORCE, verificado `relforcerowsecurity='t'`; relación `Tenant→salesHistory`; índices `tenantId` y `(tenantId, soldOn)`; **`@@unique([tenantId, externalRef])`** para idempotencia — Postgres permite múltiples `NULL`). Espeja el importador probado de insumos **HU-02-02** (`parseCsv` RFC-4180, alias de cabecera ES/EN, validación Zod por fila, dedup en archivo, reporte `{total,created,updated,failed,errors:[{line,message}]}`). **NO crea Orders/Sales** — es una tabla dedicada de histórico (arranque de reportes/forecasting; cold-start). **HU-11-03:** `POST /api/sales-history/import` (`manage Report`, `@Audited('sales_history.import')`) body `{content, dryRun?}`; columnas `date|fecha`, `dish|plato|nombre`, `qty|cantidad`, `unitPrice|precio` y/o `total`, `ref|externalRef` (opcional); deriva el par precio/total (`total=unitPrice·qty` / `unitPrice=total/qty`); enlaza `menuItemId` por match EXACTO con un plato **activo** (si no, `null` — no FK dura); tope MAX 20 000 filas. `GET /api/sales-history?from=&to=` (`read Report`) → `{from,to,totalQty,totalRevenue,rows:[{soldOn,dishName,menuItemId,qty,unitPrice,total}]}` (ventana ISO opcional, default "hoy" Lima — lógica replicada inline para no acoplar `reports`; totales sobre toda la ventana, `rows` cap 5 000). **HU-11-04 idempotencia:** clave `(tenantId, externalRef)` si la fila trae `ref`, si no clave natural `(tenantId, soldOn, dishName, qty, unitPrice)` → rerun **actualiza** (no duplica) y el reporte distingue `created` vs `updated`; `ref` repetida en archivo = error; fila natural-key repetida en archivo = se omite. **HU-11-05 dry-run:** `dryRun=true` valida TODO (formato, fecha parseable, qty>0, monto≥0, duplicados) y **NO escribe nada** (`created=0`), devolviendo `errors:[{line}]` (el paso "Validar" del wizard); importación parcial soportada (las válidas entran aunque otras fallen). **RBAC:** importar = migración/gestión → reutiliza `Report` (owner/manager `manage Report`; **staff → 403**); leer = `read Report` (staff → 403). **No se modifica la matriz CASL.** `tenant_id` SIEMPRE del JWT; todo vía `runInTenant`. Moneda/qty string (`.toFixed(2)`). **Diferido:** HU-11-01 wizard = frontend; **magic-upload R2/IA** (archivo original a R2 + mapeo asistido por IA) requiere Cloudflare R2 + E08; **SalesDailyAggregate + umbrales de forecasting 6/12 meses** (Gherkin HU-11-03) = E08/IA (aquí se persiste el detalle, fuente de esa agregación). Tests: `test/sales-history-import.e2e-spec.ts` (8 casos).

## E12 — Plataforma (lo tocado)

| HU       | Título                         | Estado                            | Spec                         | PR  |
| -------- | ------------------------------ | --------------------------------- | ---------------------------- | --- |
| HU-12-02 | Health checks                  | 🟢 Hecho (E12-1: readiness + 503) | `HU-12-02-health-y-contrato` | #3  |
| HU-12-06 | Aislamiento multi-tenant (RLS) | 🟢 Hecho (4 vectores)             | `HU-12-06-rls-aislamiento`   | #4  |

## E13 — Personal (épica nueva, fuera del backlog E01–E12)

| HU       | Título                                                | Estado   | Spec                 | PR  |
| -------- | ----------------------------------------------------- | -------- | -------------------- | --- |
| HU-13-01 | Registro de empleados (planilla) con salario sensible | 🟢 Hecho | `HU-13-01-empleados` | #42 |

Registro básico de personal por tenant (RLS FORCE; `@@unique[tenant_id, dni]`; vínculo opcional con `users`). Salario con field-level gating (owner-only) además del RBAC (`Employee`: owner/manager gestionan, staff 403). Base para costeo de mano de obra (E06) futuro. 15 e2e + 9 unit.

## Integración frontend ↔ backend

- Auth (login/register) integrada y validada E2E (frontend PR #1).
- Proxy autenticado del BFF (`backendFetch`) + `/api/users` (frontend PR #2). Rutas de dominio (recipes/inventory/…) siguen mock hasta E02–E05.

## Infra foundational (transversal — no es una HU)

`src/shared/` (contrato Zod), `PrismaService.runInTenant`, `ZodValidationPipe`, `JwtAuthGuard`,
`PoliciesGuard`/CASL, `AuthDbClient`/`gastronomia_auth`, `AuditInterceptor`.

## E08 — Forecasting de demanda con IA (8 HU)

| HU       | Título                                         | Estado                                                         | Spec                                                     | PR  |
| -------- | ---------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------- | --- |
| HU-08-01 | Configurar parámetros de forecasting           | 🟡 Parcial (inline, sin endpoint dedicado)                     | —                                                        | —   |
| HU-08-02 | Ejecutar forecast manual                       | 🟢 Hecho                                                       | `HU-08-02-async-forecast` / `HU-08-02-sales-aggregation` | —   |
| HU-08-03 | Ejecutar forecast automático semanal           | 🟢 Hecho                                                       | `HU-08-03-weekly-cron`                                   | —   |
| HU-08-04 | Ver predicciones por plato                     | 🟢 Hecho (`GET /predictions`)                                  | `HU-08-02-async-forecast`                                | —   |
| HU-08-05 | Comparar predicción vs realidad                | 🟢 Hecho                                                       | `HU-08-05-validation`                                    | —   |
| HU-08-06 | Sugerencias de compra basadas en forecast      | 🟢 Hecho                                                       | `HU-08-06-shopping-suggestions`                          | —   |
| HU-08-07 | Variables exógenas peruanas (calendario+clima) | 🟢 Hecho (fase 2/3 — backend)                                  | `HU-08-07-forecast-context`                              | —   |
| HU-08-08 | Evaluación del modelo (MAPE, sMAPE)            | 🟢 Hecho (multi-corrida, `GET /forecasting/accuracy`, Lote B1) | `HU-08-08-accuracy`                                      | —   |

**E08: 8/8 hechas.** `core-ai` (FastAPI) infiere; NestJS orquesta (`ForecastingModule`: `CoreAiClient` HTTP + BullMQ `ForecastProcessor`/`ForecastScheduler` + `ForecastingService`/`Controller`). **HU-08-07 fase 1/3** (core-ai: calendario peruano `holidays.PE` + calendario gastronómico curado, clima Open-Meteo, motor `ml` LightGBM, `drivers`/`context_status`/`backtest.model_smape_no_context`) ya estaba desplegada y verificada en `gastronomia-core-ai` — ver `team-core-ai/README.md` §"Exogenous context — HU-08-07". **Esta fase 2/3 (backend NestJS)**: toda corrida de negocio pide `use_context: true` + `engine: "auto"` (nunca `"ml"` hardcodeado — core-ai decide según historia disponible); `location` usa las coordenadas del tenant si existen (`Tenant.latitude/longitude`, columnas nuevas nullable, solo plumbing — sin UI todavía); se persisten `drivers`/`context_status` en `ForecastRun` (migración aditiva `20260702054111_forecast_context`); `shopping-suggestions` expone `drivers`/`contextStatus` de la corrida usada; nuevo `GET /forecasting/insights` (resumen narrable para el dashboard de gestión, `read Report`, staff 403). **Fase 3/3 (frontend)** queda para el siguiente incremento. **HU-08-01** no tiene un endpoint de configuración persistente dedicado — los parámetros (`scope`, `horizon`, `engine`, `from/to`) viajan inline en `POST /forecasting/run`; se marca parcial a propósito (no se inventa una feature de configuración no solicitada). Tests: `test/forecast-async.e2e-spec.ts`, `test/forecast-cron.e2e-spec.ts`, `test/forecast-validation.e2e-spec.ts`, `test/forecasting.e2e-spec.ts`, `test/forecast-context.e2e-spec.ts` (nuevo, HU-08-07 fase 2).

## E09 — Chat IA: Asistente analítico Text-to-SQL (1 HU)

| HU       | Título                                          | Estado   | Spec                       | PR  |
| -------- | ----------------------------------------------- | -------- | -------------------------- | --- |
| HU-09-01 | Consulta analítica en lenguaje natural (NL→SQL) | 🟢 Hecho | `e09/HU-09-01-chat-nl2sql` | —   |

**Arquitectura:** NestJS `chat` module (ChatController + ChatService + CoreAiChatClient) ↔ core-ai `chat` feature (router + service + adapters: mock/openai/anthropic/xai + registry).

**Seguridad (defense-in-depth):**

1. SQL validation hard gate: 9 reglas (validateSql) — rechaza todo lo que no sea un SELECT read-only puro sobre el allowlist de tablas.
2. RLS FORCE: ejecución bajo `runInTenant` — la consulta sólo ve filas del tenant del JWT.
3. `SET LOCAL statement_timeout = '5000'` — timeout de 5s para prevenir DoS por queries costosas.
4. R10 (bugfix 2026-07-02): fallo de EJECUCIÓN del SQL ya validado (columna/tabla inexistente, timeout) se mapea a 502/504 controlado — nunca un 500 sin manejar (ver `ChatService.mapExecutionError`).

**Bugfix 2026-07-02 (QA scout, blocker demo):** `POST /api/chat/query` con "¿Qué insumos están por agotarse?" devolvía 500 (Postgres 42703 `column i.current_cost does not exist`) y "¿qué insumos tienen stock bajo?" respondía falsamente "no hay". Root cause: `src/chat/schema-context.ts` (el `schema_context` curado enviado al LLM) estaba desincronizado de `prisma/schema.prisma` — describía columnas inexistentes en `ingredients` (`current_cost`/`unit_id`/`category_id`/`is_active`) y omitía `stock`/`min_stock`; el mismo tipo de drift se encontró y corrigió en `orders`, `payments`, `menu_categories`, `recipes`, `recipe_items`, `inventory_movements`, `purchase_orders`, `purchase_order_items`, `overhead_costs`, `costing_closes`, `forecast_runs`, `suppliers`, `units_of_measure`, `categories`, `zones`, `dining_tables`, `cash_closes`. Fix: (1) `schema-context.ts` reescrito columna-por-columna contra el schema real; (2) `ChatService.query` ahora envuelve la ejecución en try/catch y clasifica el error (502 SQL no ejecutable / 504 timeout) — ver detalle en `specs/e09/HU-09-01-chat-nl2sql.spec.md` §3.1.

**Tests:** `src/chat/sql-validator.util.spec.ts` (validator, 40+ unit tests cubriendo los 9 vectores de ataque) + `src/chat/chat.service.spec.ts` (mapeo de errores de ejecución 502/504 + clasificación LOTE B3) + `src/chat/schema-context.spec.ts` (guarda de regresión columna-por-columna) + `test/chat.e2e-spec.ts` (happy path, RBAC staff 403/401, 10 security vectors, RLS cross-tenant isolation, degradación de ejecución 502, low-stock contra `ingredients.stock/min_stock` reales, LOTE B3 futuro/fuera-de-dominio/ambiguo).

**Proveedores LLM:** mock (sin key, CI/demo) · openai (OPENAI_API_KEY) · anthropic (ANTHROPIC_API_KEY) · xai (XAI_API_KEY). Auto-select via `CORE_AI_CHAT_PROVIDER`.

**Refinamiento LOTE B3 (2026-07-02, QA-08) · preguntas sobre el futuro + rechazo elegante fuera de dominio.** Repro: "¿quién ganó el mundial?"/"¿cómo va todo?" producían un `SELECT` masivo y un volcado de cientos de UUIDs antes de admitir que no había info relevante; "¿cuánto voy a vender este fin de semana?" (pregunta sobre el FUTURO) no tenía respuesta posible vía NL→SQL (no existen "ventas futuras" en `sales_history`). Fix: `ChatService.query` clasifica la pregunta (`src/chat/intent-classifier.util.ts`, heurística determinística keywords+fechas — NO un paso de LLM, ver justificación completa en el spec §3.2 y en el JSDoc del archivo: este lote no puede tocar `team-core-ai`, y un gate determinístico antes de cualquier LLM es una garantía de seguridad más dura, exhaustivamente unit-testeable) ANTES de decidir si llama a core-ai: `future` → responde desde la última `ForecastRun` `completed` (scope=total) del tenant vía `ForecastingService.getForecastForRange` (import directo de servicio, `ChatModule → ForecastingModule`, mismo patrón que `ForecastingModule → NotificationsModule` de Lote B1; `ForecastingModule` ahora exporta `ForecastingService`), con disclaimer honesto y SIN disparar una corrida nueva automáticamente (sin corrida o rango fuera del horizonte → lo explica); `out_of_domain`/`ambiguous` → rechazan/piden precisión SIN llamar a core-ai ni ejecutar SQL; `historical` es el flujo original R1-R10 sin cambios. Respuesta aditiva y opcional (`kind`, `forecast`) — el adapter del frontend (`team-frontend/server/api/chat/query.post.ts`) sigue funcionando sin cambios (LOTE F2b puede consumir los campos nuevos). Reconocimiento de rango temporal en español (`src/chat/lima-date.util.ts`): "mañana", "pasado mañana", "este fin de semana", "esta semana", "la próxima semana", "este mes", "el próximo mes" (con rollover de año). Detalle: `specs/e09/HU-09-01-chat-nl2sql.spec.md` §3.2 (R11-R15). Tests: `src/chat/intent-classifier.util.spec.ts` (21) + `src/chat/lima-date.util.spec.ts` (10) + `src/chat/chat.service.spec.ts` (+7, incluye asserts de "nunca llega al executor") + `test/chat.e2e-spec.ts` (+9, incluye verificación de que NO se crea una `ForecastRun` nueva en los casos `needsForecast`/`outOfHorizon`).

## QA fixes pre-demo (2026-07-02, reporte QA usuario final)

Tres defectos reportados por QA sobre la demo (`REPORTE_QA_USUARIO_FINAL_v1.md`), en orden de severidad. Ninguno requirió nuevas tablas de RLS (aditivos sobre `orders`/`sales` o endpoints nuevos read-only); ninguno tocó `team-frontend`.

- **QA-02 (HIGH) · El descuento aplicado NO se cobra.** Root cause: el descuento **no existía en el backend** (ni persistencia ni endpoint) — el frontend solo lo previsualizaba localmente y su BFF descartaba el campo a propósito. Fix: `Order`/`Sale` ganan `discount_type/value/reason` (+`discount_amount` en `Sale`, snapshot inmutable del cobro); `POST/DELETE /api/orders/:id/discount` (`update Sale`, manager/owner — mismo gate que anular ticket); `BillingService.computeTotals` (única fuente de verdad para pre-bill/pay/split) resta el descuento del bruto ANTES del IGV; `split` reparte el descuento proporcionalmente en modo `items`. Detalle: `specs/e04/HU-04-01-02-04-05-06-07-billing.spec.md` §"Refinamiento QA-02". Tests: `test/discount.e2e-spec.ts` (9) + `test/split.e2e-spec.ts` (+2).
- **QA-06 (MEDIUM) · Panel "Usado en (0 recetas)" pese a BOM activo.** Root cause: NO existía un endpoint reverse-lookup insumo→recetas (`GET /api/recipes` da `RecipeSummary` sin `items` a propósito; el frontend filtraba esa respuesta, siempre vacía). Fix: `GET /api/ingredients/:id/recipes` (`read Catalog`) vía `RecipesService.usedByIngredient` (join directo `recipe_items→recipes`, tenant-scoped). Detalle: `specs/e02/HU-02-07-09-recipes.spec.md` §"Refinamiento QA-06". Tests: `test/ingredient-recipes.e2e-spec.ts` (4).
- **QA-07 (MEDIUM) · Card "HOY" de comprobantes = acumulado histórico.** Root cause: la card sumaba `GET /api/sales` completo (listado histórico, sin ventana de fecha — correcto para la grilla) y lo llamaba "Hoy". Fix: `GET /api/sales/today-summary` (`read Sale`) agrega el día calendario **America/Lima** server-side (`src/billing/lima-day.util.ts`, réplica local — no cross-import de `reports`, mismo criterio que `ingestion`). Detalle: `specs/e04/HU-04-03-08-split-cierre-z.spec.md` §"Refinamiento QA-07". Tests: `src/billing/lima-day.util.spec.ts` (5 unit, cruce de medianoche) + `test/today-summary.e2e-spec.ts` (3 e2e, venta "de ayer" retrocedida 25h no cuenta).
- **Gap de frontend reportado (no corregido aquí):** la card "Hoy" de `team-frontend/app/pages/app/comprobantes/index.vue` debe consumir `GET /api/sales/today-summary` (o filtrar por día Lima) en vez de sumar `sales.value` completo.

Migración: `20260702034301_discount_fields` (ALTER TABLE aditivo sobre `orders`/`sales`, sin RLS nueva — las tablas ya tenían RLS FORCE). Suite: unit 189/189 (+5), e2e 293/293 (+18).

## Próximas épicas

E02 (catálogo/recetas) → E03 (POS) → E04 (cobros) → E05 (inventario) → E06 (costeo) → E07 (reportes) → E08 (forecasting) → E09 (chat) → E10 (notificaciones) → E11 (ingesta de histórico) **hechos** (backend construible). Diferidos de E01/E10/E11: correo, R2, agregación. Cada backend habilita proxear sus rutas del BFF.
