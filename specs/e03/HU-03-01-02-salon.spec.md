# HU-03-01 + HU-03-02 — Zonas, mesas y datos del mapa de salón

> **Épica:** E03 · **Sprint:** S2 · **Must** · **Estado:** 🟢 hecho (datos; real-time vía polling).

## HU-03-01 · Configurar zonas y mesas
```gherkin
WHEN crea zonas y agrega mesas (codigo, capacidad)
THEN se renderiza mapa visual AND el codigo de mesa es unico por tenant
AND se pueden mover mesas entre zonas via drag-and-drop
```
**Implementado ✅:** `zones` + `dining_tables` (RLS FORCE). `GET/POST/PATCH/DELETE /api/zones` y `/api/tables`. `code` **único por tenant** (`@@unique([tenant_id, code])` → 409 si se repite). **Mover de zona** = `PATCH /api/tables/:id { zoneId }`. `posX/posY` reservados para el layout drag-and-drop. Borrar zona con mesas → **409**; borrar mesa solo si está `free` → si no, 409.

## HU-03-02 · Vista mapa de mesas (estado)
```gherkin
THEN ve mapa con colores por estado AND si otro usuario cambia estado se actualiza en <1s
```
**Implementado ✅ (datos):** `GET /api/tables` devuelve cada mesa con `zoneName`, `code`, `capacity`, `status` (`free|occupied|bill|reserved`, alineado al mapa POS del frontend) y `posX/posY`. **Real-time:** por ahora **polling** (el frontend ya refresca con Pinia Colada); el push <1s (SSE, arquitectura REST+SSE) queda como mejora — NO requiere servicio externo.

## RBAC
Subjects **`Zone`** y **`Table`**. Configurar (crear/editar/eliminar zonas y crear/eliminar mesas) = **owner/manager**. Operar el estado de la mesa (`PATCH`) = también **staff** (mesero abre/solicita cuenta). `@Audited` en todas las mutaciones.

## Trazabilidad → test
`test/salon.e2e-spec.ts`: crea zonas/mesas, code duplicado→409, lista con `zoneName`, mover de zona, staff PATCH estado OK pero crear→403, borrar zona con mesas→409, borrar mesa libre + zona vacía OK. Unit `casl-ability.factory.spec.ts`: manager configura / staff opera-no-configura.
