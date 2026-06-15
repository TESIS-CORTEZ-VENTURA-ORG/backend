# HU-01-04 — Gestión de roles y permisos (RBAC)

> **Épica:** E01 · **Sprint:** S1 · **Must · SP 5 · Deps HU-01-01 · iE3.2**
> **Estado:** 🟢 núcleo completo (gating + 403). Fuente: `Product Backlog.md` → HU-01-04.
> Construye sobre HU-01-02 (JWT con `roles`). Roles reconciliados a 3 (ver `TRACEABILITY.md`).

## Historia
Como **Administrador**, quiero **asignar roles fijos (Owner, Manager, Staff) a mis usuarios**, para **controlar quién accede a qué parte del sistema**.

## Criterios de aceptación (Gherkin oficial)
```gherkin
GIVEN un usuario nuevo
WHEN el admin le asigna un rol
THEN el usuario ve solo las funciones permitidas para ese rol
AND los endpoints API rechazan acciones fuera de su matriz de permisos
GIVEN un mesero (staff) intenta acceder a reportes financieros
THEN recibe HTTP 403 Forbidden
```

## Matriz de permisos (CASL — backend.md §1/§4)
| Rol | Permisos |
|---|---|
| **owner** | `manage all` (todo) |
| **manager** | `read all` + `manage` operativo (Recipe/Inventory/Sale/Order/Report); **sin** escribir Setting ni User |
| **staff** | `read` operativo (Recipe/Inventory/Sale/Order); **sin** Report/User/Setting |

## Implementado ✅
- `CaslAbilityFactory.createForRoles(roles)` → `AppAbility`.
- `@RequireAbility(action, subject)` + `PoliciesGuard` (corre tras `JwtAuthGuard`, lee `req.user.roles`).
- Endpoints demostrativos (`UsersModule`):
  - `GET /api/users` → `@RequireAbility('read','User')` (owner/manager ✓, staff 403).
  - `PATCH /api/users/:id/role` → `@RequireAbility('update','User')` (owner ✓, manager/staff 403) — el admin asigna rol.
- `assignRoles` usa `runInTenant` → RLS impide tocar usuarios de otro tenant.

## Fuera de alcance (siguientes)
- Persistir la matriz por permiso fino (hoy por rol). Condiciones a nivel de fila (CASL conditions).
- Endpoints de negocio reales (Report/Setting) cuando existan sus épicas.

## Trazabilidad R⟨n⟩ → test
| Criterio | Test |
|---|---|
| Matriz por rol | `src/authz/casl-ability.factory.spec.ts` (incl. staff→Report = false) |
| Endpoints rechazan fuera de la matriz (403) | `test/users-rbac.e2e-spec.ts` (staff GET 403, manager PATCH 403) |
| Admin asigna rol | `test/users-rbac.e2e-spec.ts` (owner PATCH 200) |
| Sin token → 401 | `test/users-rbac.e2e-spec.ts` |
