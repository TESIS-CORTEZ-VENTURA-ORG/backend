# HU-12-02 — Health checks (+ contrato compartido foundational)

> **Épica:** E12 (DevOps) · **Sprint:** S0 · **Must · SP 2 · iE3.3**
> **Estado:** 🟢 Hecho (E12-1 readiness fix, 2026-07-01). Fuente: `Product Backlog.md` → HU-12-02.
> (Antes `HU-E12-01` 'plataforma base'; renumerado en la reconciliación 2026-06-15.)

## Historia

Como **DevOps**, quiero **health checks expuestos para monitoreo**, para **detectar caídas antes que los usuarios**.

## Criterios de aceptación (Gherkin oficial)

```gherkin
Feature: Health checks

  Scenario: Liveness — el proceso está vivo
    GIVEN el proceso NestJS está corriendo
    WHEN se llama a GET /api/health
    THEN responde HTTP 200
    AND el body tiene { success: true, data: { status: "ok", uptime: <number>, timestamp: <ISO> } }
    AND NO toca la base de datos ni Redis

  Scenario: Readiness — todas las dependencias OK
    GIVEN Postgres y Redis están accesibles
    WHEN se llama a GET /api/health/ready
    THEN responde HTTP 200
    AND el body tiene { success: true, data: { status: "ready", db: "ok", redis: "ok" } }

  Scenario: Readiness — Postgres caído
    GIVEN Postgres NO es accesible
    AND Redis está accesible
    WHEN se llama a GET /api/health/ready
    THEN responde HTTP 503
    AND el body tiene { success: true, data: { status: "degraded", db: "error", redis: "ok" } }

  Scenario: Readiness — Redis caído
    GIVEN Postgres está accesible
    AND Redis NO es accesible
    WHEN se llama a GET /api/health/ready
    THEN responde HTTP 503
    AND el body tiene { success: true, data: { status: "degraded", db: "ok", redis: "error" } }

  Scenario: Readiness — ambas dependencias caídas
    GIVEN Postgres NO es accesible
    AND Redis NO es accesible
    WHEN se llama a GET /api/health/ready
    THEN responde HTTP 503
    AND el body tiene { success: true, data: { status: "degraded", db: "error", redis: "error" } }
```

## Invariantes de diseño

- `GET /api/health` es LIVENESS: nunca toca DB/Redis, responde siempre que el proceso viva.
- `GET /api/health/ready` es READINESS: usa `PrismaService.$queryRaw\`SELECT 1\``y un cliente
ioredis transitorio con`lazyConnect`/`connectTimeout` para fallo rápido.
- El envelope `ApiResponse<T>` siempre tiene `success: true` en ambos endpoints porque la
  operación HTTP completó; la semántica de "no listo" se expresa en `data.status = 'degraded'`
  y en el código HTTP 503.
- El cliente Redis del health check usa `maxRetriesPerRequest: 0`, `enableOfflineQueue: false`
  y `connectTimeout: 3000` para evitar colgarse durante la comprobación.

## Implementado ✅

- `GET /api/health` → `ApiResponse<HealthStatus>` (liveness, sin cambio).
- `GET /api/health/ready` → `ApiResponse<ReadinessStatus>` con 200 / 503.
- Unit tests en `src/platform/health/health.controller.spec.ts` (mock PrismaService + mock ioredis).
- Defecto E12-1 cerrado.

## Infra foundational entregada en el mismo PR (no es una HU del backlog)

Contrato Zod compartido `src/shared/` (`ApiResponse<T>`, `loginSchema`/`registerSchema`,
`jwtClaimsSchema`) — espejo de `frontend/shared/`; soporta el contrato REST con el frontend.

## Tests

`test/health.e2e-spec.ts` (liveness e2e) · `src/platform/health/health.controller.spec.ts` (readiness unit) · `src/shared/**/*.spec.ts`.
