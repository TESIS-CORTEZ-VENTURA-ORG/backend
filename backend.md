# backend.md — Contexto de desarrollo del Backend GastronomIA

> **Propósito:** documento hermano de `frontend_context.md`. Unifica todas las decisiones técnicas vigentes para desarrollar el backend (NestJS + FastAPI). Igual que el frontend tiene su prototipo JSX como referencia visual, el backend tiene este MD + los 7 ADRs firmados como referencia de arquitectura. Al iniciar el monorepo se tiene el contexto completo de ambos lados del contrato.
>
> **Última actualización:** 2026-06-14 · **Fuentes:** `EstructuraCodigoProyecto/decisiones/ADR-001…007`, `frontend_context.md` (2026-06-10), `EstructuraCodigoProyecto/alcance/`, `CLAUDE.md`, `Fuente_de_Verdad/Product-Backlog`.
>
> ⚠️ **Decisiones que SUPERAN a ADRs firmados** (confirmadas por el equipo el 2026-06-14):
> - **Hosting backend → Hetzner + Coolify** (supera ADR-001, que decía Railway).
> - **Forecasting → Chronos-2 primary + Prophet fallback** (supera ADR-002, que decía TimesFM 2.5).
> - **PostgreSQL 17** (ADR-001 decía 16) · **TimescaleDB retirado** (ADR-007).
> Estos cambios deben reflejarse en una actualización de los ADRs originales antes del cierre documental de TP1.

---

## 1. Qué es el producto (mirada backend)

**GastronomIA** — SaaS **multi-tenant** de control de rentabilidad con IA para restaurantes PyME de Lima. Caso de estudio: **Motif Restobar Karaoke** (SJL). Tesis UPC ISW, TP1 (2026-1) + TP2 (2026-2).

El backend es el **núcleo de valor y de riesgo**: concentra el aislamiento multi-tenant (riesgo R4, el de mayor impacto del proyecto), el costeo dinámico, y orquesta los dos servicios de IA. Tres pilares funcionales que el backend debe servir:

1. **Forecasting de demanda** — servicio Python expone predicciones con bandas P10/P90 por SKU.
2. **Chat analítico Text-to-SQL** — genera SQL seguro sobre el esquema multi-tenant y lo ejecuta con defense-in-depth.
3. **Gestión BOM y costeo dinámico por plato** — recalcula márgenes ante cambios de precio de insumos.

**Roles (claims del JWT):** `owner` (todo), `manager` (lectura amplia, sin escritura en settings), `staff` (POS/KDS/inventario lectura). Autorización fina con **CASL** en el backend.

---

## 2. Stack backend (DECIDIDO — no reevaluar)

| Capa | Tecnología | Notas |
|---|---|---|
| Lenguaje negocio | **TypeScript estricto** | **PROHIBIDO `any`** (evidencia ABET SO7) |
| Framework API | **NestJS 11 + Fastify** | Modular Monolith (ADR-005); Fastify > Express por throughput |
| ORM | **Prisma 6** | Cliente único desde NestJS; migraciones versionadas |
| Servicio IA | **FastAPI (Python 3.12+)** | Inferencia forecasting + pipeline RAG; contenedor separado |
| Base de datos | **PostgreSQL 17 en Neon** | pgvector (RAG). TimescaleDB **retirado** (ADR-007) |
| Aislamiento | **RLS FORCE** (ADR-004) | `tenant_id` en toda tabla; política por tabla |
| Cache / colas | **Upstash Redis + BullMQ** | Jobs async: ingesta CSV, forecast, refresh de vistas |
| Auth | **JWT RS256** (access 15m / refresh 7d) | Better-Auth (plugin organization) + CASL |
| Storage | **Cloudflare R2** | CSV TumiSoft, datasets, artefactos de modelo (pre-signed URLs) |
| Email | **Resend** | Transaccional (invitaciones, alertas) |
| Validación/contratos | **Zod v4** (TS) + **Pydantic** (Python) | `packages/shared` = única fuente de verdad de tipos |
| Tests | **Vitest + Supertest** (Node) · **pytest** (Python) | Pyramid por módulo; suite RLS dedicada |
| Observabilidad | **OpenTelemetry + Sentry** · **LangSmith** (solo LLM) | Trazas distribuidas Node↔Python |

**Deploy:** NestJS y FastAPI en **Hetzner con Coolify** (self-hosted PaaS) — supera el Railway del ADR-001. Frontend en Vercel. BD en Neon (branching tipo Git por PR). 1 contenedor por servicio.

---

## 3. Arquitectura — Modular Monolith + servicio IA separado (ADR-005)

**Estilo:** Modular Monolith en NestJS para la capa de negocio + servicio Python FastAPI separado para IA. Rechazados: microservicios día 1 (sobrecarga operativa para 2 personas), monolito clásico (no sostiene 12 bounded contexts), serverless (cold start incompatible con P95 < 2s).

**Reglas de módulo (boundaries explícitos):**
- Cada módulo se comunica vía **interfaces TypeScript**, nunca accede a entidades de otro módulo directo.
- `ESLint no-restricted-imports` impide imports cruzados entre módulos.
- Un bug se acota por módulo; tests por módulo + feature flags por módulo.
- La escalabilidad horizontal aplica al monolito completo (aceptable en piloto 1 tenant).

**Frontera Node ↔ Python (contrato REST):**
- NestJS orquesta; FastAPI infiere. NestJS → Python vía REST `/forecast/run` y `/chat/query`.
- Llamadas pesadas son **asíncronas vía BullMQ**; respuesta por polling o streaming (SSE/WebSocket).
- Python usa **cliente PostgreSQL nativo** y **respeta el contrato RLS** (`SET app.tenant_id` antes de leer).
- La frontera ya marcada por REST habilita extraer microservicios en TP2 sin refactor mayor.

**Monorepo (se crea en Sprint 0):**
```
gastronomia/
├── apps/
│   ├── web/         # Nuxt 3 (frontend)
│   ├── api/         # NestJS 11 + Fastify (backend negocio)
│   └── ai/          # FastAPI (forecasting + RAG)
├── packages/
│   └── shared/      # Zod schemas → tipos TS; espejo Pydantic para Python
└── specs/           # Spec-Driven Development (ADR-006)
```

---

## 4. Multi-tenancy y seguridad (CRÍTICO — riesgo R4)

Fuga cross-tenant = evento de mayor severidad del proyecto (prob. baja, impacto muy alto). **Defense-in-depth en 3 capas:**

**Capa 1 — JWT (origen de la verdad del tenant).**
- JWT **RS256**, claims `{ sub, tenant_id, roles: [owner|manager|staff] }`.
- **`tenant_id` SIEMPRE sale del JWT** — nunca del path, query ni body.
- El BFF de Nitro inyecta `Authorization: Bearer` hacia NestJS; el cliente nunca llama a NestJS directo.

**Capa 2 — RLS FORCE en PostgreSQL (ADR-004).**
- Toda tabla de negocio tiene `tenant_id UUID NOT NULL` indexado.
- Política por tabla:
  ```sql
  ALTER TABLE <tabla> ENABLE ROW LEVEL SECURITY;
  ALTER TABLE <tabla> FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON <tabla>
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
  ```
- NestJS ejecuta `SET LOCAL app.tenant_id = '<uuid>'` al inicio de **cada transacción HTTP**, derivado del claim del JWT.
- Modo **FORCE** aplica el aislamiento incluso al owner del schema → elimina una clase entera de errores.
- Generador de migraciones produce las policies a partir de un decorador `@TenantScoped` en los modelos.

**Capa 3 — Validación de aplicación + tests.**
- Suite de pruebas RLS verifica 4 vectores: **cross-read, cross-write, bypass JWT, bypass schema owner** (carpeta `Pruebas-RLS/`).
- Autorización por rol con **CASL** (gating de acciones, no solo de UI).
- Propagación incorrecta del `tenant_id` causa **403 en runtime** (preferible a fuga) → monitorear.

**Cumplimiento:** Ley N° 29733 PDP + DS 016-2024-JUS. DPA por proveedor (5 proveedores externos).

---

## 5. Bounded contexts (módulos NestJS) — alcance MVP (102 HU / 427 SP)

> **HU = `Product Backlog.md`** (fuente de verdad: IDs `HU-XX-YY` + criterios Gherkin).
> Trazabilidad implementación↔HU en `specs/TRACEABILITY.md`. **Roles reconciliados a 3**
> (`owner`/`manager`/`staff`; HU-01-04 actualizado). La suite RLS es **HU-12-06** (E12/S0).

| ID | Bounded Context / Módulo NestJS | Sprint | MoSCoW | Tablas propias (núcleo) |
|---|---|---|---|---|
| **E01** | `auth` + `tenants` — Identity, Multi-Tenancy, Seguridad | S1 | MUST | `tenants`, `users`, `organizations`, `invitations` |
| **E02** | `catalog` + `bom` — Catálogo, Recetas y Menú | S1 | MUST | `ingredients`, `ingredient_price_history`, `recipes`, `recipe_items`, `units_of_measure` |
| **E03** | `pos` — POS, Salón y Cocina (KDS) | S2 | MUST | `tables`, `orders`, `kds_tickets` |
| **E04** | `billing` — Tickets, Cobros y Pagos | S2 | MUST | `sales`, `sale_items`, `payments`, `discounts` |
| **E05** | `inventory` — Inventario, Compras y Mermas | S3 | MUST | `purchases`, `purchase_items`, `inventory_movements`, `inventory_counts`, `inventory_count_lines` |
| **E06** | `costing` — Costeo Dinámico y Márgenes | S3 | MUST | (deriva de E02/E05; vistas de margen) |
| **E07** | `reports` — Reportes, Dashboards y KPIs | S4 | SHOULD | `weekly_reports`, vistas materializadas |
| **E08** | `forecasting-orchestrator` (NestJS) ↔ FastAPI | S4 | MUST | `forecasts` (yhat, yhat_lo, yhat_hi, target_date) |
| **E09** | `chat-orchestrator` (NestJS) ↔ FastAPI | S5 | MUST | `chat_conversations`, `chat_messages`, schema docs (pgvector) |
| **E10** | `notifications` — Notificaciones y Alertas | S4 | SHOULD | `notifications`, `alert_rules` |
| **E11** | `ingestion` — Migración desde ERPs Legacy (TumiSoft) | S1 | SHOULD | `ingestions`, `ingestion_errors` |
| **E12** | `platform` — Plataforma, DevOps, Observabilidad, `audit` | S0 | MUST | `audit_log` |

**Fuera de alcance TP1 (NO construir):** CRM, reservas de mesas, turnos de personal, marketing/cupones, billing del SaaS, delivery, app nativa, facturación SUNAT, multi-moneda, multi-sucursal, PWA offline. Detalle y justificación en `EstructuraCodigoProyecto/alcance/modulos-diferidos.md`.

> ⚠️ **Pendiente de definir con Motif:** multi-sucursal dentro de un tenant. Aunque la UI no lo exponga en TP1, **el modelo de datos debe preverlo** (¿1 tenant = 1 sucursal o varias?).

---

## 6. Modelo de datos — convenciones

- **Naming:** `snake_case` en BD; `tenant_id UUID NOT NULL` en toda tabla de negocio.
- **Soft delete:** `deleted_at` (no borrado físico).
- **Moneda:** solo **S/ (PEN)**. **Timezone:** `America/Lima` (UTC-5).
- **Catálogo:** `recipes.kind ∈ {dish, sub_recipe}`, con `yield` y `sell_price`; `recipe_items` referencia ingrediente **o** sub-receta con `qty` y `waste_pct`; `units_of_measure` con conversiones.
- **Inventario:** `inventory_movements.source ∈ {purchase, sale, waste, adjustment, count_recon}`; `inventory_counts` produce varianza física vs sistema.
- **IA:** `forecasts` (yhat + banda yhat_lo/yhat_hi + target_date); `chat_messages` guarda el **SQL ejecutado**; `weekly_reports` en markdown narrativo.
- **Ingesta:** `ingestions.status ∈ {queued, processing, success, error}` + `ingestion_errors` (fila, campo, mensaje).

**Series temporales y reportes sin TimescaleDB (ADR-007):**
- Tablas normales. Particionado declarativo nativo **solo si** una tabla supera ~1M filas en proyección — en el horizonte TP1/TP2 solo `inventory_movements` es candidato (año ~3-5).
- Agregaciones de reportes (E07) en **vistas materializadas** refrescadas por **pg_cron** o jobs **BullMQ** (reemplazan continuous aggregates).
- Índices **BRIN** sobre columnas de timestamp en tablas de eventos (ventas, kardex) — bajo costo, datos ordenados por tiempo.
- Forecasting lee series agregadas vía `SELECT` estándar (cientos de puntos por SKU/año); no requiere extensión TS.

---

## 7. Diseño de API (contrato con el frontend)

- **REST + SSE** (GraphQL descartado). Prefijos:
  `/api/auth/`, `/api/tenants/`, `/api/recipes/`, `/api/inventory/`, `/api/sales/`, `/api/forecasts/`, `/api/nl-query/stream`, `/api/reports/`.
- **Envelope de respuesta** (schema Zod compartido en `packages/shared`):
  ```ts
  ApiResponse<T> {
    success: boolean
    data: T
    error?: { code: string; message: string }
    meta?: { totalCount: number; page: number }
  }
  ```
- **Chat analítico:** `/api/nl-query/stream` vía `EventSource` — renderizado incremental: SQL generado → tabla de resultados → respuesta humanizada (streaming).
- **Carga CSV (TumiSoft):** upload multipart → pre-signed URL R2 → worker BullMQ valida fila a fila → progreso por SSE → errores por fila.
- **Forecast:** `/api/forecasts/` devuelve `yhat` + banda `yhat_lo`–`yhat_hi` (P10/P90).
- Contratos diseñados con el skill `api-contract-designer`; Zod como única fuente de verdad → el frontend infiere los mismos tipos.

---

## 8. IA en el backend

### 8.1 Forecasting — **Chronos-2 (primary) + Prophet (fallback)** ⚠️ supera ADR-002

- **Motor primario:** **Chronos-2** (Amazon) — foundation model zero-shot de series de tiempo. **Fallback:** **Prophet** (Meta) cuando el histórico o la calidad de datos no alcanzan.
- Servicio Python FastAPI; invocado por NestJS vía REST `/forecast/run` y eventos BullMQ.
- Horizontes diario/semanal por SKU; bandas P10/P90 para el dashboard.
- **Riesgo R1 (cold start):** histórico TumiSoft escaso por tenant → estrategia zero-shot + datos sintéticos (SDV) cuando aplique.
- **Riesgo R8 (calidad de datos):** errores de ingesta degradan el forecast aunque sea zero-shot → ETL robusto + auditoría fase 1.
- Trazabilidad de errores con **OpenTelemetry + Sentry** (LangSmith no aplica fuera de LLM).
- **Métrica de éxito:** sMAPE < 20% en horizonte semanal.

> **Nota histórica:** ADR-002 seleccionó **TimesFM 2.5** vía Weighted Scoring Method. El propio ADR advertía que el liderazgo en GIFT-Eval es volátil y que Chronos-2/Moirai podían desplazarlo, obligando a re-evaluar antes de TP2. Esa re-evaluación se materializó: **Chronos-2** queda como primary y **Prophet** como fallback robusto. Actualizar ADR-002 formalmente.

### 8.2 Chat analítico Text-to-SQL — Claude Sonnet 4.6 + RAG (ADR-003)

- **Generación de SQL:** **Claude Sonnet 4.6** vía API + **RAG** (LlamaIndex + pgvector con embeddings **Voyage AI voyage-3**). Fallback a **Claude Haiku 4.5** ante outage (respuesta degradada "consulte el dashboard").
- **Humanización de la respuesta:** streaming de la respuesta en lenguaje natural (capa de baja latencia, vía Groq según `frontend_context.md`) — Claude asegura la precisión del SQL, el streaming rápido asegura el P95.
- **RAG sobre pgvector** reutiliza Neon (ADR-001) — sin vector store separado (Pinecone/Weaviate). Proceso ETL actualiza los schema documents cuando cambia el modelo Prisma.
- **Validador SQL de 9 capas (defense-in-depth contra inyección):**
  1. AST parsing · 2. allowlist de tablas · 3. allowlist de funciones · 4. validación de filtro `tenant_id` · 5. límite de filas · 6. timeout de consulta · 7. scope **read-only** · 8. hash de consulta para caché · 9. revisión de output schema.
- Garantiza que ninguna consulta omita `tenant_id = current_setting('app.tenant_id')` → complementa RLS FORCE.
- **Caché** por hash de pregunta normalizada, TTL 1h (costo ≈ USD 0,012/consulta).
- **Métricas:** precisión semántica ≥ 85% (golden dataset 20 consultas) · latencia chat **P95 < 2s**.

---

## 9. Infraestructura, deploy y costos

| Servicio | Proveedor | Rol | Estado |
|---|---|---|---|
| Backend NestJS + FastAPI | **Hetzner + Coolify** ⚠️ | Cómputo (1 contenedor/servicio) | supera Railway (ADR-001) |
| Frontend | Vercel | SSR + edge | — |
| Base de datos | Neon (PostgreSQL 17) | BD + pgvector + branching por PR | — |
| Cache / colas | Upstash Redis + BullMQ | Jobs async | tier gratuito |
| Storage | Cloudflare R2 | CSV, datasets, modelos | tier gratuito |
| Email | Resend | Transaccional | — |
| LLM | Anthropic (Sonnet 4.6 / Haiku 4.5) | Text-to-SQL | — |
| Embeddings | Voyage AI (voyage-3) | RAG | — |
| Covariates | OpenWeatherMap + API feriados PE | Exógenas del forecast | pendiente diseño |

- **Desarrollo local:** la BD corre en **Docker** (`docker-compose.yml`, imagen `pgvector/pgvector:pg17`, base `gastronomia_dev`) — Neon es solo prod/CI. Detalle en `CLAUDE.md` → "Base de datos local".
- **CI/CD:** GitHub Actions → deploy a Coolify (Hetzner) y Vercel. Neon crea 1 branch de BD por PR (testing RLS sin tocar prod).
- **Costo piloto:** Neon branching es clave para el flujo RLS por PR. Hetzner self-hosted vía Coolify reemplaza el modelo de Railway manteniendo el presupuesto autofinanciado (USD ~30.3k todo TP1+TP2).
- **Single-point-of-failure distribuido:** caída de Neon/Vercel/Hetzner compromete el servicio (aceptado en fase piloto, 1 tenant).

---

## 10. Observabilidad y SLOs

| Métrica | Objetivo | Cómo se mide |
|---|---|---|
| Latencia chat | **P95 < 2 s** (round-trip) | OpenTelemetry traces Node↔Python |
| Reportes E07 (vistas materializadas) | **P95 < 2 s** con 12 meses de datos | EXPLAIN ANALYZE + Neon Insights |
| Lectura serie histórica `/forecast/run` | **< 200 ms** para 12–24 meses/SKU | benchmark interno |
| Forecasting | **sMAPE < 20%** semanal | DeepEval / harness propio |
| Text-to-SQL | **precisión ≥ 85%** (golden 20) | golden dataset + ejecución |
| Aislamiento | **0 fugas** en suite RLS (4 vectores) | tests Pruebas-RLS |
| Jobs de mantenimiento | **0 fallos en silencio** en demo | sin jobs TimescaleDB (ADR-007) |

- **Errores:** Sentry (Node + Python). **Trazas LLM:** LangSmith. **Métricas de plataforma:** Neon Insights + Coolify.

---

## 11. Convenciones de código y metodología (ADR-006)

- **SDD — Spec-Driven Development:** spec primero en `/specs/eXX/HU-XX-YY-titulo.spec.md` → **test rojo** (Vitest/pytest) → implementación mínima → review. **No se mergea código sin spec.**
- **Patrón Harness Engineering** (no es un CLI `harness run`): roles `leader` / `spec_author` / `implementer` / `reviewer`; notación **EARS** (R1, R2…); gate de aprobación humana en estado `spec_ready`; trazabilidad obligatoria **R\<n\> → test**; **una feature `in_progress` a la vez**.
- **Branches:** `feat/HU-XX-YY-titulo` · **Commits:** `spec(HU-XX-YY): descripción`.
- **Naming TS:** camelCase variables/funciones, PascalCase tipos/clases, **kebab-case archivos**. Código en inglés, docs en español.
- **Prohibido:** `any`, `console.log` (usar logger estructurado), catch silencioso, magic strings/numbers, credenciales hardcodeadas, `tenant_id` desde path/query/body, imports cruzados entre módulos.
- **Zod** como única fuente de verdad de tipos (TS infiere del schema; Pydantic espeja en Python).
- **Metodología macro:** Scrum (6 sprints × 2 semanas) + CRISP-DM para los módulos IA.

---

## 12. ADRs de respaldo (índice)

| ADR | Decisión | Estado | Nota de vigencia |
|---|---|---|---|
| **ADR-001** | Stack cloud híbrido | Aceptado | ⚠️ hosting backend **Railway → Hetzner + Coolify**; PG **16 → 17** |
| **ADR-002** | TimesFM 2.5 forecasting | Aceptado | ⚠️ **superado → Chronos-2 + Prophet fallback** |
| **ADR-003** | Text-to-SQL Claude Sonnet 4.6 + RAG | Aceptado | Vigente (+ humanización con streaming Groq) |
| **ADR-004** | RLS FORCE PostgreSQL | Aceptado | Vigente — núcleo de seguridad |
| **ADR-005** | Modular Monolith NestJS + FastAPI | Aceptado | Vigente |
| **ADR-006** | SDD patrón Harness Engineering | Propuesta | Vigente como metodología |
| **ADR-007** | Retiro de TimescaleDB | Propuesta | Vigente — series sobre PG nativo |

> **Acción documental pendiente:** emitir ADR-008 (cambio de hosting a Hetzner+Coolify) y ADR-009 (cambio de motor de forecasting a Chronos-2+Prophet), o actualizar ADR-001 y ADR-002, para que el repositorio quede consistente antes del corte de Sem 14. Aprobación: Castro Veramendi (Asesor).

---

## 13. Estado actual (2026-06-14) y primer paso

- El **repositorio de código aún no existe** — se crea en Sprint 0 (monorepo: Nuxt + NestJS + FastAPI + `packages/shared`), según `EstructuraCodigoProyecto/setup-sprint0/`.
- OE1 (SRS) y OE2 (arquitectura C4 + 7 ADRs + 46 pantallas) tienen actas firmadas. **OE3 (software desplegado): demo esperada Sem 12 (2026-06-23).**
- **Primer paso backend (orden sugerido):**
  1. Skeleton NestJS 11 + Fastify + Prisma 6 en el monorepo (módulo `platform`/E12).
  2. `packages/shared` con los primeros schemas Zod (`ApiResponse`, auth, tenant).
  3. Módulo `auth` + `tenants` (E01): JWT RS256 + `SET LOCAL app.tenant_id` + **suite RLS de los 4 vectores** antes que cualquier feature de negocio.
  4. Migración Prisma base con el decorador `@TenantScoped` → generador de policies RLS FORCE.
  5. Stub del servicio FastAPI (`/forecast/run`, `/chat/query`) con contrato REST + cola BullMQ.

---

## 14. Documentos fuente (para profundizar)

| Documento | Qué contiene |
|---|---|
| `EstructuraCodigoProyecto/decisiones/ADR-001…007` | Las 7 decisiones de arquitectura (firmadas/propuestas) |
| `Fuente_de_Verdad/Prototipo/frontend_context.md` | Documento hermano — contrato visto desde el frontend |
| `EstructuraCodigoProyecto/alcance/` | Alcance, módulos incluidos/diferidos, métricas |
| `EstructuraCodigoProyecto/setup-sprint0/AGENTS.md` | Convenciones de código y blueprints Sprint 0 |
| `Fuente_de_Verdad/Especificaciones-Funcionales-y-Tecnicas_Cortez_Ventura.docx` | Especificación funcional + técnica completa |
| `Fuente_de_Verdad/Product-Backlog_Cortez_Ventura.xlsx` | 102 HU con criterios de aceptación |
| `CLAUDE.md` | Memoria maestra: equipo, hitos UPC, stack, riesgos |
