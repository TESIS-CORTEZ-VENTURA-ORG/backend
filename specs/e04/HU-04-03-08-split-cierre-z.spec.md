# HU-04-03/08 — División de cuenta por comensal + Cierre Z del día

> **Épica:** E04 (Tickets, Cobros y Pagos) · **Sprint:** S3/S4 · **Should/Must** · **Estado:** 🟢 hecho (Inc 2). Cierra **E04 8/8**.
> **Increment 2** del épica E04. Extiende el módulo `billing` (Inc 1: pre-cuenta, cuenta final, pagos, anular). No se crean módulos nuevos.
> **SUNAT:** sigue **diferido/externo** (envío electrónico fuera de alcance); el schema queda preparado.

Reutiliza `OrdersService` (de `PosModule`) para ítems de la orden y el `tenant.igvRate` (igual que el `pay` de Inc 1). Toda la moneda se devuelve como **string** `.toFixed(2)` (PEN); todo el acceso vía `runInTenant` con `tenant_id` del JWT.

---

## HU-04-03 · División de cuenta por comensal (cómputo, NO persiste)

```gherkin
GIVEN cuenta con varios items
WHEN cajero divide por items o monto
THEN se generan N partes (shares) independientes
AND la suma de las N partes es igual al total original
AND cada parte puede tener tipo de documento distinto (futuro: un ticket por parte)
```

**`POST /api/orders/:id/split`** · `read Sale`. **Es un cómputo para mostrar** (no persiste). Pagar sigue siendo el endpoint `pay` de Inc 1 (un ticket por orden). El "un ticket por parte" queda documentado como **alcance futuro**.

La orden no debe estar `paid` ni `void` (si no → **409**).

Body:

```jsonc
{ "mode": "equal" | "items",
  "parts"?: int >= 2,            // solo mode=equal; default = order.guests si ≥ 2
  "assignments"?: [              // solo mode=items
    { "label": string, "itemIds": uuid[] }
  ] }
```

Reglas:

- **`equal`**: divide el **total** de la orden en `parts` partes iguales (default = `order.guests` si ≥ 2; si `parts` no llega y `guests < 2` → **400**). Cada parte `{ label, subtotal, igv, total }`. El **resto de redondeo** (cuando el total no divide exacto entre `parts`) se acumula en la **primera parte**, de modo que `Σ shares.total == order.total` exactamente. `subtotal`/`igv` de cada parte se derivan de su `total` con el `igvRate` del tenant (precios INCLUYEN IGV: `subtotal = total/(1+igvRate)`, `igv = total − subtotal`).
- **`items`**: cada `assignment.total = Σ (unitPrice · qty)` de los ítems asignados. **Validación**: cada ítem vivo de la orden debe estar asignado **exactamente una vez** (ni faltante ni duplicado ni ajeno); si no → **400**. `subtotal`/`igv` por parte vía `igvRate`.

Respuesta:

```jsonc
{ "orderId", "mode",
  "shares": [{ "label", "subtotal", "igv", "total" }],
  "total" }                      // = total de la orden; Σ shares.total == total
```

> El monto total de las partes coincide con el total de la orden (criterio "la suma de los N tickets = total original"). Distribuir el resto de redondeo a la primera parte garantiza la igualdad exacta en `equal`.

---

## HU-04-08 · Cierre Z del día

```gherkin
GIVEN turno abierto con N tickets
WHEN cajero solicita cierre Z
THEN se genera reporte con: total ventas, total por método de pago, tickets anulados
AND queda inmutable en el sistema
```

### Modelo de datos — `cash_closes` (`CashClose`, RLS FORCE — riesgo R4)

- `id` uuid, `tenantId`, `openedAt` DateTime, `closedAt` DateTime `@default(now())`, `salesCount` Int, `voidCount` Int, `totalGross` `Decimal(12,2)`, `byMethod` Json (`{cash:"x",card:"y",yape:"z",plin:"w"}` — montos string), `userId` String? `@map("user_id")` (= JWT `sub`), `createdAt`.
- Índice `tenantId`. Relación `Tenant → cashCloses`.
- Migración `cash_closes` (`--create-only`); **bloque RLS FORCE apendizado** (`ENABLE`+`FORCE ROW LEVEL SECURITY` + policy `tenant_isolation`); `migrate deploy` + `generate`; verificado `relforcerowsecurity='t'`.

El cierre Z es **append-only** (queda inmutable: no hay update/delete; solo se crea y se lista).

### `GET /api/cash-close/preview` · `read Sale`

Agrega las ventas **emitidas** (`status='issued'`) desde el último `CashClose.closedAt` de este tenant (o **all-time** si no hay cierres previos). La "ventana abierta" arranca en ese corte.

```jsonc
{ "periodStart",   // ISO; último closedAt, o null si nunca hubo cierre (all-time)
  "salesCount",    // ventas issued en la ventana
  "voidCount",     // ventas void en la ventana
  "totalGross",    // Σ total de ventas issued (string)
  "byMethod",      // { cash, card, yape, plin } — Σ payment.amount por método (strings)
  "openSince" }    // ISO; periodStart, o issuedAt de la primera venta si all-time, o null si no hay ventas
```

- `byMethod` suma `payment.amount` agrupado por método **solo de las ventas issued** de la ventana. Las 4 claves siempre presentes (default `"0.00"`).
- `voidCount` cuenta las ventas `void` cuyo `issuedAt` cae en la ventana.

### `POST /api/cash-close` · `update Sale` (manager/owner; staff → **403**) · `@Audited('cash.close')`

Calcula el **mismo agregado** para la ventana abierta y **persiste** una fila `CashClose`:

- `openedAt` = `closedAt` del último cierre, o `issuedAt` de la **primera venta** si es el primer cierre, o `now()` si no hay ventas.
- `closedAt` = `now()`.
- `userId` = JWT `sub`.
- `salesCount`/`voidCount`/`totalGross`/`byMethod` = el agregado de la ventana.

Devuelve la `CashCloseView`. **Tras cerrar**, el siguiente `preview` arranca una ventana fresca (vacía) porque su corte es el `closedAt` recién persistido.

### `GET /api/cash-close` · `read Sale`

Lista los cierres pasados (**desc** por `closedAt`).

### `CashCloseView` (moneda como string)

```jsonc
{ "id", "openedAt", "closedAt",   // ISO
  "salesCount", "voidCount",
  "totalGross",
  "byMethod": { "cash", "card", "yape", "plin" },
  "userId" }                       // nullable
```

---

## RBAC (CASL) — sin cambios de matriz

- **split** y **preview** y **list**: `read Sale` → `staff`/`manager`/`owner` (el cajero es `staff`, ya tiene `read Sale`).
- **cierre Z** (`POST /api/cash-close`): `update Sale` → **manager/owner**; `staff` → **403** (staff solo tiene `create`+`read Sale`, no `update`). Esto refleja que el cierre Z es una operación de cuadre supervisada.

---

## Trazabilidad → test

### `test/split.e2e-spec.ts` (HU-04-03)
Seed tenant (igvRate 0.18) + staff + zona/mesa + 2 platos (precios que sumen total 100 → p.ej. 60 + 40). Orden abierta con los 2 ítems. Casos:
- `split` `{ mode:'equal', parts:2 }` → 2 partes que suman el total exacto (`Σ shares.total == total`).
- `split` `{ mode:'items', assignments:[{label,itemIds:[a]},{label,itemIds:[b]}] }` (asignación válida) → totales por parte = precio de cada ítem; suma = total.
- asignación **inválida/parcial** (ítem sin asignar o duplicado) → **400**.
- orden inexistente → 404; (opcional) orden pagada → 409.

### `test/cash-close.e2e-spec.ts` (HU-04-08)
Seed tenant + owner/staff + zona/mesa + plato (precio 118). Cobra **2 ventas** con métodos distintos (reusa `pay`: una `cash`, otra `card`/`yape`). Casos:
- `GET /api/cash-close/preview` → `totalGross` correcto (Σ totales), `byMethod` con los montos por método, `salesCount`/`voidCount` correctos.
- `POST /api/cash-close` (**owner**) → 201/persistido, devuelve totales == preview.
- `GET /api/cash-close/preview` posterior → ventana **fresca** (`salesCount=0`, `totalGross="0.00"`).
- `GET /api/cash-close` → lista con el cierre creado.
- `POST /api/cash-close` (**staff**) → **403**.
