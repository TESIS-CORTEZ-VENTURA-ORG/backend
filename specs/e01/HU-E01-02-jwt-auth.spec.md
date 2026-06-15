# HU-E01-02 — JWT RS256 + login/register + contexto por request

> **Épica:** E01 `auth` + `tenants` · **Sprint:** S1 · **MoSCoW:** MUST
> **Metodología:** SDD (ADR-006). Trazabilidad R⟨n⟩ → test. **Estado:** `spec_ready`
> Construye sobre [[HU-E01-01]] (RLS FORCE + `runInTenant`).

## Contexto

Capa 1 del defense-in-depth (backend.md §4): **JWT RS256** como origen de la verdad del
tenant. Cierra el lazo **JWT → `runInTenant` → RLS**: el `tenant_id` del claim alimenta
el `SET LOCAL app.tenant_id` de cada operación.

## Decisiones

- **RS256** (par RSA dev en `.env` base64; `bun run keys:gen`). access 15m / refresh 7d.
- **bcryptjs** para password (puro JS; argon2id/Better-Auth = hardening en HU-E01-03).
- **register**: crea tenant + owner con *set-then-insert* dentro de `runInTenant` (sin
  privilegios — el WITH CHECK acepta el nuevo tenant). Email global-unique (piloto).
- **login**: la autenticación precede al tenant → lookup por email con rol dedicado
  `gastronomia_auth` (NOSUPERUSER + BYPASSRLS, solo SELECT). No usa superuser.

## Requisitos (EARS)

- **R1** — `TokenService` **debe** emitir access (15m) + refresh (7d) RS256 con claims
  `{ sub, tenant_id, roles }`, y `verifyAccess` **debe** validar la forma con `jwtClaimsSchema`.
- **R2** — `POST /api/auth/register` **debe** validar el body (`registerSchema`), crear
  tenant + owner, hashear el password y devolver tokens. Email duplicado **debe** dar 409;
  body inválido **debe** dar 400.
- **R3** — `POST /api/auth/login` **debe** validar credenciales y devolver tokens; password
  incorrecto o email inexistente **debe** dar 401.
- **R4** — `JwtAuthGuard` **debe** rechazar (401) requests sin Bearer válido y, cuando es
  válido, exponer los claims vía `@CurrentUser()`.
- **R5** — `GET /api/auth/me` (protegido) **debe** leer al usuario dentro de su contexto de
  tenant (`runInTenant`) — demostrando el lazo JWT→RLS — y **no debe** exponer el password.

## Fuera de alcance (siguientes)

- Refresh token rotation / logout / revocación (HU-E01-02b).
- CASL (gating por rol/acción), Better-Auth (orgs/invitaciones), argon2id (HU-E01-03).
- Interceptor que envuelve TODO request en `runInTenant` vía AsyncLocalStorage (refinamiento).
- Exception filter → envelope de error `{ success:false, error }`.

## Trazabilidad R⟨n⟩ → test

| Req | Test |
|---|---|
| R1 | `src/auth/token.service.spec.ts` |
| R2 | `test/auth.e2e-spec.ts` (register 201 / 409 / 400) |
| R3 | `test/auth.e2e-spec.ts` (login 200 / 401) |
| R4 | `test/auth.e2e-spec.ts` (me sin token → 401) |
| R5 | `test/auth.e2e-spec.ts` (me con token → usuario) + `src/auth/password.service.spec.ts` |
