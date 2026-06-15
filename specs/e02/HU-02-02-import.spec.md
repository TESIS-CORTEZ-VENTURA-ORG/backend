# HU-02-02 — Carga masiva de insumos vía Excel/CSV

> **Épica:** E02 · **Sprint:** S2 · **Should** · **Estado:** 🟢 hecho.

## Historia
```gherkin
GIVEN un archivo Excel con columnas estandarizadas
WHEN gerente lo sube
THEN se valida cada fila (formato, duplicados, FKs)
AND se importan los validos
AND se muestra reporte de errores con linea exacta
AND la operacion es idempotente (rerunnable sin duplicar)
```

## Implementado ✅
`POST /api/ingredients/import` con cuerpo `{ content: <texto CSV> }`. El cliente/BFF lee el archivo Excel/CSV y envía su texto (sin servicio externo; el parseo es server-side).

- **Parser CSV propio** (`src/common/csv.util.ts`, RFC 4180): comillas, comillas escapadas, comas y saltos de línea embebidos, CRLF. Devuelve cada registro con su **línea física** → reportes con línea exacta. Sin dependencias, unit-test.
- **Mapeo de columnas por nombre** (no por posición), con alias ES/EN: `sku|codigo`, `name|nombre`, `type|tipo`, `unit|unidad`, `unitCost|costo|cost`, `category|categoria`. Requeridas: `sku,name,type,unit` → si faltan, **400**.
- **Validación por fila**: formato (Zod, `unitCost` coaccionado de texto) + **duplicados dentro del archivo** (SKU repetido → error). *FKs*: `category`/`unit` son texto libre en el modelo de HU-02-01 (no hay FK dura que validar; se documenta).
- **Importa solo las válidas**; cada fila inválida **no aborta** el resto (se valida todo primero, luego se importan las válidas en una transacción).
- **Idempotente**: upsert por `SKU` (único por tenant) — rerun ⇒ actualiza, nunca duplica. Reimportar un SKU borrado lo reactiva.
- **Reporte**: `{ total, created, updated, failed, errors: [{ line, message }] }`.
- Tope de seguridad: `MAX_IMPORT_ROWS = 5000` (excedido → 400, sin truncado silencioso).

## RBAC
`create` sobre **`Catalog`** (owner/manager). `@Audited('ingredient.import')`. staff → 403.

## Trazabilidad → test
- **Unit** `src/common/csv.util.spec.ts`: cabecera+filas con línea, comillas/escapes, CRLF + líneas en blanco, saltos embebidos.
- **E2E** `test/ingredients-import.e2e-spec.ts`: 2 válidos + 2 errores (líneas 4 y 5) → reporte; rerun → `created 0/updated 2` sin duplicar (`unitCost` 32.00); faltan columnas → 400; staff → 403.
