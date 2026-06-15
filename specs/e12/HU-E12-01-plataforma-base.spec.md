# HU-E12-01 — Plataforma base: contrato compartido + health check

> **Épica:** E12 `platform` (Plataforma, DevOps, Observabilidad, audit) · **Sprint:** S0 · **MoSCoW:** MUST
> **Metodología:** SDD / Harness Engineering (ADR-006). Trazabilidad obligatoria R⟨n⟩ → test.
> **Estado:** `spec_ready`

## Contexto

Primer paso del backend (backend.md §13.1–§13.2): dejar el **contrato REST compartido**
(`ApiResponse<T>`, schemas de auth y claims de tenant como **Zod v4** = única fuente de verdad)
y el **esqueleto del módulo `platform`** con un health check, antes de cualquier feature de negocio.

El contrato debe ser **idéntico** al que ya consume el frontend
(`frontend/shared/types/api.ts` y `frontend/shared/schemas/auth.ts`). Mientras no exista el
monorepo, vive en `src/shared/`; se moverá a `packages/shared` al unificar.

## Requisitos (EARS)

- **R1** — El sistema **debe** exponer un tipo/builder `ApiResponse<T>` con la forma
  `{ success: boolean; data: T; error?: { code; message }; meta?: { totalCount; page } }`,
  idéntica al contrato del frontend (frontend_context.md §6).
- **R2** — Cuando se construye una respuesta de éxito con `ok(data)`, el sistema **debe**
  devolver `{ success: true, data }` y **no debe** incluir `meta` salvo que se provea.
- **R3** — El sistema **debe** ofrecer un schema Zod (`apiResponseSchema(dataSchema)`) que valide
  el envelope y **rechace** un `data` que no cumpla el schema interno.
- **R4** — Los schemas `loginSchema` y `registerSchema` **deben** coincidir con el frontend:
  email válido normalizado a minúsculas; password login ≥ 1; register password ≥ 8,
  `name`/`restaurantName` ≥ 2.
- **R5** — El sistema **debe** validar los claims del JWT (`jwtClaimsSchema`):
  `sub` no vacío, `tenant_id` UUID, `roles` ∈ {owner,manager,staff} con ≥ 1 elemento.
  Cuando `tenant_id` no es UUID o `roles` está vacío, el sistema **debe** rechazar.
- **R6** — El sistema **debe** exponer `GET /api/health` que responde `200` con un envelope
  `ApiResponse<{ status: 'ok'; uptime: number; timestamp: string }>`.
- **R7** — El backend **debe** montar todas las rutas bajo el prefijo global `/api`
  (contrato backend.md §7).

## Fuera de alcance (siguientes incrementos)

- `PrismaService` + readiness check con DB y `CREATE EXTENSION vector` (llegan con E01).
- Exception filter / envelope de error `{ success:false, error }` (con E01, donde importan).
- `audit_log` (tabla propia de E12) y observabilidad (OpenTelemetry/Sentry).

## Trazabilidad R⟨n⟩ → test

| Req | Test |
|---|---|
| R1, R2 | `src/shared/api/api-response.spec.ts` → `ok()` |
| R3 | `src/shared/api/api-response.spec.ts` → `apiResponseSchema()` |
| R4 | `src/shared/auth/auth.schema.spec.ts` |
| R5 | `src/shared/tenant/jwt-claims.spec.ts` |
| R6 | `src/platform/health/health.controller.spec.ts` + `test/health.e2e-spec.ts` |
| R7 | `test/health.e2e-spec.ts` (ruta `/api/health`) |
