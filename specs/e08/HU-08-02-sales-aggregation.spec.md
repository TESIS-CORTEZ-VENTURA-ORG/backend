# HU-08-02 (parte 1/2) — Serie de demanda agregada (seam de forecasting)

> **Épica:** E08 (Motor de Forecasting con IA) · **Sprint:** S4 · **Must** · **Estado:** 🟢 hecho (seam de datos: `sales_history` → serie diaria zero-filled). La llamada a `core-ai` vía BullMQ + persistencia de `ForecastRun` quedan para la parte 2/2.

Primer incremento construible de E08 del lado **orquestador (NestJS)**. La arquitectura firmada manda: **NestJS orquesta, `core-ai` (FastAPI) infiere** (`backend.md` §3). El microservicio `core-ai` ya existe y es *stateless*: recibe el histórico de demanda en el body (`POST /forecast/run`, `history:[{ds,y}]`, `frequency:"D"`) y devuelve el pronóstico. Lo que faltaba era el **seam de datos**: convertir el histórico de ventas (`sales_history`, importado en HU-11) en esa serie temporal regular. Eso es lo que cubre este incremento.

Módulo nuevo `forecasting` (`ForecastingController` + `ForecastingService` + `sales-aggregation.util`), registrado en `app.module.ts`. **No crea tablas**: lee `sales_history` vía `runInTenant` (RLS FORCE) y agrega en memoria. La agregación vive en una **util pura** (`sales-aggregation.util.ts`, sin DB) — testeable a nivel unitario, igual que `csv.util`/`report-window.util` de E07.

## Alcance del incremento

**Construido:**

- **`GET /forecasting/series`** — devuelve la serie de demanda diaria agregada lista para `core-ai`. Query `?scope=total|menuItem&menuItemId=&from=&to=`.
  - `scope=total` (default): demanda diaria de TODO el menú (una serie).
  - `scope=menuItem`: demanda diaria de un plato (`menuItemId` requerido; si no, **400** vía Zod refine).
- **Zero-fill**: los días sin ventas entre el primero y el último se rellenan con `y=0` (un día sin venta es demanda 0, no un hueco — los modelos esperan una serie regular).
- **Bucketing por día local (Lima, UTC-5 sin DST)**: `sold_on` se guarda en UTC; el día se calcula en la zona del tenant (lógica replicada inline, sin importar el módulo `reports` — frontera de módulos).
- **Calidad del histórico** (`dataQuality`): `insufficient` (<6 meses), `few_shot` (≥6 meses), `good` (≥12 meses) — los umbrales que HU-11-03 asocia al forecasting.

**Diferido (parte 2/2, HU-08-02 async):**

- Llamar a `core-ai` `POST /forecast/run` con la serie, vía **BullMQ** (`ForecastRun` en `RUNNING`/`COMPLETED`, polling/SSE de progreso).
- Persistir el pronóstico y exponer `GET /forecasting/predictions` (HU-08-04, predicciones por plato con quantiles).
- Frecuencia semanal (`W`) y covariates peruanos (HU-08-07, XReg).

## Contrato (Zod compartido — `src/shared/forecasting/forecast.ts`)

```jsonc
// Query: GET /forecasting/series
{ "scope": "total" | "menuItem", "menuItemId"?: "uuid", "from"?: "ISO", "to"?: "ISO" }
```

```jsonc
// Respuesta (ApiResponse<DemandSeriesResponse>)
{
  "scope": "total",
  "seriesId": "total",            // "total" | menuItemId
  "label": "Demanda total",
  "frequency": "D",
  "observations": 142,            // días CON venta
  "spanDays": 180,                // amplitud inclusiva primer..último día
  "dataQuality": "few_shot",
  "points": [ { "ds": "2024-01-01", "y": 37 }, { "ds": "2024-01-02", "y": 0 } ]
}
```

`points` es **exactamente** el `history` que consume `core-ai` (`frequency:"D"`). Este es el único punto donde el histórico de ventas se transforma en serie temporal.

## HU-08-02 (Gherkin cubierto por esta parte)

```gherkin
GIVEN un tenant con histórico de ventas importado (sales_history)
WHEN se solicita la serie de demanda (total o por plato)
THEN se devuelve una serie diaria regular (zero-filled) en la zona del tenant
AND se reporta la calidad del histórico (insufficient/few_shot/good)
AND la serie tiene el shape que consume core-ai (history:[{ds,y}], frequency:"D")
```

## RBAC (CASL) — decisión

Generar/leer una serie de demanda es **información de gestión/análisis** (como los dashboards de E07), no una operación de turno. Se reutiliza el sujeto CASL **`Report`**:

- `GET /forecasting/series` → **`read Report`** → owner/manager; **staff → 403**.

No se modifica la matriz CASL (coherente con E06/E07).

## Multi-tenancy y seguridad

- `tenant_id` SIEMPRE del claim JWT; nunca de path/query/body.
- `sales_history` con **RLS FORCE**; todo el acceso vía `runInTenant` (`SET LOCAL app.tenant_id`).
- Lectura `select` mínima (`soldOn`, `menuItemId`, `dishName`, `qty`); la agregación ocurre en memoria sobre lo leído dentro de la transacción del tenant.

## Tests

- **Unit — `src/forecasting/sales-aggregation.util.spec.ts` (8 casos)**: serie vacía; suma del mismo día; **zero-fill** de días intermedios; orden ascendente; filtro por `menuItemId` y exclusión de filas sin enlace; etiqueta = nombre más reciente; umbrales de `dataQuality`. Corre sin DB.
- **e2e (parte 2/2 / a sumar)**: sembrar tenant + owner/manager/staff + `sales_history`; verificar la serie, el 403 de staff y el 400 de `scope=menuItem` sin `menuItemId`. Requiere la DB Docker local (RLS).
