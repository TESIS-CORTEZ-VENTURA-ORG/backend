# Spec E09 — Chat IA: Asistente analítico Text-to-SQL

**Épica:** E09 — Chat IA (`chat-orchestrator`)
**HU:** HU-09-01 · Consulta analítica en lenguaje natural
**Prioridad:** MUST · Sprint 5
**Actualizado:** 2026-07-02

---

## 1. Contexto y motivación

El dueño de un restaurante necesita hacer preguntas analíticas sobre su negocio en lenguaje natural ("¿cuál fue mi plato más rentable en junio?") sin saber SQL. El sistema debe:

1. Traducir la pregunta a una consulta PostgreSQL read-only segura (NestJS → core-ai → LLM).
2. Ejecutar la consulta **bajo RLS FORCE** para garantizar aislamiento total de tenant.
3. Humanizar la respuesta con el mismo LLM.
4. Rechazar **cualquier SQL no-SELECT** con un gate de validación de 9 reglas antes de ejecutar.

Esta es la feature con mayor impacto de seguridad del proyecto: Text-to-SQL sobre una base multi-tenant con RLS FORCE.

---

## 2. Arquitectura (dos capas, sin cruce de módulos)

```
Browser → POST /api/chat/query (NestJS ChatController)
  → ChatService
      → CoreAiChatClient → core-ai POST /chat/nl2sql   [LLM adapter: mock|openai|anthropic|xai]
      → validateSql() [9 reglas, REJECT-on-doubt]
      → PrismaService.runInTenant(tenantId, fn)
          → SET LOCAL statement_timeout = '5000'
          → $queryRawUnsafe(validSql)     [RLS FORCE activo]
      → CoreAiChatClient → core-ai POST /chat/answer   [opcional, graceful]
  → ApiResponse<ChatQueryResponse>
```

core-ai NO tiene acceso a la base de datos de negocio.

---

## 3. Requisitos funcionales (EARS)

| ID  | Requisito                                                                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | El sistema DEBE aceptar `POST /api/chat/query { question: string }` con JWT válido y rol `owner` o `manager`.                                                                                                                                 |
| R2  | El sistema DEBE enviar la pregunta + schema_context curado a `core-ai POST /chat/nl2sql` y recibir un SQL.                                                                                                                                    |
| R3  | El sistema DEBE pasar el SQL por el validador de 9 reglas antes de ejecutarlo. Si falla, DEBE responder 400 con mensaje amigable y NO ejecutar nada.                                                                                          |
| R4  | El sistema DEBE ejecutar el SQL válido dentro de `runInTenant` (RLS FORCE) con `SET LOCAL statement_timeout = '5000'`.                                                                                                                        |
| R5  | El sistema DEBE intentar obtener una respuesta humanizada de `core-ai POST /chat/answer`; si falla, el endpoint responde de todas formas (degradado).                                                                                         |
| R6  | El sistema DEBE devolver `{ answer, sql, columns, rows, provider, model }` en el envelope `ApiResponse<T>`.                                                                                                                                   |
| R7  | El sistema DEBE rechazar `staff` con 403 (`read Report` requerido).                                                                                                                                                                           |
| R8  | El sistema DEBE rechazar requests sin token con 401.                                                                                                                                                                                          |
| R9  | Los `rows` NO deben contener datos de otro tenant aunque el SQL sea genérico (RLS FORCE garantiza el aislamiento).                                                                                                                            |
| R10 | Si el SQL VALIDADO falla al EJECUTARSE (columna/tabla inexistente, timeout, etc.), el sistema DEBE responder con un error controlado (502 si es un problema del SQL generado, 504 si excedió `statement_timeout`) — NUNCA un 500 sin manejar. |

---

## 3.1 Incidente 2026-07-02 — bug fix (post-mortem breve)

**Síntoma 1:** `POST /api/chat/query { "question": "¿Qué insumos están por agotarse?" }` devolvía `500 Internal server error`.

**Causa raíz:** el `schema_context` curado (`src/chat/schema-context.ts`) describía columnas de `ingredients` que **no existen** en el schema real (`current_cost`, `unit_id`, `category_id`, `is_active`) y **omitía** las columnas reales `stock`/`min_stock`. El LLM generó `SELECT i.current_cost FROM ingredients i ...`, que pasó el validador de 9 reglas (solo valida sintaxis/tablas, no columnas) pero falló en Postgres con `42703 column i.current_cost does not exist`. El error de `$queryRawUnsafe` no estaba envuelto en try/catch → excepción sin manejar → 500 genérico.

**Síntoma 2:** "¿qué insumos tienen stock bajo?" respondía "no hay" pese a existir 2 insumos críticos (Pulpo, Conchas de abanico) en los datos demo.

**Causa raíz:** al no tener `stock`/`min_stock` disponibles en el `schema_context`, el LLM reconstruía el stock desde `inventory_movements` asumiendo `type IN ('in','out')` — un enum que no existe (el real es `purchase|sale|waste|adjustment|count` con `qty` como delta firmado). El `CASE WHEN` nunca matcheaba → balance siempre 0 para todos los insumos → falso negativo.

**Fix:**

1. `schema-context.ts` reescrito para reflejar EXACTAMENTE las columnas reales de `prisma/schema.prisma` (no solo `ingredients` — se auditaron y corrigieron las 24 tablas ya documentadas: `orders`, `payments`, `menu_categories`, `recipes`, `recipe_items`, `inventory_movements`, `purchase_orders`, `purchase_order_items`, `overhead_costs`, `costing_closes`, `forecast_runs`, `suppliers`, `units_of_measure`, `categories`, `zones`, `dining_tables`, `cash_closes` tenían el mismo tipo de drift).
2. `ChatService.query` (Paso 3) ahora envuelve la ejecución en `try/catch` y clasifica el error: SQLSTATE `57014` (timeout) → 504; cualquier otro fallo de ejecución → 502 (R10). El mensaje al cliente es genérico y no filtra detalle interno, igual que el rechazo del validador (R3).

---

## 4. Reglas de validación SQL (9 reglas, hard-gate)

| Regla   | Descripción                                                                                                                                                                                                 |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-SQL-1 | Strip comments (`--` y `/* */`) + normalizar whitespace.                                                                                                                                                    |
| R-SQL-2 | Sin punto y coma embebido (single statement). Rechazar si hay `;` antes del final.                                                                                                                          |
| R-SQL-3 | Debe iniciar con `SELECT` o `WITH`. Cualquier otra cosa → rechazar.                                                                                                                                         |
| R-SQL-4 | Sin keywords DDL/DML bloqueadas: INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, GRANT, REVOKE, COPY, CALL, DO, VACUUM, EXECUTE, PREPARE, MERGE, etc. (match de palabra completa, case-insensitive). |
| R-SQL-5 | Sin acceso a catálogos de sistema (`pg_*`, `information_schema`).                                                                                                                                           |
| R-SQL-6 | Sin funciones peligrosas (`pg_read_file`, `dblink`, `lo_import`, `lo_export`, `pg_sleep`).                                                                                                                  |
| R-SQL-7 | Sin columnas sensibles (`salary`).                                                                                                                                                                          |
| R-SQL-8 | Todas las tablas referenciadas en FROM/JOIN deben estar en el allowlist de analytics (no `users`, `refresh_tokens`, `audit_logs`, `tenants`).                                                               |
| R-SQL-9 | LIMIT ≤ 200 filas. Si ausente, se agrega automáticamente.                                                                                                                                                   |

---

## 5. Allowlist de tablas (analytics)

`sales`, `order_items`, `orders`, `menu_items`, `menu_categories`, `menu_modifiers`, `menu_availability`, `recipes`, `recipe_items`, `recipe_versions`, `ingredients`, `ingredient_price_history`, `units_of_measure`, `categories`, `suppliers`, `product_suppliers`, `inventory_movements`, `purchase_orders`, `purchase_order_items`, `sales_history`, `overhead_costs`, `costing_closes`, `employees` (sin columna salary), `forecast_runs`, `payments`, `cash_closes`, `kitchen_stations`, `zones`, `dining_tables`, `notifications`.

---

## 6. Proveedores LLM (core-ai)

| Provider    | Env var             | SDK                                           | Modelo por defecto |
| ----------- | ------------------- | --------------------------------------------- | ------------------ |
| `openai`    | `OPENAI_API_KEY`    | openai Python SDK                             | `gpt-4o-mini`      |
| `anthropic` | `ANTHROPIC_API_KEY` | anthropic Python SDK                          | `claude-haiku-4-5` |
| `xai`       | `XAI_API_KEY`       | openai SDK con `base_url=https://api.x.ai/v1` | `grok-3-mini`      |
| `mock`      | — (ninguna)         | sin SDK                                       | `mock-v1`          |

Auto-selección: `CORE_AI_CHAT_PROVIDER` → primera clave presente → `mock`.

---

## 7. Escenarios Gherkin

```gherkin
Feature: Chat IA — consulta analítica Text-to-SQL (HU-09-01)

  Background:
    Given el tenant "Motif" existe con un owner y un manager y un staff
    And la base de datos tiene ventas históricas para "Motif"
    And core-ai usa el proveedor mock (sin API key)

  Scenario: Happy path — owner consulta ventas totales
    Given el usuario autenticado es owner de "Motif"
    When envía POST /api/chat/query con question="¿cuáles son mis ventas totales?"
    Then el sistema responde 200
    And el cuerpo contiene answer, sql (SELECT), columns, rows, provider="mock"
    And el SQL comienza con SELECT o WITH

  Scenario: RBAC — staff no puede usar el chat analítico
    Given el usuario autenticado es staff de "Motif"
    When envía POST /api/chat/query con question="ventas"
    Then el sistema responde 403

  Scenario: Sin token → 401
    Given no hay Authorization header
    When envía POST /api/chat/query con question="ventas"
    Then el sistema responde 401

  Scenario: Validación — DELETE rechazado antes de ejecutar
    Given el usuario es owner
    And core-ai retornó el SQL "DELETE FROM sales_history"
    When el validador procesa ese SQL
    Then rechaza con error de regla 3 (no empieza con SELECT)
    And el endpoint responde 400

  Scenario: Validación — DROP rechazado
    Given el SQL generado es "SELECT 1; DROP TABLE sales_history"
    When el validador procesa ese SQL
    Then rechaza con error de regla 2 (multi-statement)

  Scenario: Validación — tabla users rechazada
    Given el SQL generado es "SELECT email FROM users LIMIT 10"
    When el validador procesa ese SQL
    Then rechaza con error de regla 8 (tabla no en allowlist)

  Scenario: Validación — columna salary rechazada
    Given el SQL generado es "SELECT salary FROM employees LIMIT 10"
    When el validador procesa ese SQL
    Then rechaza con error de regla 7 (columna sensible)

  Scenario: RLS — tenant A no ve datos de tenant B
    Given el tenant "Motif" tiene ventas de "Lomo Saltado" (qty=5)
    And el tenant "Otro" tiene ventas de "Ajeno" (qty=999)
    And el usuario es owner de "Motif"
    When consulta "¿cuáles son mis platos más vendidos?"
    Then las rows NO contienen "Ajeno" ni qty=999
    And las rows SÍ contienen "Lomo Saltado"

  # --- R10 · degradación controlada en fallos de EJECUCIÓN (bugfix 2026-07-02) ---

  Scenario: Ejecución — columna inexistente en SQL validado → 502, nunca 500
    Given el usuario es owner
    And core-ai retornó el SQL "SELECT i.current_cost FROM ingredients i LIMIT 200"
    And ese SQL PASA el validador de 9 reglas (tabla permitida, sin DDL/DML)
    When Postgres rechaza la ejecución con 42703 (column does not exist)
    Then el endpoint responde 502 (Bad Gateway), nunca 500
    And el mensaje es genérico, sin detalle interno del error de Postgres

  Scenario: Ejecución — timeout del statement_timeout → 504
    Given el usuario es owner
    And el SQL validado excede el `SET LOCAL statement_timeout = '5000'`
    When Postgres cancela la consulta con SQLSTATE 57014
    Then el endpoint responde 504 (Gateway Timeout), nunca 500

  Scenario: Stock bajo — ingredients.stock/min_stock son la fuente de verdad
    Given el tenant "Motif" tiene el insumo "Pulpo" con stock=1.5 y min_stock=5
    And tiene el insumo "Cebolla roja" con stock=20 y min_stock=5
    And core-ai retornó "SELECT name, stock, min_stock FROM ingredients WHERE stock <= min_stock"
    When el usuario consulta "¿qué insumos tienen stock bajo?"
    Then las rows contienen "Pulpo"
    And las rows NO contienen "Cebolla roja"
```

---

## 8. Contrato REST

### Request

```
POST /api/chat/query
Authorization: Bearer <jwt>
Content-Type: application/json

{ "question": "¿cuál fue mi plato más rentable en junio?" }
```

### Response 200

```json
{
  "success": true,
  "data": {
    "answer": "El plato más rentable fue Lomo Saltado con un margen de S/ 15.50.",
    "sql": "SELECT dish_name, SUM(total) AS total_revenue FROM sales_history GROUP BY dish_name ORDER BY total_revenue DESC LIMIT 10",
    "columns": ["dish_name", "total_revenue"],
    "rows": [
      ["Lomo Saltado", "155.00"],
      ["Ceviche", "120.00"]
    ],
    "provider": "mock",
    "model": "mock-v1"
  }
}
```

### Response 400 (SQL inválido — falla el VALIDADOR)

```json
{
  "success": false,
  "error": {
    "code": "BAD_REQUEST",
    "message": "No pude generar una consulta segura para eso: ..."
  }
}
```

### Response 502 (SQL válido mas no EJECUTABLE contra el schema real)

```json
{
  "statusCode": 502,
  "message": "No pude ejecutar la consulta que generé para tu pregunta. Probá reformularla de otra manera.",
  "error": "Bad Gateway"
}
```

### Response 504 (excedió `statement_timeout`)

```json
{
  "statusCode": 504,
  "message": "La consulta tardó demasiado en responder. Probá acotar el rango de fechas o ser más específico.",
  "error": "Gateway Timeout"
}
```

---

## 9. Evidencia de trazabilidad (ABET SO7)

| Requisito                       | Test                                                      | Archivo                                                         |
| ------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------- |
| R1 (happy path)                 | `owner gets answer`                                       | `test/chat.e2e-spec.ts`                                         |
| R3 (validator gate)             | todos los security tests                                  | `src/chat/sql-validator.util.spec.ts` + `test/chat.e2e-spec.ts` |
| R4 (RLS FORCE)                  | `RLS: tenant A no ve tenant B`                            | `test/chat.e2e-spec.ts`                                         |
| R7 (staff 403)                  | `RBAC: staff 403`                                         | `test/chat.e2e-spec.ts`                                         |
| R8 (401 sin token)              | `no token 401`                                            | `test/chat.e2e-spec.ts`                                         |
| R9 (RLS cross-read)             | `tenant isolation`                                        | `test/chat.e2e-spec.ts`                                         |
| R10 (502 en fallo de ejecución) | `execution-time failure degradation (never a raw 500)`    | `test/chat.e2e-spec.ts` + `src/chat/chat.service.spec.ts`       |
| R10 (504 en timeout)            | `statement_timeout (57014) → 504 GatewayTimeoutException` | `src/chat/chat.service.spec.ts`                                 |
| schema_context ↔ schema real    | regression suite                                          | `src/chat/schema-context.spec.ts`                               |
