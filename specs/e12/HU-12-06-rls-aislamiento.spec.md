# HU-12-06 — Aislamiento multi-tenant verificado (RLS)

> **Épica:** E12 (DevOps) · **Sprint:** S0 · **Must · SP 5 · Deps HU-01-01 · iE3.2**
> **Estado:** 🟡 casi completo (PR #4). Fuente: `Product Backlog.md` → HU-12-06.
> (Antes numerado `HU-E01-01`; renumerado a HU-12-06 en la reconciliación 2026-06-15.)

## Historia
Como **DevOps**, quiero **un test suite que verifica aislamiento RLS**, para **garantizar que ningún tenant ve datos de otro**.

## Criterios de aceptación (Gherkin oficial)
```gherkin
GIVEN suite de tests RLS
WHEN se ejecuta en CI
THEN cada test crea 2 tenants y verifica que tenant A no ve datos de tenant B en NINGUNA tabla
AND prueba para los roles
AND el resultado debe ser 0 fugas
AND si falla, el deploy se bloquea
```

## Implementado ✅
- RLS **ENABLE + FORCE** en `tenants`/`users` + policy `tenant_isolation` (USING+WITH CHECK,
  `NULLIF(current_setting('app.tenant_id',true),'')::uuid` → falla cerrado).
- Rol `gastronomia_app` (NOSUPERUSER, NOBYPASSRLS, owner). `PrismaService.runInTenant` (SET LOCAL por transacción).
- Suite de los **4 vectores**: cross-read, cross-write, bypass JWT, bypass schema-owner → **0 fugas**.
- Detalle/EARS y migración: PR #4 · `db/init/01-roles.sql` · `prisma/migrations/*_init_tenants_users_rls`.

## Gaps vs criterio oficial
- Iterar la verificación **por rol** (modelo de 3 roles owner/manager/staff).
- Cubrir **todas las tablas** a medida que se agreguen (hoy `tenants`/`users`).
- **Gate de CI** (bloquear deploy si falla) → depende de HU-12-01 (CI/CD).

## Tests
`test/rls.e2e-spec.ts` (V1–V4).
