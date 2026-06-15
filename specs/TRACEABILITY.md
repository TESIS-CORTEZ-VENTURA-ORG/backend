# Trazabilidad Backlog ↔ Implementación — Backend GastronomIA

> Mapea las HU de `Product Backlog.md` (fuente de verdad: IDs `HU-XX-YY`, criterios Gherkin)
> con specs, PRs y tests. Evidencia de trazabilidad (ABET SO7). Actualizado: 2026-06-15.

## Decisiones de reconciliación (2026-06-15)

1. **Modelo de roles = 3** (`owner` / `manager` / `staff`), NO los 5 del backlog original
   (Admin/Manager/Cashier/Waiter/Kitchen). Motivo: el frontend (42 pantallas con gating) +
   `backend.md` + el código ya usan 3 roles → menor retrabajo. HU-01-04 actualizado en el backlog.
2. **IDs oficiales**: los specs usan los IDs del backlog (`HU-01-XX`, `HU-12-XX`). La numeración
   previa `HU-E01-0X` / `HU-E12-01` queda obsoleta (renombrada).

## Estado por HU construida

| HU oficial | Título | Estado | Spec | PR | Tests |
|---|---|---|---|---|---|
| **HU-12-02** | Health checks | 🟡 Parcial | `e12/HU-12-02-health-y-contrato` | #3 | `health.e2e` |
| **HU-12-06** | Aislamiento multi-tenant (RLS) | 🟡 Casi completo | `e12/HU-12-06-rls-aislamiento` | #4 | `rls.e2e` (4 vectores) |
| **HU-01-01** | Registro de restaurante (tenant) | 🟡 Parcial | `e01/HU-01-01-y-02-registro-login` | #5 | `auth.e2e` |
| **HU-01-02** | Login con email y password | 🟡 Parcial | `e01/HU-01-01-y-02-registro-login` | #5 | `auth.e2e` |

### Gaps conocidos (para cerrar las HU)
- **HU-12-02**: readiness (`db_ok`/`redis_ok`/`anthropic_api_ok`/`version`) + `503` ante fallo; exponer en `/health` (hoy `/api/health`).
- **HU-12-06**: iterar por rol; cubrir TODAS las tablas a medida que crezcan; gate de CI (bloquear deploy si falla → depende de HU-12-01).
- **HU-01-01**: RUC (11 díg.) en el modelo/validación + email de bienvenida (Resend).
- **HU-01-02**: bloqueo tras 5 intentos fallidos (15 min).

## E01 — HU pendientes (completas)
`HU-01-03` refresh rotation · `HU-01-04` RBAC (gating CASL + 403) · `HU-01-05` invitaciones ·
`HU-01-06` cambio password (min 12 + complejidad) · `HU-01-07` recuperación · `HU-01-08` logout ·
`HU-01-09` audit log · `HU-01-10` config local.

## Infra foundational (transversal — no es una HU del backlog)
`src/shared/` (contrato Zod: `ApiResponse`, auth, `jwtClaims`), `PrismaService.runInTenant`,
`ZodValidationPipe`, `JwtAuthGuard`, `gastronomia_auth` (rol BYPASSRLS para login).
