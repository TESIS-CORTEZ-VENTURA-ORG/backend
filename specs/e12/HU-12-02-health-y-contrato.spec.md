# HU-12-02 — Health checks (+ contrato compartido foundational)

> **Épica:** E12 (DevOps) · **Sprint:** S0 · **Must · SP 2 · iE3.3**
> **Estado:** 🟡 parcial (PR #3). Fuente: `Product Backlog.md` → HU-12-02.
> (Antes `HU-E12-01` 'plataforma base'; renumerado en la reconciliación 2026-06-15.)

## Historia
Como **DevOps**, quiero **health checks expuestos para monitoreo**, para **detectar caídas antes que los usuarios**.

## Criterios de aceptación (Gherkin oficial)
```gherkin
GIVEN cualquier servicio (backend, AI service)
WHEN se llama a GET /health
THEN responde 200 con detalles: db_ok, redis_ok, anthropic_api_ok, version, uptime
AND si algún componente falla, devuelve 503 con detalle
```

## Implementado ✅
`PlatformModule` + `HealthController` → `GET /api/health` → `ApiResponse<{status, uptime, timestamp}>`.

## Gaps vs criterio oficial
- **Readiness**: faltan `db_ok` / `redis_ok` / `anthropic_api_ok` / `version` (hoy solo liveness).
- **503** ante componente caído.
- Exponer en **`/health`** (hoy `/api/health` por el prefijo global) — evaluar excluir health del prefijo.

## Infra foundational entregada en el mismo PR (no es una HU del backlog)
Contrato Zod compartido `src/shared/` (`ApiResponse<T>`, `loginSchema`/`registerSchema`,
`jwtClaimsSchema`) — espejo de `frontend/shared/`; soporta el contrato REST con el frontend.

## Tests
`test/health.e2e-spec.ts` · `src/shared/**/*.spec.ts`.
