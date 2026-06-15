# HU-01-09 — Audit log de acciones críticas

> **Épica:** E01 · **Sprint:** S1 · **Must · SP 5 · Deps HU-01-04 · iE3.2** · **Estado:** 🟢 hecho.

## Historia
Como **Administrador**, quiero **un registro inmutable de las acciones críticas de mi tenant**, para **auditar quién hizo qué y cumplir Ley 29733**.

## Criterios de aceptación (Gherkin oficial)
```gherkin
GIVEN cualquier accion marcada como @Audited (login, anulaciones, cambios de precio, exports)
WHEN se ejecuta
THEN se persiste en audit_logs con before/after, user_id, IP y user-agent
AND se conserva 5 anos AND no es editable por nadie (incluido el admin)
```

## Implementado ✅
- Tabla `audit_logs` (RLS FORCE) **inmutable**: trigger bloquea UPDATE/DELETE para todos
  (probado incluso como superuser). Solo INSERT/SELECT.
- `@Audited(action)` + `AuditInterceptor` **global**: tras el handler (autenticado), registra
  `action`, `user_id`, `ip`, `user_agent`, `meta` (params) — vía `runInTenant` (RLS).
  `concatMap` → el registro se persiste antes de responder (sin pérdidas ni carreras).
- Aplicado a `user.role.change` (PATCH /users/:id/role) y `settings.update` (PATCH /tenants/settings).
- `GET /api/audit` (read Report: owner/manager ✓, staff 403).

## Gaps / fuera de alcance
- `before/after` detallado por entidad (hoy `meta` = contexto del request); retención 5 años
  (política de almacenamiento). Auditar `login` (no autenticado aún) — caso especial pendiente.

## Trazabilidad → test
`test/audit.e2e-spec.ts` (acciones auditadas visibles para owner; staff 403) + prueba manual
de inmutabilidad (UPDATE/DELETE → error del trigger).
