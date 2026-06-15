# HU-01-01 + HU-01-02 — Registro de restaurante + Login

> **Épica:** E01 · **Sprint:** S1 · **Must** · Fuente: `Product Backlog.md`.
> **Estado:** 🟡 parcial (PR #5). (Antes `HU-E01-02`; renumerado en la reconciliación 2026-06-15.)

## HU-01-01 · Registro de restaurante (tenant) — SP 5
Como **Administrador**, quiero **registrar mi restaurante**, para **tener mi espacio aislado**.
```gherkin
GIVEN un visitante en la pagina de registro
WHEN ingresa RUC valido (11 digitos), nombre y email del admin
THEN se crea el tenant con esquema aislado
AND se envia email de bienvenida
AND el admin queda autenticado automaticamente
```
**Implementado ✅:** `POST /api/auth/register` crea tenant + owner (set-then-insert en `runInTenant`),
hashea password (bcryptjs), y **queda autenticado** (devuelve access+refresh tokens).
**Gaps:** **RUC (11 díg.)** en modelo/validación · **email de bienvenida** (Resend).

## HU-01-02 · Login con email y password — SP 3
```gherkin
GIVEN un usuario registrado y activo
WHEN ingresa credenciales validas
THEN recibe access token (15 min) y refresh token (7 dias)
GIVEN credenciales invalidas
WHEN intenta login 5 veces seguidas
THEN la cuenta se bloquea por 15 minutos
```
**Implementado ✅:** `POST /api/auth/login` → access 15m + refresh 7d (lookup vía rol
`gastronomia_auth` BYPASSRLS). `GET /api/auth/me` (JwtAuthGuard + `runInTenant`) cierra JWT→RLS.
**Gaps:** **bloqueo tras 5 intentos fallidos (15 min)**.

## Tests
`test/auth.e2e-spec.ts` · `src/auth/token.service.spec.ts` · `src/auth/password.service.spec.ts`.
