# HU-02-07 + HU-02-08 + HU-02-09 — Recetas (BOM), sub-recetas y versionado

> **Épica:** E02 · **Sprint:** S2 · **Must (07) / Should (08, 09)** · **Estado:** 🟢 hecho.

## HU-02-07 · Receta estandarizada (BOM) — costo dinámico
```gherkin
WHEN agrega ingredientes, cantidades, unidades y waste_factor
THEN se calcula costo total dinamico AND se actualiza si cambia el precio de algun insumo
AND el waste_factor se aplica como multiplicador sobre la cantidad
```
**Implementado ✅:** `recipes` + `recipe_items` (RLS FORCE). `POST/GET/PATCH/DELETE /api/recipes`. Costo = Σ `qty·(1+waste)·costo`; **dinámico** (se recalcula al leer, con el `unit_cost` actual del insumo). `costPerYield` por rendimiento. Desglose `lineCost` por ítem.

## HU-02-08 · Sub-recetas anidadas
```gherkin
WHEN se agrega una receta como ingrediente type=RECIPE THEN el costo se calcula recursivamente
AND se detectan ciclos (A usa B que usa A) y se rechazan AND la profundidad maxima es 5 niveles
```
**Implementado ✅:** `recipe_items.sub_recipe_id`. Costo **recursivo** (`Decimal`); **detección de ciclos** (set `visiting` → 400) y **profundidad ≤ 5** (→ 400). Sub-receta aporta `qty·(1+waste)·(costoSub/yieldSub)`.

## HU-02-09 · Versionado de recetas
```gherkin
WHEN se modifica algun ingrediente o cantidad THEN se crea RecipeVersion con snapshot completo
AND el numero de version se incrementa
```
**Implementado ✅:** al editar `items` se incrementa `recipe.version` y se guarda un `recipe_versions` (snapshot JSON con el costo del momento). RLS FORCE.

## RBAC
Subject **`Catalog`**: owner/manager gestionan, staff lee. `@Audited` en create/update.

## Trazabilidad → test
`test/recipes.e2e-spec.ts`: Aderezo=10.00, Lomo=40.00 (ingrediente+sub); ciclo→400; editar→version 2 + costo 70.00 + snapshot; staff crea→403.
