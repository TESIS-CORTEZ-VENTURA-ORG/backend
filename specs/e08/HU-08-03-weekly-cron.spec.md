# HU-08-03 — Forecast automático semanal (cron)

> **Épica:** E08 (Motor de Forecasting con IA) · **Sprint:** S4 · **Must** · **Estado:** 🟢 hecho (cron lunes 03:00 Lima → un forecast por tenant activo, con reintentos del job). La notificación al gerente al terminar queda diferida (acopla a E10).

Automatiza el forecasting: cada **lunes 03:00 (America/Lima)** se encola un pronóstico `total` por cada **tenant activo**, reutilizando el flujo async de HU-08-02 (el worker computa y persiste, con reintentos). Mantiene los pronósticos vigentes sin intervención manual.

## Alcance del incremento

**Construido:**

- **Cron** `@Cron('0 3 * * 1', { timeZone: 'America/Lima' })` en `ForecastScheduler.runWeeklyForecasts()`: enumera tenants activos y encola un `{ scope: 'total', horizon: 14 }` por cada uno (vía `enqueueForecast`, que crea la `ForecastRun` y el job).
- **Enumeración cross-tenant de sistema** (`SystemDbClient`, platform): la tabla `tenants` tiene **RLS FORCE** (policy self-referencial `id = app.tenant_id`), así que el rol normal no la puede recorrer. Se usa un cliente **BYPASSRLS, solo SELECT** (rol `gastronomia_auth`, `DATABASE_URL_AUTH`) para leer **solo los ids** de tenants activos (`deletedAt IS NULL`). Nunca escribe. El encolado por tenant sí queda scoped vía `runInTenant`.
- **Reintentos con backoff** (HU-08-03: "si falla, hasta 3 veces con backoff"): el job se encola con `attempts: 3` + `backoff` exponencial (2s). `processRun` **relanza** solo errores **transitorios** de infra (core-ai 502/503/504) para que BullMQ reintente; los errores **terminales** de negocio (422 histórico insuficiente) **no** se relanzan (no hay loop de reintentos).
- **Resiliencia**: el fallo al encolar de un tenant se loguea y no corta a los demás.

**Diferido:**

- **Notificación al gerente** al terminar ("se notifica cuando está listo"): requiere integrar el módulo `notifications` (E10) y disparar al completar la corrida. Próximo incremento.
- Horizonte/parámetros configurables por tenant (HU-08-01).

## HU-08-03 (Gherkin cubierto)

```gherkin
GIVEN un cron configurado
WHEN llega el lunes a las 03:00 (zona del tenant)
THEN se ejecuta (encola) un forecast por cada tenant ACTIVO
AND se guarda en el histórico (forecast_runs)
AND si falla por infra, el job reintenta hasta 3 veces con backoff
```

## Arquitectura y seguridad

- **Frontera de módulos**: `SystemDbClient` vive en `platform` (infra compartida) y se exporta; `forecasting` lo inyecta (no se cruza a `auth`).
- **BYPASSRLS acotado**: solo lectura de ids de tenants activos; toda escritura/cómputo por tenant sigue por `runInTenant` (RLS FORCE).
- **Zona horaria**: el cron declara `timeZone: 'America/Lima'` (el proyecto opera en esa zona).

## Tests

- **Unit** — `src/forecasting/forecast.scheduler.spec.ts` (3): encola uno por tenant activo con `{scope:'total',horizon:14}`; el fallo de un tenant no corta a los demás (resiliencia); sin tenants no encola.
- **e2e** — `test/forecast-cron.e2e-spec.ts` (1, requiere DB + Redis): siembra 2 tenants activos + 1 borrado, ejecuta `runWeeklyForecasts()` y verifica `tenants=2`/`enqueued=2` y **una corrida por tenant activo, cero para el borrado** (prueba la enumeración BYPASSRLS + el filtro de activos).
- Suites completas: **64 unit + 189 e2e** verdes (sin regresiones).
