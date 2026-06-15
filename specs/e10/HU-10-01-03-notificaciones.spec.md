# HU-10-01/03 — Notificaciones in-app + Preferencias

> **Épica:** E10 · **Sprint:** S4 · **Must/Should** · **Estado:** 🟢 hecho (in-app + preferencias; email y alertas de IA diferidos por servicio externo).

Primer (y único construible) incremento de E10. Módulo nuevo `notifications` (`NotificationsController` + `NotificationsService`), registrado en `app.module.ts`. Dos tablas nuevas — `notifications` y `notification_preferences` — ambas con **RLS FORCE** (verificado `relforcerowsecurity='t'`). Notificaciones **por usuario**: cada usuario lee **las suyas** (dirigidas con `userId`) **más** las del tenant (`userId = null` = broadcast). Crear notificaciones es **interno** (service-to-service, sin endpoint público). `tenant_id` SIEMPRE del JWT; todo el acceso a BD vía `runInTenant`.

## Alcance del incremento
**Construido:** HU-10-01 (notificación in-app: bandeja por usuario + badge/contador + marcar leída individual/todas) y HU-10-03 (preferencias por tipo y canal; respeto de la preferencia al crear).

**Diferido por servicio externo:**
- **HU-10-02** (notificación por email) → requiere **Resend** (servicio de correo, como E01 invitaciones/recuperación). El schema ya está preparado: `NotificationPreference.email Boolean` reserva el canal correo para el futuro.
- **HU-10-04** (alertas accionables de IA) → requiere el **servicio de IA (E08, FastAPI)**. El campo `data Json?` ya admite el deep-link / payload accionable (`action button`) que la HU pide; cuando E08 exista, creará notificaciones `type='system'` (u otro) con su `data`.

## Modelo de datos
### `notifications` (RLS FORCE)
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `tenantId` | uuid | del JWT; RLS |
| `userId` | uuid? | **null = broadcast** (todos los del tenant); si no, dirigida |
| `type` | String | `low_stock` \| `order_ready` \| `bill_requested` \| `system` |
| `title` | String | título corto |
| `body` | String | cuerpo |
| `data` | Json? | payload del deep-link / action button (HU-10-01/04) |
| `readAt` | DateTime? | **null = no leída** |
| `createdAt` | DateTime | orden de la bandeja (desc) |

Índices: `tenantId`, `(tenantId, userId)`. Relación `Tenant → notifications`.

### `notification_preferences` (RLS FORCE) — HU-10-03
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `tenantId` | uuid | del JWT; RLS |
| `userId` | uuid | dueño de la preferencia |
| `type` | String | tipo de notificación |
| `inApp` | Boolean | `@default(true)` — canal in-app |
| `email` | Boolean | `@default(false)` — reservado para HU-10-02 (Resend) |
| `updatedAt` | DateTime | |

`@@unique([tenantId, userId, type])` = una preferencia por (usuario, tipo). Índices: `tenantId`, `(tenantId, userId)`. Relación `Tenant → notificationPreferences`.

## HU-10-01 · Notificación in-app
```gherkin
GIVEN usuario autenticado
WHEN se crea Notification dirigida a el
THEN aparece badge con contador en campana
AND al click ve lista de notificaciones (no leidas + leidas)
AND puede marcar como leida individualmente o todas
AND cada notificacion tiene action button (deep-link)
```
**Implementado ✅** (solo `JwtAuthGuard`; el alcance es por `claims.sub` — **sin nuevo sujeto CASL**, las notificaciones son personales):
- `GET /api/notifications?unreadOnly=&limit=` → `{ items: [{ id, type, title, body, data, readAt, createdAt }], unreadCount }`. Devuelve las del usuario actual (`userId = claims.sub`) **O** broadcast (`userId = null`), **desc** por `createdAt`. `unreadOnly=true` filtra `readAt = null`. `limit` (1..200, default 50) acota la lista; `unreadCount` SIEMPRE cuenta todas las no leídas (ignora `unreadOnly`/`limit`) → es el badge de la campana.
- `POST /api/notifications/:id/read` → marca una leída (debe pertenecer al usuario o ser broadcast; si no existe en su alcance → **404**). Devuelve la notificación. Idempotente: re-marcar conserva el `readAt` original.
- `POST /api/notifications/read-all` → marca todas las no leídas del usuario (suyas + broadcast). Devuelve `{ updated: n }`.

El **action button / deep-link** del Gherkin viaja en `data` (p. ej. `{ "href": "/inventory/alerts" }`); el frontend lo interpreta.

## HU-10-03 · Preferencias de notificación
```gherkin
GIVEN usuario en preferencias
WHEN configura tipo (STOCK_LOW, ANOMALY_DETECTED, etc.) x canal (IN_APP/EMAIL/PUSH)
THEN se persiste NotificationPreference
AND el sistema respeta esa configuracion
AND existe configuracion default por rol
```
**Implementado ✅:**
- `GET /api/notifications/preferences` → `{ items: [{ type, inApp, email }] }` del usuario actual (las persistidas; tipos sin preferencia explícita usan el **default**: `inApp=true`, `email=false`).
- `PATCH /api/notifications/preferences` body `{ type, inApp?, email? }` → upsert (`@@unique[tenantId,userId,type]`); devuelve la preferencia resultante.
- **El sistema respeta la preferencia al crear**: `NotificationsService.create*` consulta la preferencia para ese `type`; si `inApp === false` → **no** persiste la notificación in-app (se omite). **Dirigida** (`userId` concreto): mira la fila exacta de ese usuario. **Broadcast** (`userId = null`): no hay un destinatario único, así que se omite si **existe** alguna preferencia de ese tipo con `inApp = false` en el tenant (opt-out explícito). En el piloto (mono-usuario por tenant) esto equivale a respetar la preferencia del usuario; el **filtrado por-destinatario de broadcasts** en tenants multi-usuario (entregar a unos y a otros no) es alcance futuro.
- **Default**: ausencia de fila = `inApp=true`, `email=false`. El "default por rol" del Gherkin se cubre con este default global (in-app activo para todos); diferenciarlo por rol es refinamiento futuro. `PUSH` queda fuera de alcance (sin app móvil); los canales modelados son in-app (activo) y email (reservado, HU-10-02).

## NotificationsService (exportado por el módulo)
Para que otros módulos creen notificaciones:
- `create(tenantId, { userId?, type, title, body, data? })` — abre su propia `runInTenant`. Respeta la preferencia (in-app off → omite). Devuelve la `NotificationView` creada o `null` si se omitió.
- `createTx(tx, tenantId, input)` — **variante tx-aware** (espeja `RecipesService.costPerYieldTx` / el auto-consumo de `BillingService`): crea dentro de la transacción del llamador, para enlazar la notificación al mismo commit que el evento que la dispara.
- `listForUser`, `markRead`, `markAllRead`, `getPreferences`, `setPreference`.

## Trigger real (cableado POS↔inventario↔notificaciones) — stock bajo (HU-05-10 → notificación)
`InventoryModule` importa `NotificationsModule`; `InventoryService` inyecta `NotificationsService`. En `createMovement`, dentro de la **misma** `runInTenant`, **después** de aplicar el delta al stock, si el insumo **cruza** de `stock ≥ minStock` (antes del movimiento) a `stock < minStock` (después), se crea una notificación `low_stock` **broadcast** (`userId = null`) vía `createTx`:
- `title`: `Stock bajo: <ingrediente>`
- `body`: `<ingrediente> está en <stock> <unidad> (mínimo <min>).`
- `data`: `{ ingredientId, stock, minStock, status, href: '/inventory/alerts' }`

**Idempotencia (crossing-only):** solo se notifica cuando **cruza** el umbral. Se exige que el stock **previo** al movimiento fuera `≥ minStock` (y el nuevo `< minStock`); así un segundo movimiento que baja aún más el stock estando **ya** por debajo NO genera una notificación nueva (no hace spam). Si `minStock = 0` (sin umbral) nunca cruza. El cruce a **crítico** (`stock ≤ minStock·0.5`) reutiliza la misma notificación (el `status` viaja en `data`); no se emite una segunda alerta distinta para crítico en este incremento.

## Contrato — endpoints
| Método | Ruta | Guard | Body / Query | Respuesta (`data`) |
|---|---|---|---|---|
| GET | `/api/notifications?unreadOnly=&limit=` | `JwtAuthGuard` | query | `{ items: NotificationView[], unreadCount }` |
| POST | `/api/notifications/:id/read` | `JwtAuthGuard` | — | `NotificationView` |
| POST | `/api/notifications/read-all` | `JwtAuthGuard` | — | `{ updated: number }` |
| GET | `/api/notifications/preferences` | `JwtAuthGuard` | — | `{ items: PreferenceView[] }` |
| PATCH | `/api/notifications/preferences` | `JwtAuthGuard` | `{ type, inApp?, email? }` | `PreferenceView` |

`NotificationView = { id, type, title, body, data, readAt, createdAt }` (fechas ISO; `data`/`readAt` nullable).
`PreferenceView = { type, inApp, email }`.

## Contrato Zod (`src/shared/notifications/notification.ts`)
- `notificationTypeSchema` = `z.enum(['low_stock','order_ready','bill_requested','system'])`.
- `listNotificationsQuerySchema` = `{ unreadOnly?: boolean (coerce), limit?: int 1..200 }`.
- `setPreferenceSchema` = `{ type: notificationTypeSchema, inApp?: boolean, email?: boolean }`.
- Exportado en `src/shared/index.ts`.

## Pruebas — `test/notifications.e2e-spec.ts`
Seed: tenant + owner (token del owner; las notificaciones son por usuario autenticado / broadcast). Insumo con `minStock` configurado (vía `PATCH /api/inventory/levels`).
- **Trigger / cruce**: entrada para subir el stock por encima del mínimo; luego una **salida** (`type='sale'`) que lo deja **por debajo** → `GET /api/notifications` muestra una `low_stock` y `unreadCount ≥ 1`.
- **Marcar leída**: `POST /api/notifications/:id/read` → `unreadCount` baja.
- **Crossing-only**: una segunda salida estando **ya** por debajo del mínimo NO crea una notificación nueva (el conteo de `low_stock` no aumenta).
- **HU-10-03 preferencia**: `PATCH /api/notifications/preferences { type:'low_stock', inApp:false }`; subir el stock por encima del mínimo y volver a cruzarlo hacia abajo → NO aparece una nueva notificación in-app (la preferencia se respeta). `GET /api/notifications/preferences` refleja `inApp=false` para `low_stock`.
- Envelope `ApiResponse` validado con Zod en cada respuesta.

## Decisiones / fuera de alcance
- **Sin sujeto CASL nuevo** (no se toca la matriz): las notificaciones son personales → `JwtAuthGuard` + alcance por `claims.sub`. Un usuario solo ve/marca lo suyo y los broadcast; el aislamiento por tenant lo da la RLS.
- **Crear notificaciones = interno** (service-to-service); no hay `POST /api/notifications` público (evita que un cliente fabrique notificaciones para otros).
- **HU-10-02 email** diferido → Resend (servicio externo). `NotificationPreference.email` reserva el canal.
- **HU-10-04 IA** diferido → E08/FastAPI. `data Json?` ya soporta el action button accionable.
- **Broadcast + preferencia**: hoy un broadcast se **omite por completo** si existe un opt-out (`inApp=false`) de ese tipo en el tenant (correcto en el piloto mono-usuario). El **filtrado por-destinatario** (entregar el broadcast a los usuarios que SÍ lo quieren y omitirlo solo para los que opt-out) en tenants multi-usuario es alcance futuro.
- **PUSH** fuera de alcance (sin app móvil nativa).
- Cantidades en `data` como **string** (Decimal `.toFixed`), coherente con el resto del backend.
