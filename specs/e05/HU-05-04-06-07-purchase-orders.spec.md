# HU-05-04/05/06/07 — Órdenes de Compra (crear, enviar, recepcionar, cancelar)

> **Épica:** E05 · **Sprint:** S3–S4 · **Must/Could** · **Estado:** 🟢 hecho (Incremento 2). HU-05-05 🟡 solo transición de estado (envío por correo/PDF diferido).

Segundo incremento de E05. Formaliza las compras a proveedores con una **orden de compra (OC)** multi-línea y su máquina de estados, y cierra el lazo con el kardex de Inc 1: **recepcionar** una OC crea movimientos de inventario `type='purchase'` y **sube el stock** del insumo (misma transacción `runInTenant`, misma forma de movimiento que Inc 1).

Extiende el módulo `inventory` (no crea uno nuevo): añade `PurchaseOrdersController` (`@Controller('purchase-orders')`) + `PurchaseOrdersService`, registrados en `inventory.module.ts`. Subject CASL **`Inventory`** (ya existía, sin cambios): **staff** `read`; **manager/owner** `manage`. Dinero/cantidades como **string** (Prisma.Decimal `.toFixed()`), nunca `number`. `tenant_id` solo del JWT; todo el acceso vía `runInTenant`.

## Alcance del incremento
**Construido:** HU-05-04 (crear OC), HU-05-06 (recepcionar OC parcial/total → mueve inventario + sube stock), HU-05-07 (cancelar OC). HU-05-05 **solo la transición `draft→sent`**.

**Diferido por servicio externo:** HU-05-05 — el **envío del email al proveedor con el PDF adjunto** requiere un servicio de correo (Resend) + render de PDF (como las invitaciones de E01, diferidas). Este incremento solo cambia el estado a `sent` y deja la OC inmutable para recepción; el dispatch real se conectará cuando exista el servicio de correo (E10). **HU-05-11** (detectar anomalías de mermas con IA) = **servicio de IA / E08**, diferido.

## Máquina de estados de la OC
`draft → sent → partially_received → received` (terminal); `cancelled` (terminal). Transiciones:
- **crear** → `draft`.
- **enviar** (`/send`): `draft → sent`. Cualquier otro estado → **409**.
- **recepcionar** (`/receive`): permitido solo en `{sent, partially_received}` (else **409**). Recalcula: todas las líneas con `qtyReceived = qtyOrdered` → `received`; si alguna `0 < qtyReceived < qtyOrdered` (o aún 0 con otras recibidas) → `partially_received`.
- **cancelar** (`/cancel`): permitido solo en `{draft, sent}` (else **409**; en particular NO se puede cancelar una OC `received` ni `partially_received` — ya movió inventario). → `cancelled`.

> Nota de diseño vs. Gherkin: el backlog usa nombres en MAYÚSCULAS español/inglés (DRAFT/SENT/PARTIAL/RECEIVED/CANCELLED). Se implementa en **minúscula inglés** (`draft|sent|partially_received|received|cancelled`) para alinear con la convención del repo (`orders`, `order_items`). El Gherkin de HU-05-07 admite cancelar desde PARTIAL; aquí se restringe a `{draft, sent}` porque una OC parcial ya generó movimientos de inventario irreversibles (cancelarla descuadraría el kardex); la cancelación es para OCs que aún no recibieron nada.

## HU-05-04 · Crear orden de compra
```gherkin
GIVEN gerente con proveedores activos
WHEN crea OC con items (producto, cantidad, precio)
THEN se calcula el total
AND queda en estado DRAFT
AND puede editarse antes de enviar
```
**Implementado ✅:** `POST /api/purchase-orders` (`create Inventory`, `@Audited('po.create')`). Body `{ supplierId: uuid, expectedAt?: ISO, notes?: string, items: [{ ingredientId: uuid, qtyOrdered: number > 0, unitCost: number ≥ 0 }] (mín. 1) }`. En una transacción: valida que el **proveedor exista** (no borrado) → si no, **400**; valida que **cada insumo exista** (no borrado) → si no, **400**; crea la OC en estado `draft` con sus líneas (`qtyReceived = 0`). Devuelve `POView`.

El `total = Σ qtyOrdered·unitCost` se calcula en vivo en la vista (string, 2 decimales). El IGV del Gherkin se difiere a E04/E06 (costeo/cobros); la OC registra precios de compra (costo), no precios de venta con impuesto.

`GET /api/purchase-orders` (`read Inventory`): lista las OCs no borradas (desc por `createdAt`) con sus líneas y `total`. `GET /api/purchase-orders/:id` (`read Inventory`): una OC; inexistente → **404**.

## HU-05-05 · Enviar OC al proveedor (solo estado)
```gherkin
GIVEN OC en DRAFT
WHEN gerente hace click en "Enviar"
THEN se cambia estado a SENT
AND (diferido) se envía email al proveedor con PDF adjunto
AND se registra fecha de envío
```
**Implementado 🟡 (solo transición):** `POST /api/purchase-orders/:id/send` (`update Inventory`, `@Audited('po.send')`). `draft → sent`; cualquier otro estado → **409**. **El email/PDF al proveedor está diferido** (servicio de correo externo, como las invitaciones de E01) — un comentario en el servicio lo documenta. Devuelve `POView`.

## HU-05-06 · Recepcionar OC (parcial o total)
```gherkin
GIVEN OC en SENT
WHEN gerente recepciona ingresando cantidades por item
THEN se crea InventoryMovement type=PURCHASE por cada item
AND si todas las cantidades = ordered → estado RECEIVED
AND si alguna < ordered → estado PARTIAL
AND se actualiza last_purchase_price
```
**Implementado ✅:** `POST /api/purchase-orders/:id/receive` (`update Inventory`, `@Audited('po.receive')`). Body `{ items: [{ itemId: uuid, qtyReceived: number > 0 }] (mín. 1) }`. Solo permitido si la OC está en `{sent, partially_received}` → si no, **409**. En **una sola** transacción `runInTenant`, por cada línea recibida:
- valida que el `itemId` pertenece a la OC → si no, **400**;
- `qtyReceived` acumulado **no puede exceder** `qtyOrdered` → si lo excede, **400** (`recibido + nuevo > ordenado`);
- suma a `purchaseOrderItem.qtyReceived`;
- crea un **`inventory_movements`** (misma forma que Inc 1) con `type='purchase'`, `qty = +qtyReceived` (delta positivo), `note` referenciando la OC (`Recepción OC <id>`), `userId = claims.sub`;
- **sube `ingredient.stock`** en `qtyReceived` (reutiliza la lógica de Inc 1: stock += delta);
- actualiza `ingredient.unitCost = unitCost` de la línea (**último precio de compra**, `last_purchase_price`).

Tras aplicar todas las líneas, recalcula el estado de la OC: si **todas** las líneas tienen `qtyReceived = qtyOrdered` → `received`; si hay algo recibido pero no todo → `partially_received`. Devuelve `POView`.

> Reutiliza la semántica del kardex de Inc 1 (`InventoryMovement` = delta con signo sumado al stock); la entrada de compra es un delta **positivo**. El stock no puede quedar negativo (aquí siempre sube). El `unitCost` sí se muta (a diferencia de Inc 1, que no lo tocaba): la recepción fija el costo de compra real.

## HU-05-07 · Cancelar OC
```gherkin
GIVEN OC en DRAFT o SENT (no recibida)
WHEN gerente la cancela
THEN cambia a CANCELLED
AND ya no se puede recepcionar
AND queda en histórico para auditoría
```
**Implementado ✅:** `POST /api/purchase-orders/:id/cancel` (`update Inventory`, `@Audited('po.cancel')`). Permitido solo en `{draft, sent}` → estado `cancelled`. Una OC `received` o `partially_received` (ya movió inventario) → **409** (no se puede cancelar lo ya recibido). La OC cancelada permanece (soft-delete `deletedAt` no se usa aquí; el estado `cancelled` la conserva en histórico). Devuelve `POView`.

## Contrato — endpoints
| Método | Ruta | Ability | Body | Respuesta (`data`) |
|---|---|---|---|---|
| POST | `/api/purchase-orders` | `create Inventory` | `{ supplierId, expectedAt?, notes?, items: [{ ingredientId, qtyOrdered, unitCost }] }` | `POView` |
| GET | `/api/purchase-orders` | `read Inventory` | — | `POView[]` |
| GET | `/api/purchase-orders/:id` | `read Inventory` | — | `POView` |
| POST | `/api/purchase-orders/:id/send` | `update Inventory` | — | `POView` |
| POST | `/api/purchase-orders/:id/receive` | `update Inventory` | `{ items: [{ itemId, qtyReceived }] }` | `POView` |
| POST | `/api/purchase-orders/:id/cancel` | `update Inventory` | — | `POView` |

**Vistas:**
- **POView:** `{ id, supplierId, supplierName, status, expectedAt: string|null (ISO), notes: string|null, items: POItemView[], total(string,2dec) }`. `status: 'draft'|'sent'|'partially_received'|'received'|'cancelled'`.
- **POItemView:** `{ id, ingredientId, ingredientName, qtyOrdered(string,3dec), qtyReceived(string,3dec), unitCost(string,2dec), lineTotal(string,2dec) }` (`lineTotal = qtyOrdered·unitCost`).

## RBAC
Subject **`Inventory`** (ya en `CaslAbilityFactory`, **sin cambios**): **staff** `can('read','Inventory')` → ve OCs; **manager/owner** `can('manage','Inventory')` → crean, envían, recepcionan y cancelan OCs. Escrituras gated con `@RequireAbility('create'|'update','Inventory')`; lecturas con `('read','Inventory')`. `@Audited` en crear/enviar/recepcionar/cancelar.

## Multi-tenant
`purchase_orders` y `purchase_order_items` con `tenant_id NOT NULL`, **RLS FORCE** + policy `tenant_isolation` (`NULLIF(current_setting('app.tenant_id', true), '')::uuid`), verificado `relforcerowsecurity = t` en ambas. Tablas propiedad de `gastronomia_app` (rol NO-superuser) → la RLS FORCE aplica también al owner. `purchase_order_items.purchase_order_id` con `ON DELETE CASCADE`. Todo el acceso vía `runInTenant` (tenant_id solo del JWT). Migración `purchase_orders` (RLS añadida manualmente al SQL generado, como en Inc 1).

## Trazabilidad → test
`test/purchase-orders.e2e-spec.ts` (siembra tenant, owner + staff, un proveedor, un insumo con `stock 0`/`unitCost 10`). Flujo HTTP (token owner para escrituras): crear OC (2 del insumo @ 12) → `draft`, `total '24.00'`; `/send` → `sent`; recepcionar 1 → `ingredient.stock` +1, OC `partially_received`, un movimiento `purchase`; recepcionar el resto (1) → stock +1 (total 2), OC `received`, otro movimiento `purchase`; recepcionar más de lo ordenado → **400**; cancelar una OC `received` → **409**; crear + cancelar una OC `draft` → `cancelled`. Se verifica que existe un movimiento `purchase` por recepción y que el stock cuadra. RBAC: **staff** `POST /purchase-orders` → **403** (solo lectura). Cantidades/dinero aseverados como **string**.
