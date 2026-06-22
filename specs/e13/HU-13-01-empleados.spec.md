# HU-13-01 — Registro de empleados del local

> **Épica:** E13 (Personal) · **Sprint:** S-tesis · **Should** · **Estado:** 🟢 hecho.
> Épica nueva fuera del backlog original E01–E12: registro básico de la planilla del
> restaurante, con el salario como dato sensible. Base para costeo de mano de obra (E06) futuro.

## HU-13-01 · CRUD de empleados (SP 3)

```gherkin
WHEN el owner/manager registra un empleado con nombre, DNI, puesto y (opcional) telefono,
     fecha de ingreso y vinculo a un usuario del sistema
THEN queda activo en la planilla del tenant
AND el DNI es unico por tenant (mismo DNI en otro tenant no colisiona)
AND el puesto es uno de: mozo | cocina | caja | otro
AND eliminar = soft delete (deleted_at), no borrado fisico
AND el salario es un dato sensible: solo el owner lo lee y lo escribe
```

**Implementado ✅:** `employees` (RLS FORCE; `@@unique[tenant_id, dni]`; `user_id` único opcional → vínculo 1:1 con `users`). CRUD `/api/employees` (`GET` lista, `POST`, `GET/:id`, `PATCH/:id`, `DELETE/:id`). Validación Zod al borde (`position` enum; `salary` como decimal string `^\d+(\.\d{1,2})?$`; `hiredAt` ISO opcional). DNI duplicado en el mismo tenant → **409**. `DELETE` = **soft delete** (`deleted_at`), `GET/:id` posterior → **404**. `tenant_id` siempre desde el JWT; toda query vía `runInTenant` (R4).

## Salario field-level gating

El campo `salary` (DECIMAL(12,2), columna NOT NULL) es **sensible**:

- **owner**: lee `salary` en todas las respuestas y lo escribe en `create`/`update`.
- **manager / staff con acceso**: el campo `salary` se **omite** de la respuesta (`toView` no lo incluye) y cualquier `salary` en el body se **ignora** al escribir.
- _Nota de diseño (deuda registrada):_ si un manager crea el empleado, el salario se persiste como `'0'` por la restricción NOT NULL (no `null` = "desconocido"). Aceptable para el alcance actual; reconsiderar columna nullable cuando E06 consuma costo de planilla.

## RBAC

Subject **`Employee`**: owner y manager gestionan (`manage`), staff → **403** en todos los endpoints. El salario añade un segundo nivel de gating _dentro_ del rol (owner-only), independiente de CASL.

## Trazabilidad → test

`test/employees.e2e-spec.ts` (15 e2e):

- **CASL**: staff → 403 en `GET` y `POST`.
- **owner**: `POST` 201 con salario / `GET` lista con salario / `GET/:id` con salario / `PATCH` actualiza salario / `DELETE` soft delete / `GET/:id` post-delete 404.
- **manager**: `POST` 201 sin salario en respuesta / `GET/:id` sin campo salario / `PATCH` con salario en body → ignorado / `DELETE` 200.
- **DNI único**: duplicado en mismo tenant → 409 / mismo DNI en otro tenant → 201.
- **Aislamiento (R4)**: owner del tenant A no ve empleados del tenant B.

`src/employees/employees.service.spec.ts` (9 unit): gating de salario en `toView`, mapeo de fechas, ramas de `create`/`update` con y sin owner.
