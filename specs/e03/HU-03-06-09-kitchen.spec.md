# HU-03-06/07/08/09 — Cocina / KDS (enviar comanda, vista por estación, preparando, listo)

> **Épica:** E03 · **Sprint:** S2 · **Must** · **Estado:** 🟢 hecho (Incremento C — cocina/KDS).

Un modelo nuevo (RLS FORCE): **`kitchen_stations`** (puesto de cocina: parrilla, frío, barra…). `menu_categories` gana **`kitchen_station_id`** (FK opcional) para enrutar los platos de una categoría a una estación. Controller `@Controller('kitchen')` (`JwtAuthGuard` + `PoliciesGuard`), subject CASL **`Kitchen`** (staff `read` + `update`; manager/owner gestionan). Más `POST /api/orders/:id/send-to-kitchen` en el módulo de órdenes y un read-model de mesas que desbloquea el POS del frontend. Todo el acceso vía `runInTenant` (tenant_id solo del JWT). Real-time aún por **polling** (push SSE = mejora).

## HU-03-06 · Enviar comanda a cocina
```gherkin
WHEN el mesero envía la orden a cocina
THEN la orden pasa a 'sent_to_kitchen' AND cada ítem pendiente queda enviado con su estación
```
**Implementado ✅:** `POST /api/orders/:id/send-to-kitchen` (sin body). La orden debe estar **`open`** (si no → **409**) con **≥1 ítem `pending`** sin enviar (si no → **400**). Pone `order.status = 'sent_to_kitchen'` y `order.sentToKitchenAt = now`. Por cada ítem `pending` con `sentToKitchenAt` null: sella `sentToKitchenAt = now` y resuelve `kitchenStationId` = `menuItem → menuCategory → kitchenStationId` (**puede quedar `null`** si la categoría no tiene estación o el plato no tiene categoría). El `status` del ítem **sigue `pending`** hasta que cocina lo tome (HU-03-08). Devuelve la `OrderView`. `@Audited('order.send_to_kitchen')`.

## HU-03-07 · Vista KDS por estación + estaciones (CRUD)
```gherkin
WHEN el cocinero abre el KDS de su estación
THEN ve los ítems pendientes/en preparación de esa estación ordenados por antigüedad AND marca los retrasados
```
**Implementado ✅:** `GET/POST/PATCH/DELETE /api/kitchen/stations` (CRUD). Lectura = **staff** (`read Kitchen`); crear/editar/eliminar = **manager** (`create`/`update`/`delete Kitchen` → staff `create`/`delete` da **403**). Borrar estación con categorías de menú asociadas → **409** (re-enrutar antes; soft-delete). `@Audited` en mutaciones.

`GET /api/kitchen/queue?stationId=<uuid?>` (`read Kitchen`): ítems con `status ∈ {pending, preparing}` que **fueron enviados a cocina** (`sentToKitchenAt` no null), opcionalmente filtrados por `stationId`, **ordenados por `sentToKitchenAt` asc** (FIFO). Cada ítem: `{ orderItemId, orderId, tableCode, dishName, qty, modifiers, notes, status, sentToKitchenAt, waitMinutes, isLate }` con `waitMinutes = floor((now − sentToKitchenAt)/60000)` e `isLate = waitMinutes > 10`.

## HU-03-08 · Marcar ítem en preparación · HU-03-09 · Marcar ítem listo
```gherkin
WHEN el cocinero marca un ítem en preparación / listo
THEN se registra preparingAt / readyAt AND solo se permiten transiciones hacia adelante
```
**Implementado ✅:** `PATCH /api/kitchen/items/:itemId { status: 'preparing' | 'ready' }` (`update Kitchen`). `preparing` sella `preparingAt = now`; `ready` sella `readyAt = now`. **Transiciones válidas:** `pending → preparing → ready` (cualquier otra → **409**; ítem no enviado a cocina → **400**). Al pasar a `ready` el ítem **sale de la cola** (solo `pending|preparing`). Devuelve la vista del ítem (mismo shape que la cola). `@Audited('kitchen.item.update')`. (El paso final `ready → served` lo hace el mesero vía `PATCH /api/orders/:id/items/:itemId { status: 'served' }`, HU-03-10.)

## POS read-model (desbloquea el POS del frontend)
El Inc B no permitía hallar la orden actual de una mesa. Añadido:
- **`GET /api/tables/:id`** (`read Table`) → `{ table: TableView, order: OrderView | null }`. `order` = la orden actual de la mesa (`status ∈ {open, sent_to_kitchen, served}`, `deleted_at` null), o `null` si está libre.
- **`GET /api/tables`** (`TableView`) enriquecido con `currentOrderId`, `openedAt`, `guests`, `waiterId` derivados de esa orden actual (todos `null` cuando la mesa está libre). Una sola consulta de órdenes (sin N+1) reutilizando `OrdersService`.

## Contrato — vistas
- **KitchenStationView:** `{ id, name, position }`.
- **KitchenItemView:** `{ orderItemId, orderId, tableCode, dishName, qty, modifiers: {name,priceDelta:number}[], notes: string|null, status, sentToKitchenAt(ISO), waitMinutes: number, isLate: boolean }`.
- **TableDetailView (`GET /api/tables/:id`):** `{ table: TableView, order: OrderView | null }`.
- **TableView (enriquecida):** `{ id, zoneId, zoneName, code, capacity, status, posX, posY, currentOrderId: string|null, openedAt: string|null, guests: number|null, waiterId: string|null }`.
- **MenuCategoryView:** gana `kitchenStationId: string|null` (set/unlink vía `POST`/`PATCH /api/menu/categories`).

## RBAC
Subject **`Kitchen`** (ya en `CaslAbilityFactory`): **staff** `can('read','Kitchen')` + `can('update','Kitchen')` → opera el KDS (cola, marcar preparando/listo); **manager/owner** gestionan estaciones (`create`/`update`/`delete`). Enviar a cocina va por subject `Order` (staff `update`). `@Audited` en enviar a cocina / CRUD de estaciones / transición de ítem.

## Multi-tenant
`kitchen_stations` con `tenant_id NOT NULL`, RLS FORCE + policy `tenant_isolation` (`NULLIF(current_setting('app.tenant_id', true), '')::uuid`), verificado `relforcerowsecurity = t`. La FK `menu_categories.kitchen_station_id` es `ON DELETE SET NULL` (defensa extra; el borrado de estación con categorías ya se bloquea en la capa de servicio con 409).

## Trazabilidad → test
`test/kitchen.e2e-spec.ts` (siembra tenant, owner+staff, zona + mesa libre cap 4, insumo, receta, **categoría** de menú enlazada a estación, plato en esa categoría precio 50). Flujo HTTP: staff **no** crea estación → **403**, owner sí (manager); enlaza categoría→estación; abre orden + 1 ítem; **send-to-kitchen** → ítem con `sentToKitchenAt` + estación, orden `sent_to_kitchen`, reenviar → **409**; `GET /api/kitchen/queue?stationId` lo devuelve con `waitMinutes 0`, `isLate false`; `PATCH` ítem `pending→ready` directo → **409**, luego `preparing` y `ready` (timestamps), `ready` sale de la cola; `GET /api/tables/:id` devuelve la orden actual; `GET /api/tables` muestra `currentOrderId` poblado.
