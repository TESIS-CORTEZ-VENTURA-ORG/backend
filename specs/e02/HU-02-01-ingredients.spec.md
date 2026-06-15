# HU-02-01 — CRUD de insumos

> **Épica:** E02 (Catálogo, Recetas y Menú) · **Sprint:** S1 · **Must · SP 5 · Deps HU-01-04 · iE3.1**
> **Estado:** 🟢 hecho. Primera HU de E02.

## Historia
Como **Gerente**, quiero **crear, editar, eliminar y listar mis insumos**, para **mantener el catálogo base del restaurante**.

## Criterios de aceptación (Gherkin oficial)
```gherkin
GIVEN gerente autenticado
WHEN crea insumo (SKU, nombre, tipo, unidad, categoria, costo inicial)
THEN se persiste con tenant_id y es visible solo en su tenant
AND el SKU es unico por tenant
AND soft delete preserva referencias historicas
```

## Implementado ✅
- Tabla `ingredients` (RLS FORCE; `@@unique([tenant_id, sku])`; `unit_cost` Decimal(12,2) en S/).
- `CatalogModule`: CRUD `/api/ingredients` (POST/GET/GET:id/PATCH/DELETE) vía `runInTenant` (aislado por tenant).
- **Soft delete** (`deleted_at`); las listas filtran `deleted_at IS NULL`.
- RBAC (subject **`Catalog`**): owner/manager **gestionan**; staff **solo lee** (POS/KDS necesita el catálogo).
- SKU duplicado → 409. `unit`/`category` son strings (FK a `units_of_measure`/categorías en HU-02-03/04).
- `unitCost` se devuelve como **string** (precisión Decimal).

## Trazabilidad → test
`test/ingredients.e2e-spec.ts`: manager crea 201 (unitCost string), staff crea 403,
staff lee 200, SKU dup 409, update 200, soft-delete 200 (desaparece), sin token 401.
+ matriz `Catalog` en `src/authz/casl-ability.factory.spec.ts`.
