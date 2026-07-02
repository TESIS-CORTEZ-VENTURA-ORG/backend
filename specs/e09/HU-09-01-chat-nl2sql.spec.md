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

| ID   | Requisito                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1   | El sistema DEBE aceptar `POST /api/chat/query { question: string }` con JWT válido y rol `owner` o `manager`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| R2   | El sistema DEBE enviar la pregunta + schema_context curado a `core-ai POST /chat/nl2sql` y recibir un SQL.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| R3   | El sistema DEBE pasar el SQL por el validador de 9 reglas antes de ejecutarlo. Si falla, DEBE responder 400 con mensaje amigable y NO ejecutar nada.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| R4   | El sistema DEBE ejecutar el SQL válido dentro de `runInTenant` (RLS FORCE) con `SET LOCAL statement_timeout = '5000'`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| R5   | El sistema DEBE intentar obtener una respuesta humanizada de `core-ai POST /chat/answer`; si falla, el endpoint responde de todas formas (degradado).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| R6   | El sistema DEBE devolver `{ answer, sql, columns, rows, provider, model }` en el envelope `ApiResponse<T>`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| R7   | El sistema DEBE rechazar `staff` con 403 (`read Report` requerido).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| R8   | El sistema DEBE rechazar requests sin token con 401.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| R9   | Los `rows` NO deben contener datos de otro tenant aunque el SQL sea genérico (RLS FORCE garantiza el aislamiento).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| R10  | Si el SQL VALIDADO falla al EJECUTARSE (columna/tabla inexistente, timeout, etc.), el sistema DEBE responder con un error controlado (502 si es un problema del SQL generado, 504 si excedió `statement_timeout`) — NUNCA un 500 sin manejar.                                                                                                                                                                                                                                                                                                                                                                                                       |
| R11  | El sistema DEBE clasificar la pregunta (`historical` \| `future` \| `out_of_domain` \| `ambiguous`) ANTES de decidir si llama a core-ai. `historical` es el único caso que reutiliza el flujo R1-R10 sin cambios.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| R12  | Si la pregunta es `future`, el sistema DEBE responder con los `points`/`drivers` de la última `ForecastRun` `completed` (scope=total) dentro del rango preguntado, con un disclaimer explícito ("proyección del modelo, no venta confirmada") — DEBE NO generar SQL. Sin corrida completada, o con el rango fuera del horizonte pronosticado, DEBE explicarlo y sugerir generar/ampliar el pronóstico — DEBE NO disparar una corrida automáticamente.                                                                                                                                                                                               |
| R12b | (LOTE B5, QA-23) `totalYhat`/`totalLo`/`totalHi` están en la UNIDAD REAL de la serie (`platos` — la serie `scope='total'` agrega `qty` de `sales_history`, nunca dinero). El sistema DEBE narrar esa unidad explícitamente (`unitLabel`) y DEBE NO re-etiquetar unidades como soles. Si hay ventas en los últimos 30 días, el sistema PUEDE derivar y declarar una estimación de ingresos (`estimatedRevenue = unidades × ticket promedio por plato`), etiquetada como estimación DERIVADA (nunca una proyección de ingresos independiente). Sin ventas en esa ventana, `estimatedRevenue` DEBE ser `null` — el sistema DEBE NO inventar un precio. |
| R11b | (LOTE B5, QA-24) La clasificación DEBE reconocer el futuro morfológico simple español ("venderé", "ganaré", "tendré" — no solo la construcción ir-a-infinitivo) como señal de futuro. Un nombre de mes explícito (p. ej. "diciembre") DEBE resolverse a la PRÓXIMA ocurrencia de ese mes (nunca al pasado) cuando acompaña una señal de futuro ya confirmada — un nombre de mes aislado, sin señal de futuro, DEBE seguir clasificando `historical` (no reescribe preguntas históricas legítimas sobre meses pasados).                                                                                                                              |
| R12c | (LOTE B5, QA-22) Cuando varios `drivers` en el rango comparten el mismo `label` (p. ej. `weekend` en sábado Y domingo), la frase de `answer` DEBE narrar ese label UNA sola vez — nunca duplicado. `forecast.drivers` (el array crudo, para el chip/gráfico del frontend) NO se deduplica — solo la frase en `answer`.                                                                                                                                                                                                                                                                                                                              |
| R13  | Si la pregunta es `out_of_domain`, el sistema DEBE rechazarla con un mensaje fijo — DEBE NO llamar a core-ai ni ejecutar SQL.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| R14  | Si la pregunta es `ambiguous`, el sistema DEBE pedir precisión ofreciendo 2-3 preguntas concretas de ejemplo — DEBE NO llamar a core-ai ni ejecutar SQL ni volcar filas.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| R15  | La clasificación NUNCA debe permitir saltear el validador de 9 reglas (R3) cuando SÍ se genera SQL (`historical`) — los guardrails existentes (columna `salary`, RLS, timeout) permanecen intactos.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

---

## 3.2 Refinamiento LOTE B3 (2026-07-02) — preguntas sobre el futuro + rechazo elegante fuera de dominio (QA-08)

**Motivación:** el chat E09 solo respondía sobre el pasado (NL→SQL contra `sales_history`). QA-08 reportó dos síntomas: (1) preguntas fuera de dominio ("¿quién ganó el mundial?") o ambiguas ("¿cómo va todo?") producían un `SELECT` masivo y un volcado de cientos de UUIDs antes de admitir que no había información relevante; (2) el chat no sabía responder "¿cuánto voy a vender este fin de semana?" — una pregunta sobre el FUTURO, que NUNCA tiene respuesta posible contra `sales_history` (no hay "ventas futuras" ahí).

**Decisión de clasificación — heurística determinística, NO un paso de LLM** (ver JSDoc completo en `src/chat/intent-classifier.util.ts`):

1. **Restricción de alcance:** este lote NO puede tocar `team-core-ai`. Los únicos endpoints de chat en core-ai son `/chat/nl2sql` (traduce NL→SQL contra el schema real) y `/chat/answer` (narra filas) — ninguno es un clasificador, y reutilizar `/chat/nl2sql` para clasificar exigiría cambiar su contrato (cambio en core-ai, fuera de alcance).
2. **Postura de seguridad del repo:** `sql-validator.util.ts` ya documenta la filosofía "conservative / reject-on-doubt" y "defence-in-depth, ningún layer solo". Un gate determinístico ANTES de cualquier llamada a LLM es una garantía más dura que confiarle la clasificación al mismo LLM que ya sabemos que alucina columnas/tablas (ver el incidente §3.1). Una función determinística es exhaustivamente unit-testeable (ver `intent-classifier.util.spec.ts`); un paso de clasificación por LLM no lo es de la misma forma.
3. **Costo/latencia:** evita un segundo round-trip HTTP (20s de timeout) por cada pregunta, incluyendo el caso común (`historical`, sin cambios).

Trade-off aceptado: la heurística (keywords de dominio + frases temporales en español + verbo "ir a" + fechas explícitas) es imperfecta para frases abiertas no contempladas — mismo trade-off que ya asume `validateSql` con sus regex de extracción de tablas/columnas.

**Arquitectura:** `ChatModule` importa `ForecastingModule` (ya exporta `ForecastingService`) y usa `ForecastingService.getForecastForRange(tenantId, from, to)` — mismo patrón de import directo de servicio que `ForecastingModule → NotificationsModule` (Lote B1); sin bus de eventos en el repo, sin ciclo (`forecasting` no conoce `chat`).

**Resolución de rango temporal** (`src/chat/lima-date.util.ts` + `intent-classifier.util.ts`): reconoce "mañana", "pasado mañana", "este fin de semana" (próximo sáb-dom, incluye hoy si hoy ya es sábado), "esta semana" (hoy→domingo), "la próxima semana" (próximo lun-dom), "este mes", "el próximo mes" (con rollover de año en diciembre). Sin frase explícita pero con señal de futuro (p. ej. "¿cuánto vamos a vender?"), usa una ventana por defecto de 7 días desde mañana.

**Shape de respuesta (aditivo — LOTE F2b, frontend):** `kind: 'historical'|'future'|'out_of_domain'|'ambiguous'` siempre presente; `forecast: { runId, range:{from,to,label}, totalYhat, totalLo, totalHi, points, drivers }` presente SOLO en `kind:'future'` con datos disponibles (ausente si `needsForecast`/fuera de horizonte — el mensaje explicativo va en `answer`). Ver §8 para el ejemplo completo. El adapter actual del frontend (`team-frontend/server/api/chat/query.post.ts` → `use-chat.ts`) sigue funcionando sin cambios: solo lee `answer/sql/columns/rows/provider/model` y construye la tabla cuando `columns.length > 0` (para `future`/`out_of_domain`/`ambiguous`, `columns` viaja vacío → no se renderiza tabla).

**Guardrails existentes — verificados intactos:** el validador de 9 reglas, RLS FORCE, `statement_timeout`, y el bloqueo de la columna `salary` NO se tocaron; `historical` sigue siendo exactamente el flujo R1-R10 sin modificar (`ChatService.answerHistorical`, antes `query()`). Tests de regresión en `chat.service.spec.ts` y `chat.e2e-spec.ts` (incluye "¿qué insumos están por agotarse?" e intento explícito de `SELECT salary` vía SQL mockeado).

---

## 3.3 Refinamiento LOTE B5 (2026-07-02) — escala honesta de la proyección + futuro morfológico + dedupe de drivers (QA-23/QA-24/QA-22)

**QA-23 (HIGH) · root cause confirmado.** La burbuja de proyección del chat mostraba "S/ 91.41 el fin de semana" cuando el negocio vende ~S/4,236/día. Causa: `ForecastingService.demandSeries`/`dailyTotals` agrega `SUM(qty)` de `sales_history` (UNIDADES — platos vendidos/día), NUNCA `qty × unitPrice`; la serie `scope:'total'` que consume el forecast SIEMPRE está en unidades. `ChatService.answerFuture` (LOTE B3) formateaba `totalYhat` con el prefijo `"S/ "` — re-etiquetaba unidades como dinero sin ninguna conversión real. ~91 unidades/finde es coherente con el histórico sintético del seed; el bug era puramente de presentación, no del modelo (el tab Precisión ya probaba sMAPE 8.9% con el mismo forecast).

**Decisión (opción (a) del ticket, NO la opción (b)):** responder en la unidad REAL (`"Se proyectan ~91 platos..."`) y, cuando hay ventas recientes, ofrecer una estimación de ingresos DERIVADA y etiquetada como tal: `unidades × ticket promedio por plato de los últimos 30 días de sales_history` (`SUM(total)/SUM(qty)`, ventana `AVG_UNIT_PRICE_WINDOW_DAYS`, la MISMA que ya usa `shoppingSuggestions` para repartir el forecast por plato — no una constante nueva). Se descartó la opción (b) (proyectar una serie de ingresos real, nueva corrida) porque exige tocar el pipeline de corridas/`team-core-ai`, fuera de alcance de este lote y de mayor costo sin necesidad — la conversión unidades×ticket-promedio es matemáticamente honesta, transparente (el cálculo completo viaja en `estimatedRevenue`) y no requiere una segunda serie pronosticada. Sin ventas en la ventana de 30 días, `estimatedRevenue` es `null` — el sistema JAMÁS multiplica por una constante mágica ni inventa un precio (ver `src/chat/forecast-answer.util.ts::estimateRevenue`).

**Shape de respuesta — aditivo (dentro de `forecast`, LOTE F2b puede consumirlo):**

```
forecast: {
  ...campos previos sin cambios (runId, range, points, drivers)...
  totalYhat/totalLo/totalHi: number   // SIN CAMBIO DE TIPO — ahora documentados como UNIDADES, no S/
  unitLabel: string                   // NUEVO — siempre "platos" para scope:'total'
  estimatedRevenue: {                 // NUEVO — null si no hay ventas en la ventana de referencia
    total: number; lo: number; hi: number;
    avgUnitPrice: number;             // ticket promedio (S/) usado para la derivación
    basisDays: number;                // 30 — ventana de la que salió avgUnitPrice
  } | null
}
```

**QA-24 (MEDIUM) · root cause confirmado.** "¿Cuánto venderé en diciembre?" no disparaba ninguna señal de futuro en `intent-classifier.util.ts` (solo reconocía la construcción ir-a-infinitivo, "voy/vamos/va/van a + infinitivo" — no el futuro simple "venderé") y caía al flujo `historical`, generando SQL contra `sales_history` con un rango hardcodeado al año pasado por el LLM ("`sold_on >= '2023-12-01'`"), respondiendo falsamente "no hay datos disponibles". Fix: `FUTURE_TENSE_ACCENT_RE` reconoce el futuro simple español (TODOS los verbos, regulares e irregulares, terminan en `-ré/-rás/-rá/-remos/-réis/-rán` — la tilde escrita es la señal, por eso corre sobre el texto SIN stripping de acentos) + `resolveMonthRange` mapea un nombre de mes explícito ("diciembre") a su PRÓXIMA ocurrencia. Un nombre de mes aislado (sin ninguna otra señal de futuro) NO clasifica como futuro por sí solo — a diferencia de "mañana"/"fin de semana" (intrínsecamente prospectivos), un mes puede aparecer en una pregunta histórica igual de válida ("¿cuánto vendí en diciembre?"), así que `resolveMonthRange` solo se consulta cuando `classifyIntent` YA confirmó futuro por otra vía. Con la clasificación corregida, la pregunta llega al camino `outOfHorizon` que B3 ya tenía (el horizonte del forecast es de 14 días) — la respuesta explica el horizonte, NUNCA ejecuta SQL.

**QA-22 (LOW) · root cause confirmado.** Un fin de semana completo trae 2 `drivers` `weekend` (sábado + domingo) con el MISMO `label` ("Fin de semana"); la frase de `answer` los concatenaba tal cual (`.map(d => d.label).join(', ')`) → "Incluye el efecto de Fin de semana, Fin de semana." El chip visual del frontend ya deduplicaba por label (por eso QA solo vio el bug en el texto). Fix: `formatDriverLabels` (`src/chat/forecast-answer.util.ts`) deduplica por label preservando el orden de aparición y arma una lista en español natural (un label solo → tal cual; 2+ distintos → comas + "y" final). `forecast.drivers` (el array crudo) NO se deduplica — solo la frase narrada.

**Drive-by (mismo archivo, mismo constraint del ticket):** 4 strings de copy en `chat.service.ts` usaban voseo ("Probá", "Generá", "Podés") violando la convención del repo (tuteo neutro) — corregidas a "Prueba"/"Genera"/"Puedes" mientras se reescribía `answerFuture` y los mensajes de error de ejecución.

**Verificación live (post-fix, contra el stack Docker real, LLM `openai` real):** "¿Cuánto voy a vender este fin de semana?" → _"Se proyectan ~118 platos para este fin de semana (banda estimada 88–148 platos). Estimado en S/ 4709.97 según tu ticket promedio por plato de los últimos 30 días (S/ 39.92/plato)."_ — coherente con el dashboard (`GET /reports/dashboard/manager` → `revenueToday: "4236.00"`, mismo orden de magnitud, S/1000s no S/91). "¿Cuánto venderé en diciembre?" → explica el horizonte (_"...solo cubre hasta el 2026-07-16..."_), sin SQL. Histórica de regresión ("¿Qué insumos están por agotarse?") → intacta (Pulpo, Conchas de abanico, Cilantro, Lomo de res).

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

  # --- LOTE B3 (2026-07-02) · preguntas sobre el futuro + rechazo QA-08 ---

  Scenario: Futuro — con corrida completada, responde la proyección real EN UNIDADES + drivers
    Given el tenant "Motif" tiene una ForecastRun completada (scope=total)
    And esa corrida tiene puntos para el próximo sábado y domingo
    And tiene un driver "Quincena del 15" el domingo
    When el usuario owner consulta "¿cuánto voy a vender este fin de semana?"
    Then el sistema responde 200 con kind="future"
    And sql="" y columns=[] y rows=[] (no se generó SQL)
    And answer incluye el total proyectado EN PLATOS (nunca "S/" sin una derivación declarada) y el driver "Quincena del 15"
    And answer incluye el disclaimer "proyección del modelo, no una venta confirmada"
    And forecast.points contiene exactamente los puntos de sáb+dom
    And forecast.unitLabel="platos"

  # --- LOTE B5 (2026-07-02) · QA-23/QA-24/QA-22 ---

  Scenario: QA-23 — con ventas recientes, deriva y etiqueta una estimación en soles
    Given el tenant "Motif" tiene ventas en sales_history de los últimos 30 días (ticket promedio S/25.00/plato)
    And una ForecastRun completada con puntos que suman 230 platos en el rango pedido
    When el usuario owner consulta "¿cuánto voy a vender este fin de semana?"
    Then answer incluye "230 platos" y NUNCA re-etiqueta esa cifra como soles sin derivación
    And answer incluye "S/ 5750.00" declarado como estimación según el ticket promedio por plato
    And forecast.estimatedRevenue = { total: 5750, lo: 4750, hi: 6750, avgUnitPrice: 25, basisDays: 30 }

  Scenario: QA-23 — sin ventas recientes, NUNCA inventa un precio
    Given el tenant no tiene ventas en los últimos 30 días de sales_history
    When el usuario owner consulta una pregunta futura con datos disponibles
    Then forecast.estimatedRevenue es null
    And answer NO contiene "S/"

  Scenario: QA-24 — futuro simple ("venderé") + mes explícito, sin caer al SQL histórico
    Given el tenant "Motif" tiene una ForecastRun completada con horizonte de 14 días
    When el usuario owner consulta "¿Cuánto venderé en diciembre?"
    Then el sistema clasifica kind="future" (el futuro simple "venderé" es una señal de futuro, no solo "voy a")
    And el rango resuelto es el PRÓXIMO diciembre (nunca un diciembre pasado)
    And como diciembre cae fuera del horizonte de 14 días, answer explica el horizonte
    And sql="" (NUNCA se ejecuta la pregunta contra sales_history con un año hardcodeado)

  Scenario: QA-24 — regresión, un mes aislado sin señal de futuro sigue siendo historical
    Given el usuario es owner
    When consulta "¿cuánto vendí en diciembre?" (pasado, sin verbo futuro ni "próximo/este mes")
    Then el sistema clasifica kind="historical" (un nombre de mes solo NO implica futuro)

  Scenario: QA-22 — drivers duplicados se narran una sola vez
    Given una ForecastRun con 2 drivers "Fin de semana" (sábado y domingo) en el rango pedido
    When el usuario owner consulta "¿cuánto voy a vender este fin de semana?"
    Then answer incluye "Incluye el efecto de Fin de semana." UNA sola vez
    And answer NO contiene "Fin de semana, Fin de semana"
    And forecast.drivers sigue teniendo los 2 drivers crudos (sin deduplicar, para el chip del frontend)

  Scenario: Futuro — sin ninguna corrida completada, explica sin auto-disparar una corrida
    Given el tenant "Motif Sin Pronóstico" no tiene ninguna ForecastRun completada
    When el usuario owner consulta "¿cuánto voy a vender este fin de semana?"
    Then el sistema responde 200 con kind="future"
    And answer explica que hace falta generar un pronóstico primero
    And forecast está ausente
    And NO se crea ninguna ForecastRun nueva (sin side-effect)

  Scenario: Futuro — rango fuera del horizonte pronosticado
    Given el tenant "Motif" tiene una ForecastRun completada con horizonte de 14 días
    When el usuario owner consulta "¿cuánto voy a vender el próximo mes?" (fuera del horizonte)
    Then el sistema responde 200 con kind="future"
    And answer explica que el rango cae fuera del pronóstico y sugiere ampliarlo
    And forecast está ausente

  Scenario: Fuera de dominio — QA-08, sin volcado de filas
    Given el usuario es owner
    When consulta "¿quién ganó el mundial?"
    Then el sistema responde 200 con kind="out_of_domain"
    And sql="" y rows=[] (NUNCA se llama a core-ai/nl2sql)
    And answer es el rechazo fijo ("Solo puedo responder sobre los datos de tu negocio...")

  Scenario: Ambigua — QA-08, pide precisión con ejemplos concretos
    Given el usuario es owner
    When consulta "¿cómo va todo?"
    Then el sistema responde 200 con kind="ambiguous"
    And sql="" y rows=[] (NUNCA se llama a core-ai/nl2sql)
    And answer ofrece 2-3 preguntas concretas de ejemplo

  Scenario: Regresión — la clasificación no rompe preguntas históricas ni guardrails
    Given el usuario es owner
    When consulta "¿qué insumos están por agotarse?"
    Then el sistema clasifica kind="historical" y ejecuta el flujo nl2sql original
    When consulta "¿cuánto le pago a cada empleado?" y core-ai intenta "SELECT salary FROM employees"
    Then el validador de 9 reglas sigue rechazando la columna salary (regla 7, 400)
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

### Response 200 (`kind: "historical"` — flujo original R1-R10, sin cambios)

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
    "model": "mock-v1",
    "kind": "historical"
  }
}
```

### Response 200 (`kind: "future"` — LOTE B5, con corrida completada en rango + ticket promedio disponible)

**Verificado live contra el stack Docker real** (`docker exec` reconstruido + reseed, LLM `openai` real) — ver §3.3.

```json
{
  "success": true,
  "data": {
    "answer": "Se proyectan ~118 platos para este fin de semana (banda estimada 88–148 platos). Estimado en S/ 4709.97 según tu ticket promedio por plato de los últimos 30 días (S/ 39.92/plato). Nota: esto es una proyección del modelo, no una venta confirmada.",
    "sql": "",
    "columns": [],
    "rows": [],
    "provider": "system",
    "model": "forecast-run",
    "kind": "future",
    "forecast": {
      "runId": "e545d567-e870-4f94-80d7-6ee7b347c8cb",
      "range": {
        "from": "2026-07-04",
        "to": "2026-07-05",
        "label": "este fin de semana"
      },
      "totalYhat": 118,
      "totalLo": 88,
      "totalHi": 148,
      "unitLabel": "platos",
      "estimatedRevenue": {
        "total": 4709.97,
        "lo": 3512.52,
        "hi": 5907.42,
        "avgUnitPrice": 39.92,
        "basisDays": 30
      },
      "points": [
        {
          "target_date": "2026-07-04",
          "yhat": 59,
          "yhat_lo": 44,
          "yhat_hi": 74
        },
        {
          "target_date": "2026-07-05",
          "yhat": 59,
          "yhat_lo": 44,
          "yhat_hi": 74
        }
      ],
      "drivers": []
    }
  }
}
```

`estimatedRevenue` es `null` (no aparece el bloque "Estimado en S/..." en `answer`) cuando el tenant no tuvo ventas en los últimos `basisDays` (30) días — el sistema nunca inventa un ticket promedio.

`forecast` está AUSENTE (solo `answer` explica) cuando `needsForecast` (sin corrida completada) o el rango cae fuera del horizonte pronosticado — nunca se dispara una corrida nueva automáticamente en ninguno de los dos casos.

### Response 200 (`kind: "out_of_domain"` / `kind: "ambiguous"` — LOTE B3, QA-08)

```json
{
  "success": true,
  "data": {
    "answer": "Solo puedo responder sobre los datos de tu negocio (ventas, insumos, recetas, empleados, pronósticos, etc.). Probá con una pregunta sobre tu restaurante.",
    "sql": "",
    "columns": [],
    "rows": [],
    "provider": "system",
    "model": "intent-classifier",
    "kind": "out_of_domain"
  }
}
```

`kind: "ambiguous"` tiene la misma forma; `answer` ofrece 2-3 preguntas concretas de ejemplo en vez del rechazo fijo. Ninguno de los dos casos llama a core-ai.

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
  "message": "No pude ejecutar la consulta que generé para tu pregunta. Prueba reformularla de otra manera.",
  "error": "Bad Gateway"
}
```

### Response 504 (excedió `statement_timeout`)

```json
{
  "statusCode": 504,
  "message": "La consulta tardó demasiado en responder. Prueba acotar el rango de fechas o ser más específico.",
  "error": "Gateway Timeout"
}
```

---

## 9. Evidencia de trazabilidad (ABET SO7)

| Requisito                                 | Test                                                        | Archivo                                                                                    |
| ----------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| R1 (happy path)                           | `owner gets answer`                                         | `test/chat.e2e-spec.ts`                                                                    |
| R3 (validator gate)                       | todos los security tests                                    | `src/chat/sql-validator.util.spec.ts` + `test/chat.e2e-spec.ts`                            |
| R4 (RLS FORCE)                            | `RLS: tenant A no ve tenant B`                              | `test/chat.e2e-spec.ts`                                                                    |
| R7 (staff 403)                            | `RBAC: staff 403`                                           | `test/chat.e2e-spec.ts`                                                                    |
| R8 (401 sin token)                        | `no token 401`                                              | `test/chat.e2e-spec.ts`                                                                    |
| R9 (RLS cross-read)                       | `tenant isolation`                                          | `test/chat.e2e-spec.ts`                                                                    |
| R10 (502 en fallo de ejecución)           | `execution-time failure degradation (never a raw 500)`      | `test/chat.e2e-spec.ts` + `src/chat/chat.service.spec.ts`                                  |
| R10 (504 en timeout)                      | `statement_timeout (57014) → 504 GatewayTimeoutException`   | `src/chat/chat.service.spec.ts`                                                            |
| schema_context ↔ schema real              | regression suite                                            | `src/chat/schema-context.spec.ts`                                                          |
| R11 (clasificación previa)                | toda la suite `classifyIntent`                              | `src/chat/intent-classifier.util.spec.ts` (30 casos)                                       |
| R11b (QA-24, futuro simple + mes)         | `"venderé"/"ganaré"/"tendré"` + resolución de mes explícito | `src/chat/intent-classifier.util.spec.ts` + `test/chat.e2e-spec.ts`                        |
| R12 (future con datos)                    | `"este fin de semana" devuelve la proyección real...`       | `test/chat.e2e-spec.ts` (LOTE B3/B5) + `chat.service.spec.ts`                              |
| R12 (future needsForecast)                | `future WITHOUT a completed run...` / `sin ninguna corrida` | `chat.service.spec.ts` + `test/chat.e2e-spec.ts`                                           |
| R12 (future outOfHorizon)                 | `rango fuera del horizonte de la corrida...`                | `chat.service.spec.ts` + `test/chat.e2e-spec.ts`                                           |
| R12b (QA-23, unidades + estimatedRevenue) | `estimateRevenue`/QA-23 tests (con y sin avgUnitPrice)      | `src/chat/forecast-answer.util.spec.ts` + `chat.service.spec.ts` + `test/chat.e2e-spec.ts` |
| R12c (QA-22, dedupe de drivers)           | `formatDriverLabels` + repro exacto ("Fin de semana" ×2)    | `src/chat/forecast-answer.util.spec.ts` + `chat.service.spec.ts` + `test/chat.e2e-spec.ts` |
| R13 (out_of_domain, QA-08)                | `"¿quién ganó el mundial?" → rechazo elegante...`           | `chat.service.spec.ts` + `test/chat.e2e-spec.ts`                                           |
| R14 (ambiguous, QA-08)                    | `"¿cómo va todo?" → pide precisión...`                      | `chat.service.spec.ts` + `test/chat.e2e-spec.ts`                                           |
| R15 (guardrails intactos)                 | `regresión — preguntas históricas siguen igual`             | `test/chat.e2e-spec.ts` + `chat.service.spec.ts`                                           |
