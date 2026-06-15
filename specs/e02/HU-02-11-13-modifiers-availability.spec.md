# HU-02-11 + HU-02-13 — Modificadores del plato y disponibilidad por horario

> **Épica:** E02 · **Sprint:** S3 · **Should (11) / Could (13)** · **Estado:** 🟢 hecho.

## HU-02-11 · Gestión de modificadores
```gherkin
WHEN gerente le agrega modificadores con price_delta
THEN aparecen en POS al seleccionar el plato AND el precio total se ajusta automaticamente
AND los obligatorios deben seleccionarse antes de enviar a cocina
```
**Implementado ✅:** tabla `menu_modifiers` (RLS FORCE) con `price_delta` (puede ser **negativo**, p. ej. "sin queso"), `required` y `position`. Rutas anidadas bajo el plato: `GET/POST /api/menu/items/:itemId/modifiers`, `PATCH/DELETE /api/menu/modifiers/:id`. La bandera `required` se persiste; **su obligatoriedad se aplica al enviar a cocina en POS (E03)** — aquí es catálogo.

## HU-02-13 · Disponibilidad por horario
```gherkin
WHEN gerente define ventana horaria de disponibilidad
THEN solo aparece en POS dentro de esa ventana AND el sistema usa la zona horaria del tenant
```
**Implementado ✅:** tabla `menu_availability` (RLS FORCE): `day_of_week?` (0=domingo..6=sábado; `null` = todos los días) + `start_minute`/`end_minute` (minutos desde medianoche, hora del tenant). Rutas `GET/POST /api/menu/items/:itemId/availability`, `DELETE /api/menu/availability/:id` y **`GET /api/menu/items/:itemId/availability/check?at=<ISO>`** (devuelve `available` + `dayOfWeek` + `minuteOfDay`). La lógica de zona horaria (**America/Lima**, CLAUDE.md §6) y de cobertura de ventana vive en `menu-availability.util.ts` (**funciones puras**, unit-test) — sin ventanas ⇒ disponible siempre; intervalo `[start, end)`.

## RBAC
Subject **`Catalog`** (owner/manager gestionan, staff lee). `@Audited` en create/update/delete.

## Trazabilidad → test
- **Unit** `src/catalog/menu-availability.util.spec.ts`: conversión a Lima (18:00Z→13:00), intervalo `[start,end)`, día acotado, sin ventanas.
- **E2E** `test/menu-modifiers-availability.e2e-spec.ts`: modificador `+5.00`/`required false` + listado; obligatorio con delta `-3.00`; staff→403; sin ventana disponible; ventana 12:00–15:00 → `13:00` dentro / `16:00` fuera.
