# HU-08-02 (parte 2/2) + HU-08-04 — Forecasting async (BullMQ) + predicciones

> **Épica:** E08 (Motor de Forecasting con IA) · **Sprint:** S4 · **Must** · **Estado:** 🟢 hecho (encolar → worker → core-ai → persistir; polling y últimas predicciones). El cron semanal (HU-08-03) y los covariates (HU-08-07) quedan fuera de este incremento.

Cierra la parte síncrona de HU-08-02 envolviéndola en una **cola BullMQ** y agrega la consulta de **predicciones** (HU-08-04). NestJS orquesta, core-ai infiere (`backend.md` §3): el `POST` encola un job, el **worker** (`ForecastProcessor`) computa el pronóstico (agrega `sales_history` + llama a core-ai) y persiste la corrida en `forecast_runs`. El cliente consulta el resultado por polling.

## Alcance del incremento

**Construido:**

- **`POST /forecasting/run`** — ahora **async**: crea una `ForecastRun` en `running`, encola el job y responde **202** con la vista de la corrida. `manage Report` (lanzar una corrida consume cómputo; owner/manager; staff → 403).
- **`GET /forecasting/runs/:id`** — estado/resultado de la corrida (polling): `running` → `completed` (con `points`/`backtest`) | `failed` (con `error`). `read Report`. 404 si no existe (`ParseUUIDPipe` valida el id).
- **`GET /forecasting/predictions?scope=&menuItemId=`** (HU-08-04) — la corrida `completed` más reciente para ese ámbito. `read Report`. 404 si aún no hay ninguna.
- **Worker BullMQ** (`ForecastProcessor`): `processRun` computa y persiste; en error de negocio (p. ej. histórico insuficiente, core-ai caído) marca `failed` y **no relanza** (no reintenta en bucle).
- **`forecast_runs`** (tabla nueva, **RLS FORCE** verificada): `points`/`backtest` como JSONB; `status` running/completed/failed. Migración `20260619162154_forecast_runs` con el bloque RLS anexado a mano (igual que el resto de tablas de negocio).
- **BullMQ**: `BullModule.forRoot` (conexión Redis desde `REDIS_URL`, default `redis://localhost:6379`) en el AppModule; cola `forecast` registrada en el módulo.

**Diferido (próximo incremento):**

- **HU-08-03** — cron semanal (lunes 03:00) por tenant: requiere enumerar tenants (operación admin sin contexto de tenant) + `@nestjs/schedule`.
- **HU-08-07** — covariates peruanos (XReg); **HU-08-08** — métricas MAPE/MAE (hoy core-ai solo expone sMAPE en el backtest).
- Progreso por **SSE** (hoy el avance se consulta por polling).

## Contrato

```jsonc
// POST /forecasting/run  (202) — body igual que antes
{ "scope": "total"|"menuItem", "menuItemId"?: "uuid", "horizon": 14, "from"?, "to"?, "engine"? }
// → ForecastRunView { id, status: "running", scope, horizon, points: null, ... }

// GET /forecasting/runs/:id  → ForecastRunView (running | completed | failed)
// GET /forecasting/predictions?scope=total → ForecastRunView (la última completed)
```

```jsonc
// ForecastRunView (completed)
{
  "id": "uuid", "scope": "total", "menuItemId": null, "horizon": 7,
  "engine": null, "status": "completed", "model": "AutoETS", "baseline": "SeasonalNaive",
  "observations": 60, "spanDays": 60, "dataQuality": "insufficient",
  "points": [{ "target_date": "2024-03-01", "yhat": 12.0, "yhat_lo": 9.4, "yhat_hi": 14.6 }],
  "backtest": { "holdout_size": 7, "model_smape": 8.4, "baseline_smape": 11.7, "improvement_pct": 28.2 },
  "error": null, "createdAt": "…", "completedAt": "…"
}
```

## HU-08-02 (Gherkin cubierto)

```gherkin
GIVEN un gerente con histórico de ventas
WHEN lanza un pronóstico
THEN se encola un job (BullMQ → AI Service) y la ForecastRun queda en RUNNING
AND el cliente ve el progreso (polling de GET /runs/:id)
AND al terminar se actualizan los resultados (COMPLETED con predicciones)
```

## Multi-tenancy y seguridad

- `tenant_id` SIEMPRE del JWT; el worker recibe el `tenantId` en el job y persiste vía `runInTenant` (RLS FORCE aplica también fuera del request HTTP).
- `forecast_runs` con **RLS FORCE** (`relrowsecurity` y `relforcerowsecurity` = `t`, policy `tenant_isolation`).
- Lanzar = `manage Report`; consultar = `read Report`; staff → 403.

## Tests

- **Unit** — `src/platform/queue/redis-connection.spec.ts` (3): default localhost:6379 + `maxRetriesPerRequest:null`, parseo de `REDIS_URL`, nombre de cola estable.
- **e2e** — `test/forecast-async.e2e-spec.ts` (6, requiere Redis + core-ai dockerizados): encolar 202 → polling → **completed** con `points` (HU-08-02); `GET /predictions` devuelve la última completada (HU-08-04); histórico insuficiente → **failed** (el worker no se rompe); staff → **403**; corrida inexistente → **404**; predicciones sin corrida → **404**.
- Suite e2e completa: **188 verdes** (sin regresiones).
