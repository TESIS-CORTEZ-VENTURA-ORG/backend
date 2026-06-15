# Trazabilidad Backlog ↔ Implementación — Backend GastronomIA

> Mapea las HU de `Product Backlog.md` (fuente de verdad) con specs, PRs y tests.
> Evidencia de trazabilidad (ABET SO7). Actualizado: 2026-06-15.

## Decisiones de reconciliación
1. **Roles = 3** (`owner`/`manager`/`staff`), no los 5 del backlog original. HU-01-04 actualizado.
2. **IDs oficiales** del backlog (`HU-01-XX`, `HU-12-XX`); la numeración previa `HU-E01-0X` quedó obsoleta.

## E01 — Identity, Multi-Tenancy y Seguridad (10 HU)
| HU | Título | Estado | Spec | PR |
|---|---|---|---|---|
| HU-01-01 | Registro de restaurante (tenant) | 🟡 Parcial | `HU-01-01-y-02-registro-login` | #5 |
| HU-01-02 | Login con email y password | 🟢 Hecho (lockout incl.) | `HU-01-01-y-02` / `HU-01-03-y-08` | #5, #8 |
| HU-01-03 | Refresh token con rotación | 🟢 Hecho | `HU-01-03-y-08-session` | #8 |
| HU-01-04 | Roles y permisos (RBAC) | 🟢 Hecho | `HU-01-04-rbac` | #7 |
| HU-01-05 | Invitación de usuarios por email | 🔲 Diferido (correo) | — | — |
| HU-01-06 | Cambio de contraseña | 🟢 Hecho | `HU-01-06-change-password` | #11 |
| HU-01-07 | Recuperación de contraseña | 🔲 Diferido (correo) | — | — |
| HU-01-08 | Cierre de sesión | 🟢 Hecho (backend) | `HU-01-03-y-08-session` | #8 |
| HU-01-09 | Audit log | 🟢 Hecho | `HU-01-09-audit-log` | #10 |
| HU-01-10 | Configuración del local | 🟢 Hecho | `HU-01-10-tenant-config` | #9 |

**E01: 8/10 funcionales** (7 completas + HU-01-01 parcial). 2 diferidas por requerir servicio de correo.

### Gaps / diferidos (todos requieren correo o son refinamientos)
- **HU-01-01**: email de bienvenida (correo). El RUC se setea vía config (HU-01-10).
- **HU-01-05 / HU-01-07**: invitación y recuperación de contraseña → **requieren servicio de correo** (Resend); diferidas.
- **HU-01-06**: notificación por email del cambio (correo).
- **HU-01-08**: el BFF del frontend debe llamar a `POST /api/auth/logout` (hoy solo limpia la cookie) — follow-up frontend.
- **HU-01-09**: `before/after` detallado por entidad; retención 5 años (política de storage).

## E02 — Catálogo, Recetas y Menú (14 HU)
| HU | Título | Estado | Spec | PR |
|---|---|---|---|---|
| HU-02-01 | CRUD de insumos | 🟢 Hecho | `HU-02-01-ingredients` | #13 |
| HU-02-02 | Carga masiva de insumos vía Excel/CSV | 🟢 Hecho | `HU-02-02-import` | #19 |
| HU-02-03 | Unidades de medida con conversión | 🟢 Hecho | `HU-02-03-04-units-categories` | #14 |
| HU-02-04 | Categorías jerárquicas | 🟢 Hecho | `HU-02-03-04-units-categories` | #14 |
| HU-02-05 | CRUD de proveedores | 🟢 Hecho | `HU-02-05-06-suppliers` | #15 |
| HU-02-06 | Asociar productos con proveedores | 🟢 Hecho | `HU-02-05-06-suppliers` | #15 |
| HU-02-07 | Crear receta estandarizada (BOM) | 🟢 Hecho | `HU-02-07-09-recipes` | #16 |
| HU-02-08 | Sub-recetas anidadas | 🟢 Hecho | `HU-02-07-09-recipes` | #16 |
| HU-02-09 | Versionado de recetas | 🟢 Hecho | `HU-02-07-09-recipes` | #16 |
| HU-02-10 | Crear plato del menú (margen) | 🟢 Hecho | `HU-02-10-12-menu` | #17 |
| HU-02-11 | Gestión de modificadores | 🟢 Hecho | `HU-02-11-13-modifiers-availability` | #18 |
| HU-02-12 | Categorías del menú | 🟢 Hecho | `HU-02-10-12-menu` | #17 |
| HU-02-13 | Disponibilidad por horario | 🟢 Hecho | `HU-02-11-13-modifiers-availability` | #18 |
| HU-02-14 | Foto del plato | 🔲 Diferido (storage R2) | — | — |

**E02: 13/14 hechas** (Inc A–F). Única diferida: **HU-02-14** foto del plato (requiere object storage R2 — servicio externo). Todo lo construible vía código está completo.

## E12 — Plataforma (lo tocado)
| HU | Título | Estado | Spec | PR |
|---|---|---|---|---|
| HU-12-02 | Health checks | 🟡 Parcial (falta readiness db/redis + 503) | `HU-12-02-health-y-contrato` | #3 |
| HU-12-06 | Aislamiento multi-tenant (RLS) | 🟢 Hecho (4 vectores) | `HU-12-06-rls-aislamiento` | #4 |

## Integración frontend ↔ backend
- Auth (login/register) integrada y validada E2E (frontend PR #1).
- Proxy autenticado del BFF (`backendFetch`) + `/api/users` (frontend PR #2). Rutas de dominio (recipes/inventory/…) siguen mock hasta E02–E05.

## Infra foundational (transversal — no es una HU)
`src/shared/` (contrato Zod), `PrismaService.runInTenant`, `ZodValidationPipe`, `JwtAuthGuard`,
`PoliciesGuard`/CASL, `AuthDbClient`/`gastronomia_auth`, `AuditInterceptor`.

## Próximas épicas
E02 (catálogo/recetas) → E03 (POS) → E04 (cobros) → E05 (inventario) → E06 (costeo) → E07 (reportes) → E08 (forecasting) → E09 (chat) → E10 (notificaciones) → E11 (ingesta). Cada backend habilita proxear sus rutas del BFF.
