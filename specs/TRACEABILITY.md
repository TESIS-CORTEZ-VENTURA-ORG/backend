# Trazabilidad Backlog ↔ Implementación — Backend GastronomIA

> Mapea las HU de `Product Backlog.md` (fuente de verdad) con specs, PRs y tests.
> Evidencia de trazabilidad (ABET SO7). Actualizado: 2026-06-15 (E06 Inc 2 — cierre de período mensual + comparativo costo real vs teórico; E06 7/7).

## Decisiones de reconciliación
1. **Roles = 3** (`owner`/`manager`/`staff`), no los 5 del backlog original. HU-01-04 actualizado.
2. **IDs oficiales** del backlog (`HU-01-XX`, `HU-12-XX`); la numeración previa `HU-E01-0X` quedó obsoleta.

## E01 — Identity, Multi-Tenancy y Seguridad (10 HU)
| HU | Título | Estado | Spec | PR |
|---|---|---|---|---|
| HU-01-01 | Registro de restaurante (tenant) | 🟡 Parcial | `HU-01-01-y-02-registro-login` | #5 |
| HU-01-02 | Login con email y password | 🟢 Hecho (lockout incl.) | `HU-01-01-y-02` / `HU-01-03-y-08` | #5, #8 |
| HU-01-03 | Refresh token con rotación | 🟢 Hecho | `HU-01-03-y-08-session` | #8 |
| HU-01-04 | Roles y permisos (RBAC) | 🟢 Hecho | `HU-01-04-rbac` | #7 |
| HU-01-05 | Invitación de usuarios por email | 🔲 Diferido (correo) | — | — |
| HU-01-06 | Cambio de contraseña | 🟢 Hecho | `HU-01-06-change-password` | #11 |
| HU-01-07 | Recuperación de contraseña | 🔲 Diferido (correo) | — | — |
| HU-01-08 | Cierre de sesión | 🟢 Hecho (backend) | `HU-01-03-y-08-session` | #8 |
| HU-01-09 | Audit log | 🟢 Hecho | `HU-01-09-audit-log` | #10 |
| HU-01-10 | Configuración del local | 🟢 Hecho | `HU-01-10-tenant-config` | #9 |

**E01: 8/10 funcionales** (7 completas + HU-01-01 parcial). 2 diferidas por requerir servicio de correo.

### Gaps / diferidos (todos requieren correo o son refinamientos)
- **HU-01-01**: email de bienvenida (correo). El RUC se setea vía config (HU-01-10).
- **HU-01-05 / HU-01-07**: invitación y recuperación de contraseña → **requieren servicio de correo** (Resend); diferidas.
- **HU-01-06**: notificación por email del cambio (correo).
- **HU-01-08**: el BFF del frontend debe llamar a `POST /api/auth/logout` (hoy solo limpia la cookie) — follow-up frontend.
- **HU-01-09**: `before/after` detallado por entidad; retención 5 años (política de storage).

## E02 — Catálogo, Recetas y Menú (14 HU)
| HU | Título | Estado | Spec | PR |
|---|---|---|---|---|
| HU-02-01 | CRUD de insumos | 🟢 Hecho | `HU-02-01-ingredients` | #13 |
| HU-02-02 | Carga masiva de insumos vía Excel/CSV | 🟢 Hecho | `HU-02-02-import` | #19 |
| HU-02-03 | Unidades de medida con conversión | 🟢 Hecho | `HU-02-03-04-units-categories` | #14 |
| HU-02-04 | Categorías jerárquicas | 🟢 Hecho | `HU-02-03-04-units-categories` | #14 |
| HU-02-05 | CRUD de proveedores | 🟢 Hecho | `HU-02-05-06-suppliers` | #15 |
| HU-02-06 | Asociar productos con proveedores | 🟢 Hecho | `HU-02-05-06-suppliers` | #15 |
| HU-02-07 | Crear receta estandarizada (BOM) | 🟢 Hecho | `HU-02-07-09-recipes` | #16 |
| HU-02-08 | Sub-recetas anidadas | 🟢 Hecho | `HU-02-07-09-recipes` | #16 |
| HU-02-09 | Versionado de recetas | 🟢 Hecho | `HU-02-07-09-recipes` | #16 |
| HU-02-10 | Crear plato del menú (margen) | 🟢 Hecho | `HU-02-10-12-menu` | #17 |
| HU-02-11 | Gestión de modificadores | 🟢 Hecho | `HU-02-11-13-modifiers-availability` | #18 |
| HU-02-12 | Categorías del menú | 🟢 Hecho | `HU-02-10-12-menu` | #17 |
| HU-02-13 | Disponibilidad por horario | 🟢 Hecho | `HU-02-11-13-modifiers-availability` | #18 |
| HU-02-14 | Foto del plato | 🔲 Diferido (storage R2) | — | — |

**E02: 13/14 hechas** (Inc A–F). Única diferida: **HU-02-14** foto del plato (requiere object storage R2 — servicio externo). Todo lo construible vía código está completo.

## E03 — POS, Salón y Cocina/KDS (12 HU)
| HU | Título | Estado | Spec | PR |
|---|---|---|---|---|
| HU-03-01 | Configurar zonas y mesas | 🟢 Hecho | `HU-03-01-02-salon` | #21 |
| HU-03-02 | Mapa de mesas con estado | 🟢 Hecho (datos; real-time vía polling) | `HU-03-01-02-salon` | #21 |
| HU-03-03 | Abrir mesa | 🟢 Hecho | `HU-03-03-04-05-10-11-12-orders` | #22 |
| HU-03-04 | Tomar orden | 🟢 Hecho | `HU-03-03-04-05-10-11-12-orders` | #22 |
| HU-03-05 | Aplicar modificadores | 🟢 Hecho | `HU-03-03-04-05-10-11-12-orders` | #22 |
| HU-03-06 | Enviar comanda a cocina | 🟢 Hecho | `HU-03-06-09-kitchen` | #23 |
| HU-03-07 | Vista KDS por estación | 🟢 Hecho | `HU-03-06-09-kitchen` | #23 |
| HU-03-08 | Marcar ítem en preparación | 🟢 Hecho | `HU-03-06-09-kitchen` | #23 |
| HU-03-09 | Marcar ítem listo | 🟢 Hecho | `HU-03-06-09-kitchen` | #23 |
| HU-03-10 | Marcar ítem servido | 🟢 Hecho | `HU-03-03-04-05-10-11-12-orders` | #22 |
| HU-03-11 | Anular orden con razón | 🟢 Hecho | `HU-03-03-04-05-10-11-12-orders` | #22 |
| HU-03-12 | Solicitar cuenta | 🟢 Hecho (vía `PATCH /api/tables {status:'bill'}`) | `HU-03-03-04-05-10-11-12-orders` | #22 |

**E03: 12/12 backend** (Inc A — salón: 2 · Inc B — órdenes: 6 · Inc C — cocina/KDS: 4). Real-time por **polling** (push SSE = mejora; no requiere servicio externo). HU-03-12 "solicitar cuenta" no añade endpoint: reutiliza `PATCH /api/tables/:id { status:'bill' }`. Inc C añade `kitchen_stations` (RLS FORCE), `menu_categories.kitchen_station_id`, `POST /api/orders/:id/send-to-kitchen`, `/api/kitchen/stations` + `/api/kitchen/queue` + `PATCH /api/kitchen/items/:itemId`, y el read-model de mesas (`GET /api/tables/:id` + campos `currentOrderId/openedAt/guests/waiterId` en el listado). Nota: el frontend aún NO tiene **pantalla KDS** (se construirá; el backend ya la habilita).

## E04 — Tickets, Cobros y Pagos (8 HU)
| HU | Título | Estado | Spec | PR |
|---|---|---|---|---|
| HU-04-01 | Generar pre-cuenta | 🟢 Hecho | `HU-04-01-02-04-05-06-07-billing` | #26 |
| HU-04-02 | Generar cuenta final (ticket) | 🟢 Hecho | `HU-04-01-02-04-05-06-07-billing` | #26 |
| HU-04-03 | División de cuenta por comensal | 🟢 Hecho | `HU-04-03-08-split-cierre-z` | #27 |
| HU-04-04 | Registrar pago en efectivo | 🟢 Hecho | `HU-04-01-02-04-05-06-07-billing` | #26 |
| HU-04-05 | Registrar pago electrónico (Yape/Plin/tarjeta) | 🟢 Hecho (sin pasarela) | `HU-04-01-02-04-05-06-07-billing` | #26 |
| HU-04-06 | Pago mixto | 🟢 Hecho | `HU-04-01-02-04-05-06-07-billing` | #26 |
| HU-04-07 | Anular ticket | 🟢 Hecho | `HU-04-01-02-04-05-06-07-billing` | #26 |
| HU-04-08 | Cierre Z del día | 🟢 Hecho | `HU-04-03-08-split-cierre-z` | #27 |

**E04: 8/8 backend (Inc 1 + Inc 2)** — módulo nuevo `billing` (`Billing{Controller,Service}`). Esquema `sales` + `payments` (RLS FORCE ambas, verificado `relforcerowsecurity=t`; FK `payments→sales ON DELETE CASCADE`; `sales` con `@@unique([orderId])` = un ticket por orden y `@@unique([tenantId, serie, number])` = correlativo). **Precios INCLUYEN IGV**: `total = Σ unitPrice·qty`; `subtotal = total/(1+igvRate)` (del `tenant.igvRate`, default 0.18); `igv = total−subtotal`. Series: boleta `B001`, factura `F001`; `number = max+1` por tenant+serie. Endpoints: `GET /api/orders/:id/pre-bill` (preview, no persiste), `POST /api/orders/:id/pay` (emite ticket + N pagos + cierra orden `paid` + libera mesa `free`, una sola tx `runInTenant`; reutiliza `OrdersService.buildView` en la misma tx), `GET /api/sales` + `/api/sales/:id`, `POST /api/sales/:id/void`. `SaleView` = espejo del `Sale` del frontend (moneda como string; adaptador BFF trivial sobre `orders/[id]/pay.post.ts`). **RBAC:** el cajero es `staff` → `can('create','Sale')` (cobra); **anular** = manager/owner (`update Sale`; staff → 403). **SUNAT:** el backlog pide "schema preparado para SUNAT"; la **emisión/envío electrónico es externo y queda fuera de alcance** (solo se registra el ticket). **Fuera de alcance (documentado):** vuelto en efectivo y referencia de pago electrónico (no se persisten); reversar orden/stock al anular ticket.

**Inc 2 (HU-04-03 + HU-04-08)** — extiende `billing`. **HU-04-03 división de cuenta** (`POST /api/orders/:id/split`, `read Sale`, **cómputo sin persistir**): `mode='equal'` divide el `total` de la orden en `parts` partes (default = `order.guests` si ≥ 2) con el **resto de redondeo en la primera parte** → `Σ shares.total == order.total` exacto; `mode='items'` agrupa por `assignments[{label,itemIds}]` validando que **cada ítem vivo esté asignado exactamente una vez** (si no → 400). `subtotal`/`igv` por parte desde su `total` con el `igvRate` del tenant. Orden `paid`/`void` → 409. "Un ticket por parte" = alcance futuro (pagar sigue siendo el `pay` de Inc 1). **HU-04-08 cierre Z**: nueva tabla `cash_closes` (`CashClose`, RLS FORCE verificado `relforcerowsecurity=t`; índice `tenantId`; relación `Tenant→cashCloses`; append-only/inmutable) con `openedAt`/`closedAt`/`salesCount`/`voidCount`/`totalGross Decimal(12,2)`/`byMethod Json {cash,card,yape,plin}`/`userId?`. `GET /api/cash-close/preview` (`read Sale`) agrega ventas **issued** desde el último `closedAt` (o all-time): `{ periodStart, salesCount, voidCount, totalGross, byMethod, openSince }` (Σ `payment.amount` por método). `POST /api/cash-close` (`update Sale`, **manager/owner**; staff → 403; `@Audited('cash.close')`) persiste el agregado (`openedAt` = último `closedAt` o `issuedAt` de la 1ª venta; `closedAt=now`; `userId`=JWT `sub`) → tras cerrar, el siguiente preview arranca ventana fresca. `GET /api/cash-close` (`read Sale`) lista desc por `closedAt`. **SUNAT:** envío electrónico sigue **diferido/externo** (schema-ready). **E04 → 8/8.**

## E05 — Inventario, Compras y Mermas (11 HU)
| HU | Título | Estado | Spec | PR |
|---|---|---|---|---|
| HU-05-01 | Ver stock actual (kardex) | 🟢 Hecho | `HU-05-01-stock-movimientos-mermas` | #24 |
| HU-05-02 | Registrar entrada manual de stock | 🟢 Hecho | `HU-05-01-stock-movimientos-mermas` | #24 |
| HU-05-03 | Registrar salida manual | 🟢 Hecho | `HU-05-01-stock-movimientos-mermas` | #24 |
| HU-05-04 | Crear orden de compra | 🟢 Hecho | `HU-05-04-06-07-purchase-orders` | #25 |
| HU-05-05 | Enviar OC al proveedor | 🟡 Parcial (solo estado; email diferido) | `HU-05-04-06-07-purchase-orders` | #25 |
| HU-05-06 | Recepcionar OC (parcial/total) | 🟢 Hecho | `HU-05-04-06-07-purchase-orders` | #25 |
| HU-05-07 | Cancelar OC | 🟢 Hecho | `HU-05-04-06-07-purchase-orders` | #25 |
| HU-05-08 | Registrar merma con razón | 🟢 Hecho | `HU-05-01-stock-movimientos-mermas` | #24 |
| HU-05-09 | Ver histórico de mermas | 🟢 Hecho | `HU-05-01-stock-movimientos-mermas` | #24 |
| HU-05-10 | Alertas de stock bajo | 🟢 Hecho | `HU-05-01-stock-movimientos-mermas` | #24 |
| HU-05-11 | Detectar anomalías de mermas con IA | 🔲 Diferido (IA/E08) | — | — |

**E05: 9/11 backend** (Inc 1 = 6 · Inc 2 = 3) + HU-05-05 status-only. **Inc 1** (#24): stock/kardex, movimientos (entrada/salida), mermas con razón, histórico de mermas y alertas de stock bajo (`inventory_movements`, RLS FORCE, kardex event-sourced con delta firmado; `ingredients` gana `stock`/`minStock` `Decimal(12,3)`). **Inc 2** (#25): órdenes de compra — `purchase_orders` + `purchase_order_items` (RLS FORCE ambas, FK PO `ON DELETE CASCADE`), `PurchaseOrders{Controller,Service}` en el módulo `inventory`. HU-05-04 crear (`draft`, `total = Σ qtyOrdered·unitCost`); HU-05-06 recepcionar parcial/total → crea movimiento `purchase` + sube `stock` + fija `unitCost` (last purchase price), estado `partially_received`/`received` (reutiliza la lógica de movimiento de Inc 1, misma transacción `runInTenant`); HU-05-07 cancelar (`{draft,sent}→cancelled`, 409 si ya recibió). **HU-05-05** = solo transición `draft→sent`; el **email/PDF al proveedor está diferido** (servicio de correo externo, como E01). **HU-05-11** anomalías de merma = **servicio de IA (E08)**, diferido. Endpoints Inc 2: `POST/GET /api/purchase-orders`, `GET /api/purchase-orders/:id`, `POST /api/purchase-orders/:id/{send,receive,cancel}`.

## E06 — Costeo Dinámico y Márgenes (7 HU)
| HU | Título | Estado | Spec | PR |
|---|---|---|---|---|
| HU-06-01 | Cálculo dinámico de costo por plato | 🟢 Hecho | `HU-06-01-05-costeo` | #28 |
| HU-06-02 | Gestión de costos indirectos (CIF) mensuales | 🟢 Hecho | `HU-06-01-05-costeo` | #28 |
| HU-06-03 | Distribución prorrateada de CIF | 🟢 Hecho | `HU-06-01-05-costeo` | #28 |
| HU-06-04 | Cálculo de margen unitario por plato | 🟢 Hecho | `HU-06-01-05-costeo` | #28 |
| HU-06-05 | Sugerencia de precio por margen objetivo | 🟢 Hecho (fórmula, sin IA) | `HU-06-01-05-costeo` | #28 |
| HU-06-06 | Cierre de período mensual | 🟢 Hecho | `HU-06-06-07-cierre-variance` | #29 |
| HU-06-07 | Comparativo Costo Real vs Costo Teórico | 🟢 Hecho (ver nota realCost/auto-consumo) | `HU-06-06-07-cierre-variance` | #29 |

**E06: 7/7 backend (Inc 1 + Inc 2)** — Inc 2 (PR #29) extiende el módulo `costing` con **HU-06-06** (cierre de período) y **HU-06-07** (comparativo real vs teórico). Esquema nuevo **`costing_closes`** (`CostingClose`, RLS FORCE verificado `relforcerowsecurity='t'`; `@@unique([tenantId,period])` = un cierre por mes; índice `tenantId`; relación `Tenant→costingCloses`): `totalCIF`/`totalIngredientCost`/`totalRevenue`/`totalContribution` `Decimal(12,2)`, `totalUnits` `Int`, `snapshot` `Json` (el `PeriodCostingView` completo al cierre = cifra histórica inmutable), `closedAt`, `userId?`. **CASL:** reutiliza `Report` (cierre = `manage Report` + `@Audited('costing.close')`; lectura = `read Report`; staff → 403). **HU-06-06** `POST /api/costing/close { period }` reutiliza `CostingService.dishes()`, agrega totales (ingredientes/revenue/contribución = Σ por plato de `unitsSold·{ingredientCost|sellPrice|contributionMargin}`), persiste el `CostingClose`; **segundo cierre del mismo período → 409**; `GET /api/costing/closes` + `GET /api/costing/closes/:period` (404 si no existe). **HU-06-07** `GET /api/costing/cost-variance?period=` → `theoreticalCost` (= Σ `unitsSold·ingredientCost` del reporte), `realCost` (= salida valorizada de inventario: Σ `|qty|·ingredient.unitCost` sobre `inventory_movements` con `type∈{sale,waste}` y `createdAt` en el mes), `variance` (=real−teórico), `variancePct`, `byType:{waste,sale}`, `note`. **⚠️ Limitación (en `note` y en la spec):** pagar una orden **NO** descuenta stock automáticamente (no se crea movimiento `sale` de consumo en el cobro; el enlace POS↔inventario es integración futura, **no construido aquí**), por lo que hoy `realCost` refleja **principalmente mermas + salidas manuales**, no el consumo teórico de cada venta — el comparativo no debe leerse como "consumo real total de las ventas".

**E06: 5/7 backend (Inc 1)** — módulo nuevo `costing` (`CostingController` + `CostingService` + `OverheadController` + `OverheadService`). Esquema nuevo `overhead_costs` (`OverheadCost`, RLS FORCE verificado `relforcerowsecurity='t'`; índices `tenantId`+`period`; soft-delete; relación `Tenant→overheadCosts`). **Reutiliza** `RecipesService.costPerYieldTx` (BOM recursivo) para el costo de ingredientes — `CatalogModule` ahora **exporta** `RecipesService`. **CASL:** se **reutiliza el sujeto `Report`** (no se crea sujeto `Costing`): costeo = info de gestión → lectura (`read Report`) y escritura de CIF (`manage Report`) = owner/manager; **staff → 403** (aserción en `casl-ability.factory.spec.ts`). **HU-06-02** CRUD `/api/overhead-costs` (`{ period:YYYY-MM, concept, amount }`, `@Audited`). **HU-06-01/03/04** `GET /api/costing/dishes?period=` → por plato activo: `ingredientCost` (receta), `unitsSold` (Σ qty de `order_items` de ventas `issued` con `issuedAt` en el mes), `cifPerUnit` (= `totalCIF/totalUnits`, **prorrateo por partes iguales por unidad vendida**; `allocationBase='units'`; si `totalUnits=0` → 0), `fullCost` (= ingredientes + CIF), `foodCostPct`, `marginPct`, `contributionMargin` (moneda string). **HU-06-05** `GET /api/costing/suggest-price?menuItemId=&targetMarginPct=&period=` → `suggestedPrice = fullCost/(1−targetMarginPct/100)`, `targetMarginPct∈[0,99]` (**fórmula determinista, sin IA** pese al cross-ref HU-09-01; el impacto de demanda/forecast y alerta +20% se difieren a E08). **HU-06-06** (cierre de período inmutable) y **HU-06-07** (real vs teórico, consumirá `inventory_movements`) → **Inc 2**.

## E12 — Plataforma (lo tocado)
| HU | Título | Estado | Spec | PR |
|---|---|---|---|---|
| HU-12-02 | Health checks | 🟡 Parcial (falta readiness db/redis + 503) | `HU-12-02-health-y-contrato` | #3 |
| HU-12-06 | Aislamiento multi-tenant (RLS) | 🟢 Hecho (4 vectores) | `HU-12-06-rls-aislamiento` | #4 |

## Integración frontend ↔ backend
- Auth (login/register) integrada y validada E2E (frontend PR #1).
- Proxy autenticado del BFF (`backendFetch`) + `/api/users` (frontend PR #2). Rutas de dominio (recipes/inventory/…) siguen mock hasta E02–E05.

## Infra foundational (transversal — no es una HU)
`src/shared/` (contrato Zod), `PrismaService.runInTenant`, `ZodValidationPipe`, `JwtAuthGuard`,
`PoliciesGuard`/CASL, `AuthDbClient`/`gastronomia_auth`, `AuditInterceptor`.

## Próximas épicas
E02 (catálogo/recetas) → E03 (POS) → E04 (cobros) → E05 (inventario) → E06 (costeo) → E07 (reportes) → E08 (forecasting) → E09 (chat) → E10 (notificaciones) → E11 (ingesta). Cada backend habilita proxear sus rutas del BFF.
