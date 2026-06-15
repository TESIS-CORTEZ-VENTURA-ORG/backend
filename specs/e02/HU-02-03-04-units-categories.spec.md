# HU-02-03 + HU-02-04 — Unidades de medida y categorías

> **Épica:** E02 · **Sprint:** S1 · **Must (02-03) / Should (02-04)** · Fuente: `Product Backlog.md`. · **Estado:** 🟢 hecho.

## HU-02-03 · Unidades de medida con conversión (SP 3)
```gherkin
WHEN crea unidad con factor de conversion a una unidad base
THEN puede convertir cantidades automaticamente entre unidades de la misma familia
AND el sistema rechaza conversiones entre familias incompatibles (kg a litros)
```
**Implementado ✅:** `units_of_measure` (RLS FORCE; `family ∈ {mass,volume,count}`; `factor_to_base`). CRUD `/api/units`; `GET /api/units/convert?qty&from&to` (misma familia: `qty·from/to`; familias distintas → **400**). Código único por tenant (409).

## HU-02-04 · Categorías jerárquicas (SP 2)
```gherkin
WHEN crea/edita categorias con relacion padre-hija
THEN se renderiza arbol jerarquico AND no se permiten ciclos
AND no se permite eliminar categoria con productos asociados
```
**Implementado ✅:** `categories` (RLS FORCE; `parent_id` autorreferencial). CRUD `/api/categories`; **detección de ciclos** en update (400) y **no eliminar con subcategorías** (409). 
**Nota:** "con productos asociados" se cubrirá cuando `ingredients.category` pase de string a FK (refinamiento futuro).

## RBAC
Ambas bajo subject **`Catalog`**: owner/manager gestionan; staff solo lee.

## Trazabilidad → test
`test/catalog-units-categories.e2e-spec.ts`: conversión 2 kg→2000 g; kg→l 400; staff crea 403 / lee 200; ciclo 400; borrar con hijas 409; staff categoría 403.
