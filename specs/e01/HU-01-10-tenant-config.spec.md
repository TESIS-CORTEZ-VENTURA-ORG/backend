# HU-01-10 — Configuración de parámetros del local

> **Épica:** E01 · **Sprint:** S1 · **Must · SP 3 · Deps HU-01-01 · iE3.2**
> **Estado:** 🟢 hecho (cubre también el dato fiscal **RUC**, gap de HU-01-01).

## Historia
Como **Administrador**, quiero **configurar moneda, IGV, aforo, horarios y datos fiscales**, para **adaptar la plataforma a mi negocio**.

## Criterios de aceptación (Gherkin oficial)
```gherkin
GIVEN admin autenticado
WHEN actualiza configuracion (moneda PEN, IGV 18%, horarios, aforo, direccion fiscal)
THEN los valores se aplican inmediatamente en todo el sistema
AND quedan registrados en audit log
```

## Implementado ✅
- Columnas en `tenants`: `ruc`, `legal_name`, `fiscal_address`, `currency` (default PEN),
  `igv_rate` (default 0.18), `capacity` (aforo), `business_hours` (JSON).
- `GET /api/tenants/settings` (`read Setting`: owner/manager ✓, staff 403).
- `PATCH /api/tenants/settings` (`update Setting`: **solo owner**; manager 403 — "sin escritura en settings").
- Validación Zod (`tenantSettingsSchema`): RUC 11 dígitos, moneda solo `PEN`, IGV 0..1, aforo > 0, horarios HH:MM. PATCH parcial.
- Vía `runInTenant` → solo afecta al tenant del JWT (RLS).

## Gaps / fuera de alcance
- "quedan registrados en audit log" → se conecta al implementar **HU-01-09** (audit).
- El **RUC al registro** (Gherkin de HU-01-01) se setea aquí (paso de onboarding "setup"), no en el signup, para no romper el contrato de `registerSchema` con el frontend.

## Trazabilidad → test
`test/tenants-config.e2e-spec.ts`: owner GET/PATCH 200, manager GET 200 / PATCH 403, staff GET 403, RUC inválido 400, sin token 401.
