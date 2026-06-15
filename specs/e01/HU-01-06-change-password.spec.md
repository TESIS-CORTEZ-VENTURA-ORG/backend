# HU-01-06 — Cambio de contraseña

> **Épica:** E01 · **Sprint:** S1 · **Should · SP 2 · Deps HU-01-02 · iE3.2** · **Estado:** 🟢 hecho.

## Historia
Como **Usuario**, quiero **cambiar mi contraseña desde mi perfil**, para **mantener la seguridad de mi cuenta**.

## Criterios de aceptación (Gherkin oficial)
```gherkin
GIVEN un usuario autenticado
WHEN ingresa password actual + nueva (min 12 chars, mayus, minus, digito, simbolo)
THEN se actualiza el hash bcrypt
AND se revocan todos sus refresh tokens activos
AND se notifica por email del cambio
```

## Implementado ✅
- `PATCH /api/auth/password` (autenticado, `@Audited('password.change')`). Body
  `{ currentPassword, newPassword }`.
- `strongPasswordSchema` (Zod): min 12 + mayús + minús + dígito + símbolo.
- Verifica la actual; rehashea (bcrypt); **revoca TODOS los refresh tokens** del usuario.
- Contraseña actual incorrecta → 401; nueva débil → 400; sin token → 401.

## Fuera de alcance
- "se notifica por email del cambio" → requiere servicio de correo (diferido).

## Trazabilidad → test
`test/change-password.e2e-spec.ts`: cambio OK + revoca sesiones + solo la nueva sirve;
débil → 400; actual incorrecta → 401; sin token → 401.
