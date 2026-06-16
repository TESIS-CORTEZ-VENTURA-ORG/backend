# HU-11-03/04/05 — Importación de histórico de ventas (CSV)

> **Épica:** E11 (Migración desde ERPs legacy) · **Sprint:** S2 · **Should/Must** · **Estado:** 🟢 hecho (importador CSV con dry-run e idempotencia; el magic-upload con R2/IA del wizard queda diferido).

Primer (y único construible hoy) incremento de E11. Módulo nuevo `ingestion` (`SalesHistoryController` + `SalesHistoryImportService` + `SalesHistoryService`), registrado en `app.module.ts`. Una tabla nueva — `sales_history` — con **RLS FORCE** (verificado `relforcerowsecurity='t'`). Espeja el patrón probado del importador de insumos **HU-02-02** (`ingredients-import.service.ts`): `parseCsv` puro (RFC-4180), mapa de alias de cabecera ES/EN, validación Zod por fila, detección de duplicados en el archivo, upsert idempotente y reporte `{ total, created, updated, failed, errors:[{line,message}] }`. `tenant_id` SIEMPRE del JWT; todo el acceso a BD vía `runInTenant`.

El histórico de ventas alimenta los reportes y, a futuro, el forecasting (cold-start): un restaurante recién migrado puede arrancar con sus ventas reales. **Importante:** la importación NO crea `Order`/`Sale` (eso es el POS, E03/E04 con su flujo, correlativos e IGV); va a una tabla dedicada `sales_history`, append/upsert, sin tocar inventario ni caja.

## Alcance del incremento

**Construido:**

- **HU-11-03** — Importar histórico de ventas: `POST /api/sales-history/import` (CSV crudo) + `GET /api/sales-history?from=&to=` (lista/agrega para verificación y futuros reportes).
- **HU-11-04** — Idempotencia: re-ejecutar el mismo archivo NO duplica; actualiza (o se omite) y reporta `created` vs `updated`.
- **HU-11-05** — Validar antes de importar: `dryRun=true` ejecuta solo la pre-validación (formato, fecha, qty, monto, duplicados) y NO escribe nada, devolviendo el mismo reporte con la lista de errores por línea.

**Diferido (no construible hoy, requiere servicio externo / IA):**

- **HU-11-01** (wizard guiado paso a paso) — es **frontend** (pasos: fuente → subir → mapear → validar → importar; pausar/retomar). El backend ya expone las piezas que el wizard orquesta (`?dryRun` para el paso "Validar", `import` para "Importar").
- **Magic-upload con R2 + IA** (preservar el archivo original en R2 para auditoría; mapeo automático de columnas asistido por IA) — requiere **Cloudflare R2** y el **servicio de IA (E08, FastAPI)**. El importador acepta hoy CSV con alias de cabecera ES/EN (mapeo "best-effort" sin IA).
- **`SalesDailyAggregate` + umbrales de forecasting** (6/12 meses) que menciona el Gherkin de HU-11-03 — la agregación diaria y el "habilitar forecasting con few-shot/buena calidad" pertenecen a **E08 (IA)**; aquí se persiste el detalle (`sales_history`), que es la fuente de esa agregación. `GET /api/sales-history` ya entrega `totalQty`/`totalRevenue` agregados de la ventana.
- **HU-11-02** (importar productos) = **HU-02-02** (ya hecho, PR #16 / E02): el importador de insumos cumple "importar catálogo + validar fila a fila + reporte de errores + idempotente por SKU".

## Modelo de datos

### `sales_history` (RLS FORCE)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `tenantId` | uuid | del JWT; RLS |
| `soldOn` | DateTime (`sold_on`) | fecha/instante de la venta (UTC) |
| `dishName` | String (`dish_name`) | nombre **crudo** del CSV |
| `menuItemId` | uuid? (`menu_item_id`) | enlazado si hay match EXACTO con un plato **activo**; si no, `null`. **No es FK dura** (el plato puede borrarse). |
| `qty` | Int | cantidad vendida (> 0) |
| `unitPrice` | Decimal(12,2) (`unit_price`) | precio unitario (≥ 0); string en la API |
| `total` | Decimal(12,2) | importe de la línea (≥ 0); string en la API |
| `externalRef` | String? (`external_ref`) | clave de idempotencia de la fila origen (si el CSV la trae) |
| `createdAt` | DateTime | |

Índices: `tenantId`, `(tenantId, soldOn)`. **`@@unique([tenantId, externalRef])`** (idempotencia; Postgres permite múltiples `NULL`, así que las filas sin `ref` no chocan). Relación `Tenant → salesHistory`.

Migración `20260615235313_sales_history` (`--create-only` + bloque RLS FORCE anexado a mano, igual que el resto de migraciones de negocio). Verificado en BD local: `relrowsecurity='t'`, `relforcerowsecurity='t'`, policy `tenant_isolation`.

## Contrato CSV (alias de cabecera ES/EN, mapeo por nombre)

| Campo canónico | Alias aceptados | Obligatorio |
|---|---|---|
| `date` | `date`, `fecha` | **sí** (ISO 8601 o `YYYY-MM-DD`) |
| `dish` | `dish`, `plato`, `nombre`, `name` | **sí** |
| `qty` | `qty`, `cantidad`, `quantity` | **sí** (entero > 0) |
| `unitPrice` | `unitPrice`, `unit_price`, `precio`, `price` | uno de los dos (precio/total) |
| `total` | `total`, `monto`, `importe` | uno de los dos (precio/total) |
| `ref` | `ref`, `externalRef`, `external_ref`, `referencia` | opcional (clave de idempotencia) |

Derivación del par precio/total (si falta uno): `total = unitPrice·qty`; `unitPrice = total/qty`. Si llegan ambos, se usan tal cual (se redondean a 2 decimales). Faltar `date`/`dish`/`qty` o **ambos** de precio/total → **400** (columna requerida ausente, igual que HU-02-02). Tope **MAX 20 000 filas** (como el importador de insumos, escalado al volumen de un histórico).

## HU-11-03 · Importar histórico de ventas

```gherkin
GIVEN archivo de ventas con fecha, plato, cantidad, monto
WHEN admin lo sube
THEN se mapean ventas a SalesDailyAggregate
AND si supera 6 meses se habilita forecasting con few-shot
AND si supera 12 meses se habilita forecasting con buena calidad
```

**Implementado ✅** (la agregación diaria y los umbrales de forecasting = E08/IA; ver "Diferido"):

- **`POST /api/sales-history/import`** — `manage Report`, `@Audited('sales_history.import')`. Body `{ content: string, dryRun?: boolean }`. Valida cada fila, enlaza `menuItemId` por nombre, importa idempotente y devuelve el reporte. Respuesta **201** (POST).
- **`GET /api/sales-history?from=&to=`** — `read Report`. Devuelve `{ from, to, totalQty, totalRevenue, rows:[{soldOn, dishName, menuItemId, qty, unitPrice, total}] }`. Ventana ISO opcional; si falta, "hoy" en la zona del tenant (America/Lima, igual que los reportes E07 — la lógica de ventana se replica **inline** para no acoplar el módulo `reports`). Totales (`totalQty`/`totalRevenue`) sobre TODA la ventana; `rows` acotadas a 5 000 (las más recientes) para verificación.

**Enlace del plato:** match EXACTO de `dishName` con un `MenuItem` **activo** (`isActive=true`, `deletedAt=null`); si no hay match, `menuItemId=null` (la fila se importa igual). Se cachea el resultado por nombre dentro de la transacción.

## HU-11-04 · Idempotencia de la importación

```gherkin
GIVEN una importacion previa
WHEN se re-ejecuta el mismo archivo
THEN se detectan duplicados por key (SKU + tenant)
AND se actualizan en lugar de crear duplicados
AND se reporta cuantos creados vs actualizados
```

**Implementado ✅** (el "key" para ventas es `externalRef` o la clave natural, no SKU):

- **Clave de idempotencia:**
  - Si la fila trae `ref` → clave **`(tenantId, externalRef)`** (respaldada por `@@unique`). Re-importar la misma `ref` → **update** (no duplica).
  - Si no trae `ref` → **clave natural `(tenantId, soldOn, dishName, qty, unitPrice)`**. Re-importar una fila idéntica → se encuentra la existente y se **actualiza** (cuenta como `updated`).
- **Dedup dentro del archivo:** `ref` repetida en el mismo archivo → error de fila (`ref duplicada en el archivo`). Fila sin `ref` idéntica a otra del mismo archivo (misma clave natural) → se **omite** silenciosamente (no es error, no se duplica).
- El reporte distingue **`created` vs `updated`**; el `total` cuenta las filas de datos del archivo.

## HU-11-05 · Validar e identificar errores antes de importar

```gherkin
GIVEN archivo subido
WHEN admin hace click en "Validar"
THEN se ejecutan validaciones (formato, FKs, duplicados, valores requeridos)
AND se muestra resumen: N validas, N con error, lista de errores con linea
AND admin decide si importar parcialmente o cancelar
```

**Implementado ✅:**

- **`dryRun=true`** → ejecuta TODA la validación (formato de fila, fecha parseable, qty>0, monto presente y ≥0, duplicados en archivo) pero **NO escribe nada** (`created=0`, `updated=0`); devuelve el mismo reporte con `failed` y `errors:[{line,message}]`. El frontend usa esto para el paso "Validar" del wizard (HU-11-01).
- **Importación parcial:** las filas válidas se importan aunque otras fallen (se reportan los errores con su línea exacta) — igual que HU-02-02. "Cancelar" = el cliente no llama al import (o llama con `dryRun`).

## Reporte (mismo shape que HU-02-02 + `dryRun`)

```jsonc
{
  "total": 3,      // filas de datos del archivo
  "created": 2,    // insertadas
  "updated": 0,    // actualizadas (idempotencia)
  "failed": 1,     // filas con error
  "errors": [{ "line": 4, "message": "qty: ..." }],
  "dryRun": false
}
```

## RBAC (CASL) — decisión

Importar histórico es una tarea de **migración/gestión** (cargar datos masivos a la cuenta), no una operación de turno. Se reutiliza el sujeto CASL existente **`Report`**:

- `POST /import` → **`manage Report`** → **owner** y **manager** (ambos tienen `manage Report` en la matriz); **staff NO** → **403**.
- `GET /` → **`read Report`** → owner/manager; staff → **403** (igual que los reportes E07).

**No se modifica la matriz CASL** (`casl-ability.factory.ts`): owner = `manage all`; manager = `manage [...,'Report',...]`; staff = sin `Report`. Esto es coherente con E06/E07, que ya gobiernan información de gestión (costeo, dashboards) con `Report`.

## Multi-tenancy y seguridad

- `tenant_id` SIEMPRE del claim JWT (`claims.tenant_id`); nunca de path/query/body.
- `sales_history` con **RLS FORCE**; todo el acceso vía `runInTenant` (`SET LOCAL app.tenant_id`).
- El enlace `menuItemId` consulta `MenuItem` dentro del mismo `runInTenant` (mismo tenant); no es FK dura para tolerar borrado del plato.

## Tests — `test/sales-history-import.e2e-spec.ts` (8 casos)

Siembra tenant + owner + manager + staff + plato activo "Lomo Saltado" (con su receta). CSV con 2 filas válidas (una matchea el plato → `menuItemId` enlazado; otra no → `null`) + 1 fila mala (qty 0 → error con línea 4). Cubre:

1. **dryRun=true** → `created 0`, nada persistido, pero `errors` reportados (HU-11-05).
2. **Import real** → `total 3 / created 2 / failed 1`, error en línea 4; GET muestra 2 filas + `totalQty 3` + `totalRevenue 75.00`; "Lomo Saltado" enlazado, "Plato Fantasma" con `menuItemId=null`; `total` derivado (`60.00`).
3. **Re-import del mismo CSV** → `created 0 / updated 2`, sin duplicados (idempotencia por clave natural, HU-11-04).
4. **Idempotencia por `externalRef`** → rerun con `ref` → `created 0 / updated 2`, sin duplicar.
5. **Manager importa** (manage Report) → ok.
6. **Faltan columnas requeridas** → 400.
7. **Staff importa** → **403** (manage Report).
8. **Staff lee** → **403** (read Report).

Moneda/qty como **string** en la API (`.toFixed(2)`). El test corre dentro de la suite e2e compartida (DB Docker local, serial).
