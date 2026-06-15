# HU-01-03 + HU-01-08 (+ gap HU-01-02) — Ciclo de vida de la sesión

> **Épica:** E01 · **Sprint:** S1 · **Must** · Fuente: `Product Backlog.md`.
> **Estado:** 🟢 hecho. Construye sobre HU-01-02 (login) y HU-12-06 (RLS).

## HU-01-03 · Refresh token con rotación (SP 3)
```gherkin
GIVEN un access token expirado
WHEN el frontend envia el refresh token
THEN se emite un nuevo par de tokens AND el refresh anterior queda revocado
GIVEN un refresh token reusado (detectado)
THEN se revocan TODOS los tokens de la familia y se cierra sesion
```
**Implementado ✅:** `POST /api/auth/refresh`. Tokens **opacos** (`randomBytes`, se guarda solo el SHA-256) con **familia de rotación**. `RefreshTokenService.rotate`: revoca el actual, emite uno nuevo en la misma familia; reusar un token revocado → **revoca toda la familia** (`refresh_tokens`, RLS FORCE; CRUD vía rol `gastronomia_auth` BYPASSRLS).

## HU-01-08 · Cierre de sesión (SP 1)
```gherkin
WHEN hace click en "Cerrar sesion" THEN se revoca su refresh token actual
```
**Implementado ✅:** `POST /api/auth/logout` → `RefreshTokenService.revoke`. El BFF del frontend además limpia la cookie sellada.

## Gap HU-01-02 · Bloqueo tras intentos fallidos
```gherkin
WHEN intenta login 5 veces seguidas THEN la cuenta se bloquea por 15 minutos
```
**Implementado ✅:** contador `failed_login_attempts` + `locked_until` en `users`; al 5º fallo se bloquea 15 min (SQL crudo vía `gastronomia_auth`, grant column-level). Login correcto resetea el contador.

## Fuera de alcance
- Auto-refresh del BFF (interceptor 401 → /refresh) — refinamiento del frontend.
- Notificación por email del bloqueo.

## Trazabilidad → test
| Criterio | Test |
|---|---|
| Rotación | `test/session.e2e-spec.ts` (HU-01-03 rota) |
| Detección de reuso | `test/session.e2e-spec.ts` (REUSO → 401 + familia) |
| Logout revoca | `test/session.e2e-spec.ts` (HU-01-08) |
| Lockout 5 intentos | `test/session.e2e-spec.ts` (HU-01-02) |
| Access RS256 | `src/auth/token.service.spec.ts` |
