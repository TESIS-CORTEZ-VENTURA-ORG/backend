# HU-10-04 — Alertas accionables de IA: `forecast_shortfall` (E10×E08)

> **Épica:** E10 (Notificaciones y Alertas) × E08 (Forecasting) · **Sprint:** Lote B1 · **Should** · **Estado:** 🟢 hecho. `HU-10-01-03-notificaciones.spec.md` §"Diferido" marcaba esta HU como bloqueada por el servicio de IA (E08); con E08 ya en producción (`ForecastingService.shoppingSuggestions`, HU-08-06), este incremento la cierra.

## Motivo del incremento

La campana (E10) ya reacciona a eventos reactivos (`low_stock`, cruce de umbral en un movimiento de inventario). Este incremento la hace **proactiva**: cuando el forecast completa una corrida y detecta que un insumo no va a alcanzar para cubrir la demanda proyectada, el sistema avisa SOLO — sin que nadie tenga que abrir el reporte de sugerencias de compra.

## Alcance del incremento

**Construido:**

- Nuevo `NotificationType = 'forecast_shortfall'` (`src/shared/notifications/notification.ts`).
- Trigger: al completar una corrida `scope='total'` (`ForecastProcessor` → `ForecastingService.processRun`), se reusa `shoppingSuggestions` (HU-08-06, CERO lógica de BOM/shortfall duplicada) para detectar insumos en déficit dentro del horizonte pronosticado.
- **Destinatarios**: solo `owner`/`manager` (`staff` no gestiona compras — mismo criterio que `manage Report`/CASL). Notificación **dirigida** por usuario (no broadcast como `low_stock`), vía `NotificationsService.createForRolesTx` (nuevo).
- **Agrupación** (`forecast-shortfall.util.planShortfallNotifications`, PURO/testeable): ≤ 3 insumos en shortfall → una notificación **por insumo** (mismo estilo que `low_stock`); > 3 → **UNA** agrupada (evita floodear la campana), listando los 3 más críticos + "y N más".
- **Driver más narrable** (`forecast-shortfall.util.mostRelevantDriver`): si la corrida trajo factores exógenos (HU-08-07: feriados/eventos/clima/fin de semana) dentro de la ventana, el de mayor `|impact_pct|` se menciona en el cuerpo ("… se viene Fiestas Patrias …"); sin impacto conocido, cae al primero cronológicamente.
- **Antispam obligatorio** (`NotificationsService.isDedupSuppressed`, nuevo): mientras exista una notificación **vigente** con el mismo `(type, dedupKey)` — no leída, o creada dentro de una ventana de 24h — no se crea otra. `dedupKey = 'forecast_shortfall:<ingredientId>'` (individual) o `'forecast_shortfall:grouped'`. Sin esto, el cron semanal (HU-08-03) + corridas manuales repetidas generarían una notificación nueva por cada re-cómputo del MISMO shortfall.
- **Resiliente**: un fallo al generar la notificación (`try/catch` + `Logger.error`) NUNCA tumba la corrida ya persistida como `completed` (mismo criterio de resiliencia que `ForecastScheduler.runWeeklyForecasts`, que no corta por tenant).
- **Compatibilidad de frontend verificada, sin cambios**: `notifications-adapter.ts` (`team-frontend`) coerciona cualquier `type` desconocido a `system`/`kind:'info'` — la campana renderiza título/cuerpo genéricos de inmediato. Se pierde el CTA específico (deep-link tipado) hasta que el frontend modele el tipo explícitamente (`href` viaja en `data` de todos modos, apuntando a `/forecasting/shopping-suggestions`).

**Diferido:** CTA/deep-link tipado en el frontend (fuera de alcance de este lote, solo backend); notificar por email (HU-10-02, sigue diferida por Resend).

## Gherkin cubierto

```gherkin
GIVEN una corrida de forecast completa con insumos que no cubren la demanda proyectada
WHEN el sistema detecta el shortfall
THEN crea una notificación forecast_shortfall para owner y manager (NO staff)
AND menciona el driver exógeno más relevante de la ventana, si existe
AND si ya existe una notificación vigente para el MISMO shortfall, NO duplica
```

## Diseño

- `NotificationsService.createForRolesTx(tx, tenantId, { roles, type, title, body, data, dedupKey })`: query `roles: { hasSome: [...] }` sobre `User.roles: String[]` (scalar list filter, Postgres); una fila de `Notification` por destinatario (dirigida, respeta la preferencia in-app de cada usuario vía `createTx`).
- `isDedupSuppressed`: filtro JSON de Prisma (`data: { path: ['dedupKey'], equals } `, soportado en Postgres/jsonb) + ventana de 24h o no-leída.
- `ForecastingService.notifyShortfalls` (privado): orquesta `shoppingSuggestions` → `planShortfallNotifications` → `mostRelevantDriver` → `NotificationsService.createForRolesTx`, dentro de `try/catch` para no afectar la corrida ya completada.
- Mecanismo inter-módulo: **import directo del servicio exportado** (`ForecastingModule` importa `NotificationsModule`, inyecta `NotificationsService`) — mismo patrón que `InventoryModule`/`InventoryService` para `low_stock`. El repo NO tiene un bus de eventos; ese es el mecanismo real vigente para comunicación entre módulos que sí se necesitan (pese a que `backend.md`/`CLAUDE.md` mencionan `no-restricted-imports`, esa regla eslint no está activa hoy en `eslint.config.mjs`).

## Contrato — shape de la notificación

```jsonc
// Individual (≤3 shortfalls)
{
  "id": "uuid",
  "type": "forecast_shortfall",
  "title": "Pulpo no cubre los próximos 14 días",
  "body": "El stock de Pulpo no alcanza para cubrir la demanda proyectada de los próximos 14 días (se viene Fiestas Patrias) — considerá pedir 12.500 kg.",
  "data": {
    "ingredientId": "uuid",
    "horizon": 14,
    "runId": "uuid",
    "href": "/forecasting/shopping-suggestions",
    "dedupKey": "forecast_shortfall:<ingredientId>"
  },
  "readAt": null,
  "createdAt": "2026-07-02T06:34:32.313Z"
}

// Agrupada (>3 shortfalls)
{
  "type": "forecast_shortfall",
  "title": "7 insumos no cubren los próximos 14 días",
  "body": "Lomo de res, Pulpo, Pescado fresco (lenguado) y 4 más no alcanzan para cubrir la demanda proyectada (se viene Fin de semana) — revisá las sugerencias de compra.",
  "data": {
    "ingredientIds": ["uuid", "..."],
    "horizon": 14,
    "runId": "uuid",
    "href": "/forecasting/shopping-suggestions",
    "dedupKey": "forecast_shortfall:grouped"
  }
}
```

## Tests

- **Unit** — `src/forecasting/forecast-shortfall.util.spec.ts` (8): `planShortfallNotifications` (sin shortfalls, ≤ límite, > límite agrupa a los más críticos, exactamente en el límite); `mostRelevantDriver` (sin drivers, mayor `|impact_pct|` gana sobre orden cronológico, sin impacto conocido cae al primero, impacto negativo grande también gana).
- **e2e** — `test/forecast-shortfall-notification.e2e-spec.ts` (2, requiere DB + Redis + `CoreAiClient` stubeado): corrida completada con un insumo en shortfall → notificación para owner y manager, NO para staff, cuerpo menciona el driver ("Fiestas Patrias"); segunda corrida con el MISMO shortfall → antispam, sigue habiendo UNA sola notificación.
- **Verificación live** (`maria@motif.pe`, tenant demo con 19 insumos, 3 bajo mínimo): al disparar `POST /forecasting/run {scope:'total',horizon:14}`, apareció una notificación `forecast_shortfall` **agrupada** (7 insumos en shortfall > límite de 3) mencionando "se viene Fin de semana"; confirmado que `staff@motif.pe` NO la recibe (`GET /notifications` sin `forecast_shortfall`) y que `GET /forecasting/accuracy` (staff) → 403.
