# HU-05-01/02/03/08/09/10 — Inventario: stock/kardex, movimientos, mermas y alertas

> **Épica:** E05 · **Sprint:** S3 · **Must/Should** · **Estado:** 🟢 hecho (Incremento 1 — sin servicios externos).

Primer incremento de E05. Kardex **event-sourced**: cada movimiento (`inventory_movements`, RLS FORCE) es un **delta con signo** que se suma al `stock` del insumo en **una sola transacción** (`runInTenant`). Nuevo módulo `inventory` (`InventoryController` + `InventoryService`), registrado en `app.module.ts`. El `Ingredient` (E02) gana `stock` y `minStock` (`Decimal(12,3)`), diferidos en E02 y ahora gobernados por E05. Subject CASL **`Inventory`** (ya existía): **staff** `read`; **manager/owner** `manage`. Dinero/cantidades como **string** (Prisma.Decimal `.toFixed()`), nunca `number`. `tenant_id` solo del JWT.

Coincide con el contrato del frontend (`shared/types/domain.ts`): `MovementType = 'purchase'|'sale'|'waste'|'adjustment'|'count'`; un movimiento lleva `{ ingredientId, ingredientName, type, qty (signed), unit, note?, ... }` y su `qty` con signo se suma a `ingredient.stock` (mismas semánticas que el mock BFF). El adaptador del BFF es trivial: `date → createdAt`, `user → userId`.

## Alcance del incremento
**Construido:** HU-05-01 (stock/kardex), HU-05-02 (entrada manual), HU-05-03 (salida manual), HU-05-08 (merma con razón), HU-05-09 (histórico de mermas), HU-05-10 (alertas de stock bajo).

**Diferido a E05 Inc 2** (órdenes de compra, requieren más modelos): HU-05-04 (crear OC), HU-05-06 (recepcionar OC parcial/total), HU-05-07 (cancelar OC). **Diferido por servicio externo:** HU-05-05 (enviar OC al proveedor → **correo**), HU-05-11 (detectar anomalías de mermas → **servicio de IA / E08**).

## HU-05-01 · Ver stock actual (kardex)
```gherkin
WHEN el gerente abre la vista de stock
THEN ve cada insumo con cantidad, costo y estado AND los que están bajo el mínimo se destacan
```
**Implementado ✅:** `GET /api/inventory/stock` (`read Inventory`). Lista los insumos no borrados (orden alfabético) con `{ ingredientId, name, unit, unitCost, stock, minStock, status }`. **`status`**: `critical` si `stock ≤ minStock·0.5`; `low` si `stock < minStock`; si no `ok`. Si `minStock = 0` (sin umbral) → siempre `ok`. `unitCost` con 2 decimales; `stock`/`minStock` con 3.

`GET /api/inventory/movements?ingredientId=<uuid?>` (`read Inventory`): el kardex completo (o filtrado por insumo), ordenado por `createdAt` **desc**. Cada línea: `{ id, ingredientId, ingredientName, type, qty (signed string), unit, note, reason, userId, createdAt }`.

## HU-05-02 · Entrada manual · HU-05-03 · Salida manual · HU-05-08 · Merma con razón
```gherkin
WHEN el gerente registra entrada/salida/merma (insumo, cantidad con signo, motivo)
THEN se crea un InventoryMovement AND se ajusta el stock AND no se permite stock negativo AND la merma exige razón
```
**Implementado ✅:** `POST /api/inventory/movements` (`create Inventory`, `@Audited('inventory.movement')`). Body `{ ingredientId: uuid, type: enum, qty: number (signo; + entrada/compra, − salida/venta/merma, ≠ 0), note?, reason? }`. En **una** transacción: crea el movimiento (`userId = claims.sub`) **y** aplica `ingredient.stock += qty`. Reglas:
- **`type='waste'` (merma) exige `reason`** → si falta, **400** (HU-05-08).
- Si el insumo no existe → **400**.
- Si el delta dejaría `stock < 0` → **400** (HU-05-03, no descuadrar el kardex).
- `qty = 0` → **400** (validación Zod).

Devuelve la vista del movimiento creado. (El `unitCost` no se muta en este incremento; el recálculo de costo promedio / FIFO se aborda en E06 costeo.)

## HU-05-10 · Alertas de stock bajo (+ configurar mínimos)
```gherkin
GIVEN un insumo con mínimo definido
WHEN su stock cae bajo el umbral
THEN aparece en las alertas, más crítico primero
```
**Implementado ✅:**
- `PATCH /api/inventory/levels/:ingredientId` (`update Inventory`, `@Audited('inventory.level')`): body `{ minStock: number ≥ 0 }`. Configura el umbral de reorden; devuelve la vista de stock del insumo. Insumo inexistente → **404**.
- `GET /api/inventory/alerts` (`read Inventory`): insumos con `minStock > 0` **y** `stock < minStock`, cada uno `{ ingredientId, name, unit, stock, minStock, deficit, status }` con `deficit = minStock − stock`, ordenados por **mayor déficit primero** (los más críticos encabezan).

> La **notificación in-app/correo** del Gherkin original (HU-05-10) se difiere a E10 (notificaciones); este incremento expone el dato de alerta vía API (consumible por polling del BFF) sin requerir el servicio de correo.

## HU-05-09 · Histórico de mermas
```gherkin
WHEN el gerente abre el histórico de mermas
THEN ve todas las mermas con su razón AND el total perdido en S/
```
**Implementado ✅:** `GET /api/inventory/waste` (`read Inventory`): movimientos con `type='waste'`, desc por `createdAt`, con `ingredientName/qty/reason/createdAt/userId`, más un resumen **`totalWasteCost = Σ |qty|·unitCost`** (string, 2 decimales). Los filtros por fecha/producto/razón y el gráfico de tendencia son refinamientos de UI sobre estos datos.

## Contrato — endpoints
| Método | Ruta | Ability | Body | Respuesta (`data`) |
|---|---|---|---|---|
| GET | `/api/inventory/stock` | `read Inventory` | — | `StockView[]` |
| GET | `/api/inventory/movements?ingredientId?` | `read Inventory` | — | `MovementView[]` |
| POST | `/api/inventory/movements` | `create Inventory` | `{ ingredientId, type, qty, note?, reason? }` | `MovementView` |
| PATCH | `/api/inventory/levels/:ingredientId` | `update Inventory` | `{ minStock }` | `StockView` |
| GET | `/api/inventory/alerts` | `read Inventory` | — | `AlertView[]` |
| GET | `/api/inventory/waste` | `read Inventory` | — | `{ items: MovementView[], totalWasteCost }` |

**Vistas:**
- **StockView:** `{ ingredientId, name, unit, unitCost(string), stock(string), minStock(string), status: 'ok'|'low'|'critical' }`.
- **MovementView:** `{ id, ingredientId, ingredientName, type, qty(string,signed), unit, note: string|null, reason: string|null, userId: string|null, createdAt(ISO) }`.
- **AlertView:** `{ ingredientId, name, unit, stock(string), minStock(string), deficit(string), status }`.

## RBAC
Subject **`Inventory`** (ya en `CaslAbilityFactory`, sin cambios): **staff** `can('read','Inventory')` → ve stock/kardex/alertas/mermas; **manager/owner** `can('manage','Inventory')` → registran movimientos y configuran mínimos. Escrituras gated con `@RequireAbility('create'|'update','Inventory')`; lecturas con `('read','Inventory')`. `@Audited` en `POST /movements` y `PATCH /levels/:id`.

## Multi-tenant
`inventory_movements` con `tenant_id NOT NULL`, **RLS FORCE** + policy `tenant_isolation` (`NULLIF(current_setting('app.tenant_id', true), '')::uuid`), verificado `relforcerowsecurity = t`. Tabla propiedad de `gastronomia_app` (rol NO-superuser) → la RLS FORCE aplica también al owner. Las columnas añadidas a `ingredients` (ADD COLUMN) no alteran su RLS preexistente. Todo el acceso vía `runInTenant` (tenant_id solo del JWT). Migración `20260615192255_inventory_movements`.

## Trazabilidad → test
`test/inventory.e2e-spec.ts` (siembra tenant, owner + staff, insumo `unitCost 10`). Flujo HTTP (token owner para escrituras): `minStock=5`; entrada `+10` → stock 10; salida `−3` → stock 7; merma `−2` **con razón** → stock 5; merma **sin razón** → **400**; salida `−999` (negativo) → **400**; `GET /stock` muestra `stock 5.000` + `status`; salida `−1` → stock 4 (< min 5) → `GET /alerts` lo lista con `deficit 1.000` y `status 'low'`; `GET /waste` muestra la merma con `reason 'EXPIRED'` y `totalWasteCost '20.00'`; `GET /movements` lista los 4 en orden desc + filtro por insumo. RBAC: **staff** `POST /movements` → **403**, `GET /stock` → **200**. Cantidades/stock aseverados como **string**.
