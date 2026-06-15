# HU-E01-01 — Fundación RLS multi-tenant

> **Épica:** E01 `auth` + `tenants` (Identity, Multi-Tenancy, Seguridad) · **Sprint:** S1 · **MoSCoW:** MUST
> **Riesgo:** R4 (fuga cross-tenant — la falla de mayor severidad del proyecto).
> **Metodología:** SDD / Harness Engineering (ADR-006, ADR-004). Trazabilidad R⟨n⟩ → test.
> **Estado:** `spec_ready`

## Contexto

Defense-in-depth, Capa 2 (backend.md §4): **RLS FORCE** en PostgreSQL. Esta HU es el
**gate de seguridad** que va ANTES de cualquier feature de negocio: deja el aislamiento
por tenant probado con la suite de los 4 vectores.

El `tenant_id` SIEMPRE proviene de `current_setting('app.tenant_id')`, fijado por NestJS
por transacción (SET LOCAL) desde el claim del JWT — nunca del path, query ni body.

## Decisiones de topología (dev)

- Rol **`gastronomia_app`**: `NOSUPERUSER`, `NOBYPASSRLS` → la RLS FORCE le aplica.
  **Posee** las tablas (las crea al migrar) y es el rol de runtime. Provisión idempotente
  en `db/init/01-roles.sql` (init script de compose + aplicable a contenedor existente).
- Seeding cross-tenant de tests y provisioning: conexión **superuser** (`DATABASE_URL_ADMIN`),
  que BYPASEA RLS. Nunca se usa en requests.
- Prod (Neon): separar rol de migración del de runtime (hardening, follow-up).

## Requisitos (EARS)

- **R1** — El runtime **debe** conectarse con un rol no-superuser y sin BYPASSRLS.
- **R2** — Las tablas `tenants` y `users` **deben** tener `tenant_id` (en `users`),
  RLS `ENABLE` **y** `FORCE`, y una policy `tenant_isolation` (USING + WITH CHECK).
- **R3** — `PrismaService.runInTenant(tenantId, fn)` **debe** fijar `app.tenant_id`
  con alcance de transacción y **debe** rechazar un `tenantId` que no sea UUID antes
  de tocar la DB.
- **R4 (cross-read)** — Dentro del tenant A, una lectura **no debe** devolver filas de B.
- **R5 (cross-write)** — Dentro del tenant A, escribir una fila con `tenant_id` de B
  **debe** ser rechazado (WITH CHECK).
- **R6 (bypass JWT)** — Sin `app.tenant_id` fijado, toda consulta **debe** devolver 0 filas
  (falla cerrado).
- **R7 (bypass schema-owner)** — Aun siendo `gastronomia_app` el owner de las tablas, la
  RLS **debe** aplicarle (FORCE).

## Fuera de alcance (siguientes incrementos)

- JWT RS256 + login/register + interceptor que llama a `runInTenant` por request (HU-E01-02).
- CASL + Better-Auth (orgs/invitaciones), roles persistidos en `users` (HU-E01-03).
- Decorador `@TenantScoped` → generador de policies (las policies de E01 van explícitas en SQL).
- Path de provisioning de tenants en el signup (hoy solo el seeding de tests).

## Trazabilidad R⟨n⟩ → test

| Req | Test / evidencia |
|---|---|
| R1 | `db/init/01-roles.sql` (NOSUPERUSER NOBYPASSRLS) + `DATABASE_URL` = gastronomia_app |
| R2 | `prisma/migrations/**/migration.sql` + `test/rls.e2e-spec.ts` V4 (FORCE) |
| R3 | `src/platform/prisma/prisma.service.spec.ts` |
| R4 | `test/rls.e2e-spec.ts` → V1 |
| R5 | `test/rls.e2e-spec.ts` → V2 |
| R6 | `test/rls.e2e-spec.ts` → V3 |
| R7 | `test/rls.e2e-spec.ts` → V4 |
