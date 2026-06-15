# Product Backlog — GastronomIA

**Autores:** Cortez & Ventura  
**Total:** 102 historias de usuario · 12 épicas  
**Formato:** Como [rol] / Quiero [funcionalidad] / Para [valor]. Criterios de aceptación en Gherkin.

> Prioridad: **Must** / **Should** / **Could** · SP = Story Points · Sprint = sprint asignado · iE_ID = requisito de ingeniería asociado.

---

## Resumen

| ID HU | Épica | Título | Prioridad | SP | Sprint | Dependencias | iE_ID |
|-------|-------|--------|-----------|----|--------|--------------|-------|
| HU-01-01 | E01 | Registro de restaurante (tenant) | Must | 5 | S1 | — | iE3.2 |
| HU-01-02 | E01 | Login con email y password | Must | 3 | S1 | — | iE3.2 |
| HU-01-03 | E01 | Refresh token con rotacion | Must | 3 | S1 | HU-01-02 | iE3.2 |
| HU-01-04 | E01 | Gestion de roles y permisos (RBAC) | Must | 5 | S1 | HU-01-01 | iE3.2 |
| HU-01-05 | E01 | Invitacion de usuarios por email | Must | 5 | S1 | HU-01-04 | iE3.2 |
| HU-01-06 | E01 | Cambio de contraseña | Should | 2 | S1 | HU-01-02 | iE3.2 |
| HU-01-07 | E01 | Recuperacion de contraseña | Should | 3 | S1 | HU-01-02 | iE3.2 |
| HU-01-08 | E01 | Cierre de sesion | Must | 1 | S1 | HU-01-02 | iE3.2 |
| HU-01-09 | E01 | Audit log de acciones criticas | Must | 5 | S1 | HU-01-04 | iE3.2 |
| HU-01-10 | E01 | Configuracion de parametros del local | Must | 3 | S1 | HU-01-01 | iE3.2 |
| HU-02-01 | E02 | CRUD de insumos | Must | 5 | S1 | HU-01-04 | iE3.1 |
| HU-02-02 | E02 | Carga masiva de insumos via Excel | Should | 5 | S2 | HU-02-01 | iE3.1 |
| HU-02-03 | E02 | Gestion de unidades de medida con conversion | Must | 3 | S1 | — | iE3.1 |
| HU-02-04 | E02 | Gestion de categorias jerarquicas | Should | 2 | S1 | — | iE3.1 |
| HU-02-05 | E02 | CRUD de proveedores | Must | 3 | S1 | HU-01-04 | iE3.1 |
| HU-02-06 | E02 | Asociar productos con proveedores | Should | 3 | S2 | HU-02-01,HU-02-05 | iE3.1 |
| HU-02-07 | E02 | Crear receta estandarizada (BOM) | Must | 8 | S2 | HU-02-01,HU-02-03 | iE3.1 |
| HU-02-08 | E02 | Soportar sub-recetas anidadas | Should | 5 | S2 | HU-02-07 | iE3.1 |
| HU-02-09 | E02 | Versionado de recetas | Should | 5 | S2 | HU-02-07 | iE3.1 |
| HU-02-10 | E02 | Crear plato del menu | Must | 3 | S2 | HU-02-07 | iE3.1 |
| HU-02-11 | E02 | Gestion de modificadores | Should | 2 | S3 | HU-02-10 | iE3.1 |
| HU-02-12 | E02 | Gestion de categorias del menu | Should | 2 | S2 | — | iE3.1 |
| HU-02-13 | E02 | Disponibilidad por horario | Could | 3 | S3 | HU-02-10 | iE3.1 |
| HU-02-14 | E02 | Foto del plato | Should | 2 | S3 | HU-02-10 | iE3.1 |
| HU-03-01 | E03 | Configurar zonas y mesas | Must | 3 | S2 | — | iE3.1 |
| HU-03-02 | E03 | Vista mapa de mesas con estado real-time | Must | 5 | S2 | HU-03-01 | iE3.1 |
| HU-03-03 | E03 | Abrir mesa | Must | 2 | S2 | HU-03-02 | iE3.1 |
| HU-03-04 | E03 | Tomar orden | Must | 5 | S2 | HU-03-03 | iE3.1 |
| HU-03-05 | E03 | Aplicar modificadores | Must | 3 | S3 | HU-03-04,HU-02-11 | iE3.1 |
| HU-03-06 | E03 | Enviar comanda a cocina | Must | 5 | S2 | HU-03-04 | iE3.1 |
| HU-03-07 | E03 | Vista KDS por estacion | Must | 8 | S2 | HU-03-06 | iE3.1 |
| HU-03-08 | E03 | Marcar item en preparacion | Must | 3 | S2 | HU-03-07 | iE3.1 |
| HU-03-09 | E03 | Marcar item listo | Must | 3 | S2 | HU-03-08 | iE3.1 |
| HU-03-10 | E03 | Marcar item servido | Should | 2 | S3 | HU-03-09 | iE3.1 |
| HU-03-11 | E03 | Anular orden con razon | Must | 3 | S2 | HU-03-04 | iE3.1 |
| HU-03-12 | E03 | Solicitar cuenta | Should | 2 | S3 | HU-03-04 | iE3.1 |
| HU-04-01 | E04 | Generar pre-cuenta | Must | 3 | S3 | HU-03-04 | iE3.1 |
| HU-04-02 | E04 | Generar cuenta final | Must | 5 | S3 | HU-04-01 | iE3.1 |
| HU-04-03 | E04 | Division de cuenta por comensal | Should | 5 | S3 | HU-04-02 | iE3.1 |
| HU-04-04 | E04 | Registrar pago en efectivo | Must | 3 | S3 | HU-04-02 | iE3.1 |
| HU-04-05 | E04 | Registrar pago electronico (Yape, Plin, tarjeta) | Must | 3 | S3 | HU-04-02 | iE3.1 |
| HU-04-06 | E04 | Pago mixto | Should | 3 | S3 | HU-04-04,HU-04-05 | iE3.1 |
| HU-04-07 | E04 | Anular ticket | Should | 3 | S3 | HU-04-04 | iE3.1 |
| HU-04-08 | E04 | Cierre Z del dia | Must | 5 | S4 | HU-04-04,HU-04-05 | iE3.1 |
| HU-05-01 | E05 | Ver stock actual (kardex) | Must | 3 | S3 | HU-02-01 | iE3.1 |
| HU-05-02 | E05 | Registrar entrada manual de stock | Must | 3 | S3 | HU-05-01 | iE3.1 |
| HU-05-03 | E05 | Registrar salida manual | Should | 3 | S3 | HU-05-01 | iE3.1 |
| HU-05-04 | E05 | Crear orden de compra | Must | 5 | S3 | HU-02-05 | iE3.1 |
| HU-05-05 | E05 | Enviar OC al proveedor | Should | 3 | S3 | HU-05-04 | iE3.1 |
| HU-05-06 | E05 | Recepcionar OC (parcial o total) | Must | 5 | S3 | HU-05-05 | iE3.1 |
| HU-05-07 | E05 | Cancelar OC | Could | 2 | S4 | HU-05-04 | iE3.1 |
| HU-05-08 | E05 | Registrar merma con razon | Must | 3 | S3 | HU-05-01 | iE3.1 |
| HU-05-09 | E05 | Ver historico de mermas | Should | 3 | S4 | HU-05-08 | iE3.1 |
| HU-05-10 | E05 | Alertas de stock bajo | Must | 3 | S4 | HU-05-01 | iE3.1 |
| HU-05-11 | E05 | Detectar anomalias de mermas con IA | Could | 5 | S5 | HU-05-08,HU-08-01 | iE3.1 |
| HU-06-01 | E06 | Calculo dinamico de costo por plato | Must | 8 | S3 | HU-02-07 | iE3.1 |
| HU-06-02 | E06 | Gestion de costos indirectos (CIF) mensuales | Must | 5 | S3 | — | iE3.1 |
| HU-06-03 | E06 | Distribucion prorrateada de CIF | Must | 5 | S4 | HU-06-02 | iE3.1 |
| HU-06-04 | E06 | Calculo de margen unitario por plato | Must | 3 | S3 | HU-06-01 | iE3.1 |
| HU-06-05 | E06 | Sugerencia de precio por margen objetivo | Should | 5 | S4 | HU-06-04,HU-09-01 | iE3.1 |
| HU-06-06 | E06 | Cierre de periodo mensual | Should | 3 | S4 | HU-06-03 | iE3.1 |
| HU-06-07 | E06 | Comparativo Costo Real vs Costo Teorico | Could | 5 | S5 | HU-06-01,HU-05-01 | iE3.1 |
| HU-07-01 | E07 | Dashboard de admin | Must | 8 | S4 | — | iE3.1 |
| HU-07-02 | E07 | Dashboard de gerente (operativo) | Must | 5 | S4 | — | iE3.1 |
| HU-07-03 | E07 | Dashboard de cajero (caja del dia) | Must | 3 | S4 | — | iE3.1 |
| HU-07-04 | E07 | Reporte de ventas | Must | 5 | S4 | — | iE3.1 |
| HU-07-05 | E07 | Reporte de inventario | Must | 3 | S4 | HU-05-01 | iE3.1 |
| HU-07-06 | E07 | Reporte de food cost | Should | 5 | S5 | HU-06-01 | iE3.1 |
| HU-07-07 | E07 | Reporte de mermas | Should | 3 | S4 | HU-05-09 | iE3.1 |
| HU-07-08 | E07 | Analisis Pareto de platos | Should | 5 | S5 | — | iE3.1 |
| HU-07-09 | E07 | Cierre Z (cierre del dia) | Must | 3 | S4 | HU-04-08 | iE3.1 |
| HU-07-10 | E07 | Exportacion PDF/Excel/CSV | Should | 5 | S5 | HU-07-04 | iE3.1 |
| HU-08-01 | E08 | Configurar parametros de forecasting | Must | 5 | S4 | — | iE4.1 |
| HU-08-02 | E08 | Ejecutar forecast manual | Must | 5 | S4 | HU-08-01 | iE4.1 |
| HU-08-03 | E08 | Ejecutar forecast automatico semanal | Must | 3 | S4 | HU-08-02 | iE4.1 |
| HU-08-04 | E08 | Ver predicciones por plato | Must | 5 | S4 | HU-08-02 | iE4.1 |
| HU-08-05 | E08 | Comparar prediccion vs realidad | Should | 5 | S5 | HU-08-04 | iE4.1 |
| HU-08-06 | E08 | Sugerencias de compra basadas en forecast | Should | 8 | S5 | HU-08-04,HU-05-01 | iE4.1 |
| HU-08-07 | E08 | Variables exogenas peruanas | Must | 5 | S4 | HU-08-02 | iE4.1 |
| HU-08-08 | E08 | Evaluacion del modelo (MAPE, sMAPE) | Must | 5 | S5 | HU-08-05 | iE4.1 |
| HU-09-01 | E09 | Conversacion con IA en lenguaje natural | Must | 13 | S5 | — | iE4.2 |
| HU-09-02 | E09 | Visualizar SQL generado y citaciones | Should | 3 | S5 | HU-09-01 | iE4.2 |
| HU-09-03 | E09 | Historial de conversaciones | Should | 3 | S5 | HU-09-01 | iE4.2 |
| HU-09-04 | E09 | Feedback de respuestas | Could | 2 | S5 | HU-09-01 | iE4.2 |
| HU-09-05 | E09 | Streaming de respuestas en tiempo real | Should | 5 | S5 | HU-09-01 | iE4.2 |
| HU-09-06 | E09 | Defense-in-depth de SQL | Must | 13 | S5 | HU-09-01 | iE4.2 |
| HU-09-07 | E09 | Sugerencias contextuales | Could | 3 | S5 | HU-09-01 | iE4.2 |
| HU-10-01 | E10 | Notificacion in-app | Must | 3 | S4 | — | iE3.1 |
| HU-10-02 | E10 | Notificacion por email | Should | 3 | S4 | HU-10-01 | iE3.1 |
| HU-10-03 | E10 | Preferencias de notificacion | Should | 3 | S4 | HU-10-01 | iE3.1 |
| HU-10-04 | E10 | Alertas accionables de IA | Should | 3 | S5 | HU-08-06,HU-05-11 | iE3.1 |
| HU-11-01 | E11 | Wizard de migracion guiado | Should | 8 | S1 | HU-01-10 | iE3.1 |
| HU-11-02 | E11 | Importar productos desde Excel/CSV | Should | 5 | S1 | HU-11-01,HU-02-02 | iE3.1 |
| HU-11-03 | E11 | Importar historico de ventas | Should | 8 | S2 | HU-11-01 | iE3.1 |
| HU-11-04 | E11 | Idempotencia de la importacion | Must | 3 | S2 | HU-11-02 | iE3.1 |
| HU-11-05 | E11 | Validar e identificar errores antes de importar | Should | 5 | S2 | HU-11-02 | iE3.1 |
| HU-12-01 | E12 | Despliegue automatizado CI/CD | Must | 8 | S0 | — | iE3.3 |
| HU-12-02 | E12 | Health checks | Must | 2 | S0 | — | iE3.3 |
| HU-12-03 | E12 | Logs estructurados con correlacion | Must | 3 | S0 | — | iE3.3 |
| HU-12-04 | E12 | Metricas y traces (OpenTelemetry) | Should | 5 | S0 | — | iE3.3 |
| HU-12-05 | E12 | Backup automatico | Must | 3 | S0 | — | iE3.3 |
| HU-12-06 | E12 | Aislamiento multi-tenant verificado (RLS) | Must | 5 | S0 | HU-01-01 | iE3.2 |

---

## Detalle de historias de usuario

### E01 — Identity, Multi-Tenancy y Seguridad

_Onboarding del restaurante, autenticacion, autorizacion (RBAC), refresh tokens, audit log y configuracion de parametros del local. Base de toda la plataforma._

#### HU-01-01 · Registro de restaurante (tenant)

**Prioridad:** Must · **SP:** 5 · **Sprint:** S1 · **Dependencias:** — · **iE_ID:** iE3.2

Como **Administrador**, quiero **registrar mi restaurante en la plataforma con su RUC, nombre comercial y configuracion inicial**, para **tener mi propio espacio aislado en la plataforma con datos seguros**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN un visitante en la pagina de registro
WHEN ingresa RUC valido (11 digitos), nombre y email del admin
THEN se crea el tenant con esquema aislado
AND se envia email de bienvenida
AND el admin queda autenticado automaticamente
```

#### HU-01-02 · Login con email y password

**Prioridad:** Must · **SP:** 3 · **Sprint:** S1 · **Dependencias:** — · **iE_ID:** iE3.2

Como **Usuario**, quiero **iniciar sesion con mi email y contraseña**, para **acceder a las funciones segun mi rol asignado**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN un usuario registrado y activo
WHEN ingresa credenciales validas
THEN recibe access token (15 min) y refresh token (7 dias)
AND es redirigido a su dashboard segun rol
GIVEN credenciales invalidas
WHEN intenta login 5 veces seguidas
THEN la cuenta se bloquea por 15 minutos
```

#### HU-01-03 · Refresh token con rotacion

**Prioridad:** Must · **SP:** 3 · **Sprint:** S1 · **Dependencias:** HU-01-02 · **iE_ID:** iE3.2

Como **Usuario**, quiero **renovar mi sesion automaticamente sin volver a ingresar credenciales**, para **mantener una experiencia continua sin perder mi trabajo**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN un access token expirado
WHEN el frontend envia el refresh token
THEN se emite un nuevo par de tokens
AND el refresh token anterior queda revocado
GIVEN un refresh token reusado (detectado)
THEN se revocan TODOS los tokens del usuario y se cierra sesion
```

#### HU-01-04 · Gestion de roles y permisos (RBAC)

**Prioridad:** Must · **SP:** 5 · **Sprint:** S1 · **Dependencias:** HU-01-01 · **iE_ID:** iE3.2

> **Reconciliado 2026-06-15:** roles = **3** (Owner / Manager / Staff), no 5 — alineado con el frontend ya implementado (42 pantallas con gating) y `backend.md`. Ver `specs/TRACEABILITY.md`.

Como **Administrador**, quiero **asignar roles fijos (Owner, Manager, Staff) a mis usuarios**, para **controlar quien accede a que parte del sistema**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN un usuario nuevo
WHEN el admin le asigna un rol
THEN el usuario ve solo las funciones permitidas para ese rol
AND los endpoints API rechazan acciones fuera de su matriz de permisos
GIVEN un mesero intenta acceder a reportes financieros
THEN recibe HTTP 403 Forbidden
```

#### HU-01-05 · Invitacion de usuarios por email

**Prioridad:** Must · **SP:** 5 · **Sprint:** S1 · **Dependencias:** HU-01-04 · **iE_ID:** iE3.2

Como **Administrador**, quiero **invitar a mis empleados por email para que se registren**, para **onboarding rapido del equipo del restaurante**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN el admin esta en gestion de usuarios
WHEN ingresa email + rol y envia invitacion
THEN se envia email con link unico (24h)
AND el invitado completa registro con su nombre y password
AND queda asociado al tenant del invitador
```

#### HU-01-06 · Cambio de contraseña

**Prioridad:** Should · **SP:** 2 · **Sprint:** S1 · **Dependencias:** HU-01-02 · **iE_ID:** iE3.2

Como **Usuario**, quiero **cambiar mi contraseña actual desde mi perfil**, para **mantener la seguridad de mi cuenta**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN un usuario autenticado
WHEN ingresa password actual + nueva (min 12 chars, mayus, minus, digito, simbolo)
THEN se actualiza el hash bcrypt
AND se revocan todos sus refresh tokens activos
AND se notifica por email del cambio
```

#### HU-01-07 · Recuperacion de contraseña

**Prioridad:** Should · **SP:** 3 · **Sprint:** S1 · **Dependencias:** HU-01-02 · **iE_ID:** iE3.2

Como **Usuario**, quiero **recuperar mi contraseña olvidada por email**, para **no perder acceso a mi cuenta**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN un usuario olvido su password
WHEN ingresa su email en "Recuperar password"
THEN se envia link unico (60 min) al email
AND al ingresar nuevo password se invalidan refresh tokens
AND se registra el evento en audit log
```

#### HU-01-08 · Cierre de sesion

**Prioridad:** Must · **SP:** 1 · **Sprint:** S1 · **Dependencias:** HU-01-02 · **iE_ID:** iE3.2

Como **Usuario**, quiero **cerrar mi sesion de forma segura**, para **proteger mi cuenta cuando termino de usar el sistema**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN un usuario autenticado
WHEN hace click en "Cerrar sesion"
THEN se revoca su refresh token actual
AND el frontend borra el access token de memoria
AND es redirigido a la pantalla de login
```

#### HU-01-09 · Audit log de acciones criticas

**Prioridad:** Must · **SP:** 5 · **Sprint:** S1 · **Dependencias:** HU-01-04 · **iE_ID:** iE3.2

Como **Administrador**, quiero **ver un registro inmutable de todas las acciones criticas en mi tenant**, para **auditar quien hizo que y cumplir Ley 29733 PE**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN cualquier accion marcada como @Audited (login, anulaciones, cambios de precio, exports)
WHEN se ejecuta
THEN se persiste en audit_logs con before/after, user_id, IP y user-agent
AND se conserva 5 anos
AND no es editable por nadie (incluido el admin)
```

#### HU-01-10 · Configuracion de parametros del local

**Prioridad:** Must · **SP:** 3 · **Sprint:** S1 · **Dependencias:** HU-01-01 · **iE_ID:** iE3.2

Como **Administrador**, quiero **configurar moneda, IGV, aforo, horarios y datos fiscales del restaurante**, para **adaptar la plataforma a la realidad operativa de mi negocio**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN admin autenticado
WHEN actualiza configuracion (moneda PEN, IGV 18%, horarios, aforo, direccion fiscal)
THEN los valores se aplican inmediatamente en todo el sistema
AND quedan registrados en audit log
```

### E02 — Catalogo, Recetas y Menu

_Insumos, unidades, categorias, proveedores, recetas estandarizadas (BOM), versionado de recetas, menu vendible, modificadores y carga masiva._

#### HU-02-01 · CRUD de insumos

**Prioridad:** Must · **SP:** 5 · **Sprint:** S1 · **Dependencias:** HU-01-04 · **iE_ID:** iE3.1

Como **Gerente**, quiero **crear, editar, eliminar y listar mis insumos (productos)**, para **mantener actualizado el catalogo base del restaurante**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN gerente autenticado
WHEN crea insumo (SKU, nombre, tipo, unidad, categoria, costo inicial)
THEN se persiste con tenant_id y es visible solo en su tenant
AND el SKU es unico por tenant
AND soft delete preserva referencias historicas
```

#### HU-02-02 · Carga masiva de insumos via Excel

**Prioridad:** Should · **SP:** 5 · **Sprint:** S2 · **Dependencias:** HU-02-01 · **iE_ID:** iE3.1

Como **Gerente**, quiero **importar mi catalogo de insumos desde Excel/CSV**, para **no registrar uno por uno cuando son cientos**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN un archivo Excel con columnas estandarizadas
WHEN gerente lo sube
THEN se valida cada fila (formato, duplicados, FKs)
AND se importan los validos
AND se muestra reporte de errores con linea exacta
AND la operacion es idempotente (rerunnable sin duplicar)
```

#### HU-02-03 · Gestion de unidades de medida con conversion

**Prioridad:** Must · **SP:** 3 · **Sprint:** S1 · **Dependencias:** — · **iE_ID:** iE3.1

Como **Gerente**, quiero **definir unidades (kg, g, l, ml, unidad, porcion) y sus factores de conversion**, para **tener flexibilidad para comprar en kg pero usar en gramos**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN gerente en gestion de unidades
WHEN crea unidad con factor de conversion a una unidad base
THEN puede convertir cantidades automaticamente entre unidades de la misma familia
AND el sistema rechaza conversiones entre familias incompatibles (kg a litros)
```

#### HU-02-04 · Gestion de categorias jerarquicas

**Prioridad:** Should · **SP:** 2 · **Sprint:** S1 · **Dependencias:** — · **iE_ID:** iE3.1

Como **Gerente**, quiero **organizar mis insumos y platos en categorias y sub-categorias**, para **tener navegacion clara y reportes agrupados**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN gerente en gestion de categorias
WHEN crea/edita categorias con relacion padre-hija
THEN se renderiza arbol jerarquico
AND no se permiten ciclos
AND no se permite eliminar categoria con productos asociados
```

#### HU-02-05 · CRUD de proveedores

**Prioridad:** Must · **SP:** 3 · **Sprint:** S1 · **Dependencias:** HU-01-04 · **iE_ID:** iE3.1

Como **Gerente**, quiero **gestionar mis proveedores con RUC, contacto, terminos de pago y lead time**, para **tener registro completo y poder generar OCs**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN gerente en gestion de proveedores
WHEN crea proveedor con RUC, contacto, lead time
THEN queda activo y disponible para OCs
AND el RUC se valida (11 digitos)
AND no se elimina si tiene OCs historicas (solo se desactiva)
```

#### HU-02-06 · Asociar productos con proveedores

**Prioridad:** Should · **SP:** 3 · **Sprint:** S2 · **Dependencias:** HU-02-01,HU-02-05 · **iE_ID:** iE3.1

Como **Gerente**, quiero **vincular cada insumo con sus proveedores frecuentes y ultimo precio de compra**, para **acelerar la creacion de OCs y comparar precios**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN producto e existente y proveedor activo
WHEN se crea relacion en product_suppliers
THEN se guarda SKU del proveedor, ultimo precio y si es preferido
AND se actualiza last_purchase_price automaticamente al recepcionar OC
```

#### HU-02-07 · Crear receta estandarizada (BOM)

**Prioridad:** Must · **SP:** 8 · **Sprint:** S2 · **Dependencias:** HU-02-01,HU-02-03 · **iE_ID:** iE3.1

Como **Gerente**, quiero **crear receta de un plato con sus ingredientes, cantidades y mermas**, para **estandarizar la preparacion y calcular costo real**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN gerente en editor de recetas
WHEN agrega ingredientes (productos), cantidades, unidades y waste_factor
THEN se calcula costo total dinamico de la receta
AND el costo se actualiza automaticamente si cambia precio de algun insumo
AND el waste_factor se aplica como multiplicador sobre la cantidad
```

#### HU-02-08 · Soportar sub-recetas anidadas

**Prioridad:** Should · **SP:** 5 · **Sprint:** S2 · **Dependencias:** HU-02-07 · **iE_ID:** iE3.1

Como **Gerente**, quiero **usar una receta como ingrediente de otra (ej: salsa criolla en lomo saltado)**, para **modelar correctamente preparaciones intermedias**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN una receta base existente (salsa criolla)
WHEN se agrega como ingrediente type=RECIPE en otra receta (lomo saltado)
THEN el costo se calcula recursivamente
AND se detectan ciclos (receta A usa B que usa A) y se rechazan
AND la profundidad maxima es 5 niveles
```

#### HU-02-09 · Versionado de recetas

**Prioridad:** Should · **SP:** 5 · **Sprint:** S2 · **Dependencias:** HU-02-07 · **iE_ID:** iE3.1

Como **Gerente**, quiero **mantener historico de cambios en mis recetas con su costo al momento**, para **auditar cambios y costear ventas pasadas correctamente**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN una receta en uso
WHEN se modifica algun ingrediente o cantidad
THEN se crea automaticamente RecipeVersion con snapshot completo
AND el costo del periodo anterior usa la version anterior
AND el numero de version se incrementa
```

#### HU-02-10 · Crear plato del menu

**Prioridad:** Must · **SP:** 3 · **Sprint:** S2 · **Dependencias:** HU-02-07 · **iE_ID:** iE3.1

Como **Gerente**, quiero **crear plato vendible asociado a una receta con precio de venta**, para **mostrarlo en la carta y poder venderlo en POS**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN gerente con recetas creadas
WHEN crea menu_item con receta + precio de venta + categoria menu + foto
THEN aparece en la carta del POS
AND se calcula margen unitario en tiempo real
AND si margen < 25% se muestra alerta
```

#### HU-02-11 · Gestion de modificadores

**Prioridad:** Should · **SP:** 2 · **Sprint:** S3 · **Dependencias:** HU-02-10 · **iE_ID:** iE3.1

Como **Gerente**, quiero **definir modificadores opcionales (extra queso, sin cebolla, picante) con su delta de precio**, para **personalizar pedidos sin crear platos duplicados**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN un menu_item
WHEN gerente le agrega modificadores con price_delta
THEN aparecen en POS al seleccionar el plato
AND el precio total se ajusta automaticamente
AND los obligatorios deben seleccionarse antes de enviar a cocina
```

#### HU-02-12 · Gestion de categorias del menu

**Prioridad:** Should · **SP:** 2 · **Sprint:** S2 · **Dependencias:** — · **iE_ID:** iE3.1

Como **Gerente**, quiero **organizar la carta en categorias (entradas, principales, postres, bebidas)**, para **navegacion intuitiva en POS y app del cliente**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN gerente en gestion del menu
WHEN crea/ordena categorias menu
THEN se reflejan inmediatamente en POS
AND drag-and-drop reordena visualmente
AND categorias inactivas no aparecen en POS pero se conservan
```

#### HU-02-13 · Disponibilidad por horario

**Prioridad:** Could · **SP:** 3 · **Sprint:** S3 · **Dependencias:** HU-02-10 · **iE_ID:** iE3.1

Como **Gerente**, quiero **activar/desactivar platos por horario o por dia**, para **manejar carta de almuerzo vs cena, o platos solo de fin de semana**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN un menu_item
WHEN gerente define ventana horaria de disponibilidad
THEN solo aparece en POS dentro de esa ventana
AND el sistema usa la zona horaria del tenant
```

#### HU-02-14 · Foto del plato

**Prioridad:** Should · **SP:** 2 · **Sprint:** S3 · **Dependencias:** HU-02-10 · **iE_ID:** iE3.1

Como **Gerente**, quiero **subir foto de cada plato del menu**, para **mejorar la experiencia visual en POS y carta del cliente**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN un menu_item
WHEN gerente sube imagen (max 5MB, jpg/png/webp)
THEN se redimensiona a 1024x1024 y se sube a R2
AND se guarda URL en image_url
AND se sirve via CDN con cache
```

### E03 — POS, Salon y Cocina (KDS)

_Mapa de mesas con estado real-time, toma de orden mobile-first, envio de comandas a cocina via WebSockets, KDS por estacion y flujo POS-Cocina-Mesero._

#### HU-03-01 · Configurar zonas y mesas

**Prioridad:** Must · **SP:** 3 · **Sprint:** S2 · **Dependencias:** — · **iE_ID:** iE3.1

Como **Gerente**, quiero **definir zonas (terraza, salon, barra) y mesas con codigo y capacidad**, para **reflejar el layout fisico del restaurante en el sistema**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN gerente en configuracion de salon
WHEN crea zonas y agrega mesas (codigo, capacidad)
THEN se renderiza mapa visual
AND el codigo de mesa es unico por tenant
AND se pueden mover mesas entre zonas via drag-and-drop
```

#### HU-03-02 · Vista mapa de mesas con estado real-time

**Prioridad:** Must · **SP:** 5 · **Sprint:** S2 · **Dependencias:** HU-03-01 · **iE_ID:** iE3.1

Como **Mesero**, quiero **ver el estado de todas las mesas en tiempo real (libre, ocupada, cobrando, limpieza)**, para **saber que mesa atender sin caminar al salon**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN mesero autenticado
WHEN abre la vista de salon en su tablet
THEN ve mapa con colores por estado
AND si otro usuario cambia estado de una mesa, se actualiza en <1s via WebSocket
AND el estado se sincroniza entre todos los dispositivos conectados
```

#### HU-03-03 · Abrir mesa

**Prioridad:** Must · **SP:** 2 · **Sprint:** S2 · **Dependencias:** HU-03-02 · **iE_ID:** iE3.1

Como **Mesero**, quiero **abrir una mesa y asignarme como atendedor**, para **iniciar el flujo de toma de orden**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN mesa en estado FREE
WHEN mesero la selecciona y confirma comensales
THEN cambia a OCCUPIED
AND se crea Order asociada al mesero
AND se persiste idempotency_key para evitar duplicados
```

#### HU-03-04 · Tomar orden

**Prioridad:** Must · **SP:** 5 · **Sprint:** S2 · **Dependencias:** HU-03-03 · **iE_ID:** iE3.1

Como **Mesero**, quiero **agregar platos del menu a la orden con cantidad e instrucciones especiales**, para **registrar lo que pide el cliente**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN mesa abierta con orden activa
WHEN mesero busca/escanea platos y los agrega
THEN se calcula subtotal en tiempo real
AND se permite editar cantidad o quitar items antes de enviar a cocina
AND el numero de comensales puede ajustarse
```

#### HU-03-05 · Aplicar modificadores

**Prioridad:** Must · **SP:** 3 · **Sprint:** S3 · **Dependencias:** HU-03-04,HU-02-11 · **iE_ID:** iE3.1

Como **Mesero**, quiero **aplicar modificadores (extra queso, sin cebolla) al item de la orden**, para **personalizar segun preferencia del cliente**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN un item agregado a la orden
WHEN mesero abre modificadores y selecciona
THEN se ajusta unit_price con price_delta
AND modificadores obligatorios deben elegirse antes de enviar a cocina
AND quedan persistidos en JSONB del order_item
```

#### HU-03-06 · Enviar comanda a cocina

**Prioridad:** Must · **SP:** 5 · **Sprint:** S2 · **Dependencias:** HU-03-04 · **iE_ID:** iE3.1

Como **Mesero**, quiero **enviar la orden a cocina con un solo click**, para **que cocina vea inmediatamente lo que debe preparar**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN orden con items pendientes
WHEN mesero hace click en "Enviar a cocina"
THEN cada item se asigna a su KitchenStation segun categoria
AND aparece en KDS de la estacion correspondiente en <500ms
AND el estado del item pasa a PENDING
AND el estado de la orden a SENT_TO_KITCHEN
```

#### HU-03-07 · Vista KDS por estacion

**Prioridad:** Must · **SP:** 8 · **Sprint:** S2 · **Dependencias:** HU-03-06 · **iE_ID:** iE3.1

Como **Cocinero**, quiero **ver en pantalla los items que mi estacion debe preparar, ordenados por tiempo**, para **tener clara la cola de trabajo sin papeles**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN cocinero asignado a una estacion
WHEN abre KDS en pantalla de cocina
THEN ve cards con items PENDING/PREPARING ordenados por sent_to_kitchen_at
AND cada card muestra mesa, plato, cantidad, modificadores e instrucciones
AND items con espera > 10 min se marcan en rojo
```

#### HU-03-08 · Marcar item en preparacion

**Prioridad:** Must · **SP:** 3 · **Sprint:** S2 · **Dependencias:** HU-03-07 · **iE_ID:** iE3.1

Como **Cocinero**, quiero **marcar un item como "en preparacion" desde KDS**, para **indicar al sistema y al mesero que ya estoy cocinando**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN un item PENDING en KDS
WHEN cocinero hace tap en "Iniciar"
THEN cambia a PREPARING
AND se registra timestamp
AND se notifica al mesero via WebSocket
```

#### HU-03-09 · Marcar item listo

**Prioridad:** Must · **SP:** 3 · **Sprint:** S2 · **Dependencias:** HU-03-08 · **iE_ID:** iE3.1

Como **Cocinero**, quiero **marcar un item como "listo" para que el mesero lo recoja**, para **comunicar sin gritar que el plato esta listo**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN un item PREPARING
WHEN cocinero hace tap en "Listo"
THEN cambia a READY
AND se notifica al mesero (notificacion in-app + sonido)
AND queda en cola visual de "para servir"
```

#### HU-03-10 · Marcar item servido

**Prioridad:** Should · **SP:** 2 · **Sprint:** S3 · **Dependencias:** HU-03-09 · **iE_ID:** iE3.1

Como **Mesero**, quiero **confirmar que entregue el plato al cliente**, para **cerrar el ciclo del item y disparar conteo de tiempo de servicio**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN un item READY
WHEN mesero confirma servido
THEN cambia a SERVED
AND se calcula tiempo total de servicio (envio a kitchen → servido)
AND el dato alimenta KPIs de calidad de servicio
```

#### HU-03-11 · Anular orden con razon

**Prioridad:** Must · **SP:** 3 · **Sprint:** S2 · **Dependencias:** HU-03-04 · **iE_ID:** iE3.1

Como **Mesero**, quiero **anular una orden completa con un motivo**, para **manejar errores o cambios de pedido del cliente**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN orden OPEN o SENT_TO_KITCHEN
WHEN mesero solicita anulacion con razon (texto obligatorio)
THEN se valida que tenga permiso
AND se cambia estado a VOID
AND se registra en audit log
AND si tenia items en cocina, se notifica a cocina
```

#### HU-03-12 · Solicitar cuenta

**Prioridad:** Should · **SP:** 2 · **Sprint:** S3 · **Dependencias:** HU-03-04 · **iE_ID:** iE3.1

Como **Mesero**, quiero **marcar mesa como "solicitando cuenta"**, para **avisar al cajero que el cliente quiere pagar**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN orden con items SERVED
WHEN mesero marca "solicitar cuenta"
THEN mesa cambia a BILL_REQUESTED
AND se notifica al cajero
AND aparece en cola de "por cobrar" del cajero
```

### E04 — Tickets, Cobros y Pagos

_Pre-cuenta, cuenta final, division por comensal, pagos en efectivo y electronicos (Yape, Plin, tarjeta), pagos mixtos, anulacion y schema preparado para SUNAT._

#### HU-04-01 · Generar pre-cuenta

**Prioridad:** Must · **SP:** 3 · **Sprint:** S3 · **Dependencias:** HU-03-04 · **iE_ID:** iE3.1

Como **Cajero**, quiero **generar la pre-cuenta de una mesa con totales calculados**, para **mostrar al cliente lo que debe antes de cobrar**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN orden con items SERVED
WHEN cajero solicita pre-cuenta
THEN se calcula subtotal, IGV (18%), propina sugerida (10%) y total
AND se imprime en formato compacto
AND el ticket queda en estado DRAFT
```

#### HU-04-02 · Generar cuenta final

**Prioridad:** Must · **SP:** 5 · **Sprint:** S3 · **Dependencias:** HU-04-01 · **iE_ID:** iE3.1

Como **Cajero**, quiero **convertir la pre-cuenta en cuenta final con tipo de documento**, para **emitir el comprobante para cobrar**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN pre-cuenta lista
WHEN cajero selecciona tipo (BOLETA, FACTURA o NOTA_VENTA) y datos del cliente
THEN se asigna serie y correlativo segun tipo
AND para FACTURA se valida RUC del cliente
AND el ticket queda listo para cobrar
```

#### HU-04-03 · Division de cuenta por comensal

**Prioridad:** Should · **SP:** 5 · **Sprint:** S3 · **Dependencias:** HU-04-02 · **iE_ID:** iE3.1

Como **Cajero**, quiero **dividir una cuenta en partes para cobrar a varios clientes**, para **manejar el caso de "cada quien paga lo suyo"**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN cuenta con varios items
WHEN cajero divide por items o monto
THEN se generan N tickets independientes
AND la suma de los N tickets es igual al total original
AND cada ticket puede tener tipo de documento distinto
```

#### HU-04-04 · Registrar pago en efectivo

**Prioridad:** Must · **SP:** 3 · **Sprint:** S3 · **Dependencias:** HU-04-02 · **iE_ID:** iE3.1

Como **Cajero**, quiero **registrar pago en efectivo con calculo de vuelto**, para **cobrar y entregar correctamente el cambio**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN ticket pendiente de cobro
WHEN cajero ingresa monto recibido (>= total)
THEN se calcula vuelto automaticamente
AND se registra TicketPayment con method=EFECTIVO
AND el ticket pasa a PAID
```

#### HU-04-05 · Registrar pago electronico (Yape, Plin, tarjeta)

**Prioridad:** Must · **SP:** 3 · **Sprint:** S3 · **Dependencias:** HU-04-02 · **iE_ID:** iE3.1

Como **Cajero**, quiero **registrar pago electronico con referencia (numero de operacion)**, para **llevar control de cobros digitales para conciliacion**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN ticket pendiente de cobro
WHEN cajero selecciona metodo (YAPE/PLIN/VISA/MASTERCARD/TRANSFERENCIA) e ingresa referencia
THEN se valida que el monto cubra el total
AND se registra TicketPayment con method y reference
AND el ticket pasa a PAID
```

#### HU-04-06 · Pago mixto

**Prioridad:** Should · **SP:** 3 · **Sprint:** S3 · **Dependencias:** HU-04-04,HU-04-05 · **iE_ID:** iE3.1

Como **Cajero**, quiero **combinar varios metodos en un mismo ticket (efectivo + Yape)**, para **manejar el caso comun de pagos partidos**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN ticket pendiente
WHEN cajero registra varios pagos
THEN cada uno se persiste como TicketPayment separado
AND la suma debe igualar el total
AND el ticket pasa a PAID solo cuando se cubre el total
```

#### HU-04-07 · Anular ticket

**Prioridad:** Should · **SP:** 3 · **Sprint:** S3 · **Dependencias:** HU-04-04 · **iE_ID:** iE3.1

Como **Cajero**, quiero **anular un ticket pagado por error con razon**, para **corregir errores de cobro**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN ticket PAID
WHEN cajero solicita anulacion con razon (obligatoria)
THEN se requiere autorizacion del manager
AND el ticket pasa a VOIDED
AND se reversan los movimientos de inventario asociados
AND se registra en audit log
```

#### HU-04-08 · Cierre Z del dia

**Prioridad:** Must · **SP:** 5 · **Sprint:** S4 · **Dependencias:** HU-04-04,HU-04-05 · **iE_ID:** iE3.1

Como **Cajero**, quiero **generar el cierre Z del turno con totales por metodo de pago**, para **cuadrar caja al final del dia**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN turno abierto con N tickets
WHEN cajero solicita cierre Z
THEN se genera reporte con: total ventas, IGV, propinas, total por metodo, tickets anulados
AND se exporta a PDF
AND queda inmutable en el sistema
```

### E05 — Inventario, Compras y Mermas

_Kardex event-sourced en tiempo real, ordenes de compra, recepcion parcial/total, registro de mermas con razon y alertas de stock bajo._

#### HU-05-01 · Ver stock actual (kardex)

**Prioridad:** Must · **SP:** 3 · **Sprint:** S3 · **Dependencias:** HU-02-01 · **iE_ID:** iE3.1

Como **Gerente**, quiero **ver el stock actual de cada insumo con su valor monetario**, para **conocer cuanto tengo y cuanto vale mi inventario**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN gerente en modulo de inventario
WHEN abre la vista de stock
THEN ve InventorySnapshot por producto (cantidad, costo promedio, valor total)
AND puede filtrar por categoria, almacen o estado
AND items con on_hand_qty < alert_min_stock se destacan en rojo
```

#### HU-05-02 · Registrar entrada manual de stock

**Prioridad:** Must · **SP:** 3 · **Sprint:** S3 · **Dependencias:** HU-05-01 · **iE_ID:** iE3.1

Como **Gerente**, quiero **registrar entrada manual de un insumo (compra al contado, regalo, ajuste)**, para **reflejar entradas no asociadas a OC**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN gerente con permiso
WHEN registra entrada (producto, cantidad, costo unitario, motivo)
THEN se crea InventoryMovement type=PURCHASE o ADJUSTMENT
AND se actualiza InventorySnapshot
AND se recalcula avg_cost (FIFO o promedio)
```

#### HU-05-03 · Registrar salida manual

**Prioridad:** Should · **SP:** 3 · **Sprint:** S3 · **Dependencias:** HU-05-01 · **iE_ID:** iE3.1

Como **Gerente**, quiero **registrar salida manual no asociada a venta (consumo interno, regalo)**, para **reflejar todas las salidas para no descuadrar el kardex**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN gerente con permiso
WHEN registra salida (producto, cantidad, motivo)
THEN se crea InventoryMovement type=ADJUSTMENT
AND se descuenta de InventorySnapshot
AND no se permite si on_hand_qty quedaria negativo
```

#### HU-05-04 · Crear orden de compra

**Prioridad:** Must · **SP:** 5 · **Sprint:** S3 · **Dependencias:** HU-02-05 · **iE_ID:** iE3.1

Como **Gerente**, quiero **crear orden de compra a un proveedor con varios insumos**, para **formalizar compras y dejar trazabilidad**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN gerente con proveedores activos
WHEN crea OC con items (producto, cantidad, precio)
THEN se calcula subtotal, IGV y total
AND queda en estado DRAFT
AND puede editarse antes de enviar
```

#### HU-05-05 · Enviar OC al proveedor

**Prioridad:** Should · **SP:** 3 · **Sprint:** S3 · **Dependencias:** HU-05-04 · **iE_ID:** iE3.1

Como **Gerente**, quiero **enviar la orden de compra al proveedor por email**, para **comunicar formalmente la compra**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN OC en DRAFT
WHEN gerente hace click en "Enviar"
THEN se cambia estado a SENT
AND se envia email al proveedor con PDF adjunto
AND se registra fecha de envio
```

#### HU-05-06 · Recepcionar OC (parcial o total)

**Prioridad:** Must · **SP:** 5 · **Sprint:** S3 · **Dependencias:** HU-05-05 · **iE_ID:** iE3.1

Como **Gerente**, quiero **recepcionar una OC indicando cantidades realmente recibidas**, para **manejar entregas parciales**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN OC en SENT
WHEN gerente recepciona ingresando cantidades por item
THEN se crea InventoryMovement type=PURCHASE por cada item
AND si todas las cantidades = ordered → estado RECEIVED
AND si alguna < ordered → estado PARTIAL
AND se actualiza last_purchase_price
```

#### HU-05-07 · Cancelar OC

**Prioridad:** Could · **SP:** 2 · **Sprint:** S4 · **Dependencias:** HU-05-04 · **iE_ID:** iE3.1

Como **Gerente**, quiero **cancelar una OC enviada que ya no necesito**, para **manejar cambios de plan**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN OC en DRAFT, SENT o PARTIAL
WHEN gerente la cancela con motivo
THEN cambia a CANCELLED
AND ya no se puede recepcionar
AND queda en historico para auditoria
```

#### HU-05-08 · Registrar merma con razon

**Prioridad:** Must · **SP:** 3 · **Sprint:** S3 · **Dependencias:** HU-05-01 · **iE_ID:** iE3.1

Como **Gerente**, quiero **registrar una merma indicando producto, cantidad, motivo y costo**, para **llevar control de perdidas**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN gerente o cocinero con permiso
WHEN registra merma (producto, cantidad, razon: EXPIRED, DAMAGED, PREP_LOSS, THEFT, OTHER)
THEN se crea InventoryMovement type=WASTE
AND se calcula total_loss = quantity * unit_cost
AND se descuenta de InventorySnapshot
```

#### HU-05-09 · Ver historico de mermas

**Prioridad:** Should · **SP:** 3 · **Sprint:** S4 · **Dependencias:** HU-05-08 · **iE_ID:** iE3.1

Como **Gerente**, quiero **ver historico de mermas con filtros y graficos**, para **identificar patrones y reducir desperdicios**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN gerente en modulo de mermas
WHEN abre historico
THEN ve tabla con todas las mermas
AND puede filtrar por fecha, producto, razon, reportador
AND ve grafico de tendencia mensual
AND ve total perdido en S/
```

#### HU-05-10 · Alertas de stock bajo

**Prioridad:** Must · **SP:** 3 · **Sprint:** S4 · **Dependencias:** HU-05-01 · **iE_ID:** iE3.1

Como **Gerente**, quiero **recibir alerta cuando un producto baja del minimo**, para **reaccionar antes del quiebre de stock**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN producto con alert_min_stock definido
WHEN su on_hand_qty cae bajo el umbral
THEN se crea Notification type=STOCK_LOW al gerente
AND la alerta se ve en campana in-app
AND si el gerente tiene email habilitado, recibe correo
```

#### HU-05-11 · Detectar anomalias de mermas con IA

**Prioridad:** Could · **SP:** 5 · **Sprint:** S5 · **Dependencias:** HU-05-08,HU-08-01 · **iE_ID:** iE3.1

Como **Gerente**, quiero **recibir alerta cuando el agente IA detecta merma anomala (ej: pico inusual)**, para **identificar posibles robos o errores sistemicos**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN historico de mermas de >= 30 dias
WHEN el Waste Agent detecta merma con valor > 3 desviaciones del promedio
THEN marca is_anomaly=true
AND notifica al gerente con explicacion
AND propone investigar (ej: "Merma de cebolla 5x mayor al promedio del lunes")
```

### E06 — Costeo Dinamico y Margenes

_Calculo dinamico de costo por plato con BOM recursivo, costos indirectos (CIF) prorrateados, margen unitario real-time, sugerencia de precio por margen objetivo._

#### HU-06-01 · Calculo dinamico de costo por plato

**Prioridad:** Must · **SP:** 8 · **Sprint:** S3 · **Dependencias:** HU-02-07 · **iE_ID:** iE3.1

Como **Gerente**, quiero **ver el costo real de cada plato en tiempo real**, para **saber si gano dinero con cada venta**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN un menu_item con receta asociada
WHEN abro su detalle
THEN veo costo total = suma de (cantidad * costo_actual_insumo) + sub-recetas + waste_factor
AND el costo se actualiza inmediatamente al cambiar precio de cualquier insumo
AND veo desglose por componente
```

#### HU-06-02 · Gestion de costos indirectos (CIF) mensuales

**Prioridad:** Must · **SP:** 5 · **Sprint:** S3 · **Dependencias:** — · **iE_ID:** iE3.1

Como **Gerente**, quiero **registrar mis costos indirectos del mes (luz, gas, sueldos, alquiler)**, para **tener vision real de costos totales, no solo ingredientes**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN gerente en modulo de costeo
WHEN registra costo indirecto (nombre, categoria, monto mensual, base de distribucion)
THEN queda activo y disponible para distribuir
AND categorias: utilities, payroll, rent, marketing, other
```

#### HU-06-03 · Distribucion prorrateada de CIF

**Prioridad:** Must · **SP:** 5 · **Sprint:** S4 · **Dependencias:** HU-06-02 · **iE_ID:** iE3.1

Como **Gerente**, quiero **distribuir mis CIF entre platos segun base elegida (% ventas, horas, fijo)**, para **asignar costos indirectos correctamente a cada plato**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN cierre de mes y CIF activos
WHEN se ejecuta distribucion
THEN se calcula factor (CIF total / total_ventas)
AND cada DishCostHistory recibe su parte indirecta proporcional
AND el cost_period queda con cierre
```

#### HU-06-04 · Calculo de margen unitario por plato

**Prioridad:** Must · **SP:** 3 · **Sprint:** S3 · **Dependencias:** HU-06-01 · **iE_ID:** iE3.1

Como **Gerente**, quiero **ver margen unitario y porcentual de cada plato**, para **identificar platos rentables y los que pierden dinero**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN un menu_item con costo y precio
WHEN consulto su rentabilidad
THEN veo margen = sale_price - total_cost (directo + indirecto)
AND veo margen % = (margen / sale_price) * 100
AND si margen < 25% se destaca con alerta visual
```

#### HU-06-05 · Sugerencia de precio por margen objetivo

**Prioridad:** Should · **SP:** 5 · **Sprint:** S4 · **Dependencias:** HU-06-04,HU-09-01 · **iE_ID:** iE3.1

Como **Gerente**, quiero **recibir sugerencia de precio para alcanzar mi margen objetivo**, para **tomar decisiones de pricing basadas en datos**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN un menu_item
WHEN gerente ingresa margen objetivo (ej: 35%)
THEN el agente Costing calcula precio sugerido
AND muestra impacto: cantidad estimada (forecast) y revenue proyectado
AND alerta si nuevo precio supera +20% (perdida de demanda)
```

#### HU-06-06 · Cierre de periodo mensual

**Prioridad:** Should · **SP:** 3 · **Sprint:** S4 · **Dependencias:** HU-06-03 · **iE_ID:** iE3.1

Como **Gerente**, quiero **cerrar el periodo mensual de costeo**, para **tener cifras finales y poder generar reportes consistentes**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN ultimo dia del mes
WHEN gerente solicita cierre
THEN se calculan totales finales (ventas, costos directos, CIF distribuidos)
AND el cost_period queda CLOSED (no editable)
AND se generan DishCostHistory finales
AND queda disponible para reportes y comparativos
```

#### HU-06-07 · Comparativo Costo Real vs Costo Teorico

**Prioridad:** Could · **SP:** 5 · **Sprint:** S5 · **Dependencias:** HU-06-01,HU-05-01 · **iE_ID:** iE3.1

Como **Gerente**, quiero **comparar costo teorico (BOM) vs costo real (consumo de inventario)**, para **detectar desviaciones operativas**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN ventas del periodo
WHEN comparo Costo Teorico (suma BOM por venta) vs Costo Real (movimientos de inventario)
THEN veo diferencia y % de desviacion
AND identifico productos con mayor desviacion
AND uso eso para investigar mermas no registradas o porciones excesivas
```

### E07 — Reportes, Dashboards y KPIs

_Dashboards configurables por rol, 9 reportes preconfigurados (ventas, food cost, mermas, Pareto, cierre Z) y exportacion PDF/Excel/CSV._

#### HU-07-01 · Dashboard de admin

**Prioridad:** Must · **SP:** 8 · **Sprint:** S4 · **Dependencias:** — · **iE_ID:** iE3.1

Como **Administrador**, quiero **ver dashboard ejecutivo con KPIs financieros y operativos**, para **tener vista completa del negocio en una sola pantalla**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN admin autenticado
WHEN abre su dashboard
THEN ve widgets: ventas hoy/semana/mes, food cost %, margen, top 5 platos, alertas activas
AND puede personalizar layout (drag-and-drop)
AND datos en tiempo real (refresh < 30s)
```

#### HU-07-02 · Dashboard de gerente (operativo)

**Prioridad:** Must · **SP:** 5 · **Sprint:** S4 · **Dependencias:** — · **iE_ID:** iE3.1

Como **Gerente**, quiero **ver dashboard operativo con foco en hoy**, para **tomar decisiones rapidas durante el turno**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN gerente autenticado
WHEN abre dashboard
THEN ve: mesas ocupadas, ordenes en cocina, tiempo promedio de servicio, ventas hoy vs forecast, alertas
AND datos en streaming (WebSocket)
```

#### HU-07-03 · Dashboard de cajero (caja del dia)

**Prioridad:** Must · **SP:** 3 · **Sprint:** S4 · **Dependencias:** — · **iE_ID:** iE3.1

Como **Cajero**, quiero **ver mi dashboard del turno con totales por metodo de pago**, para **cuadrar caja durante el dia y al cierre**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN cajero con turno abierto
WHEN abre su dashboard
THEN ve: total cobrado hoy, desglose por metodo, tickets pendientes, anulaciones
AND el detalle se actualiza tras cada cobro
```

#### HU-07-04 · Reporte de ventas

**Prioridad:** Must · **SP:** 5 · **Sprint:** S4 · **Dependencias:** — · **iE_ID:** iE3.1

Como **Gerente**, quiero **generar reporte de ventas con multiples filtros**, para **analizar performance comercial**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN gerente en modulo de reportes
WHEN selecciona "Ventas" con rango de fechas, mesero, mesa, tipo de doc
THEN se genera reporte con: tickets, items vendidos, totales, comparativo vs periodo anterior
AND se exporta a PDF/Excel/CSV
```

#### HU-07-05 · Reporte de inventario

**Prioridad:** Must · **SP:** 3 · **Sprint:** S4 · **Dependencias:** HU-05-01 · **iE_ID:** iE3.1

Como **Gerente**, quiero **generar reporte de inventario con valoracion**, para **tomar decisiones de compra y auditar stock**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN gerente en reportes
WHEN selecciona "Inventario" con fecha de corte
THEN ve por producto: stock, costo unitario, valor total
AND ve totales por categoria
AND puede exportar a Excel
```

#### HU-07-06 · Reporte de food cost

**Prioridad:** Should · **SP:** 5 · **Sprint:** S5 · **Dependencias:** HU-06-01 · **iE_ID:** iE3.1

Como **Gerente**, quiero **generar reporte de food cost % por plato y categoria**, para **identificar oportunidades de optimizacion**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN gerente en reportes
WHEN selecciona "Food Cost" con periodo
THEN ve por plato: costo, precio, food_cost_%, ranking
AND alerta sobre platos con FC > 35%
AND comparativo con periodos anteriores
```

#### HU-07-07 · Reporte de mermas

**Prioridad:** Should · **SP:** 3 · **Sprint:** S4 · **Dependencias:** HU-05-09 · **iE_ID:** iE3.1

Como **Gerente**, quiero **reporte detallado de mermas con tendencias**, para **reducir perdidas**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN gerente en reportes
WHEN selecciona "Mermas" con rango y filtros
THEN ve: total mermas en S/, top 10 productos, distribucion por razon, tendencia mensual
AND identifica anomalias detectadas por IA
```

#### HU-07-08 · Analisis Pareto de platos

**Prioridad:** Should · **SP:** 5 · **Sprint:** S5 · **Dependencias:** — · **iE_ID:** iE3.1

Como **Gerente**, quiero **ver el 80/20 de mis platos (cuales generan el 80% del revenue)**, para **enfocar esfuerzos en lo que genera valor**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN ventas del periodo
WHEN abro analisis Pareto
THEN veo grafico con platos ordenados de mayor a menor revenue
AND linea acumulada del 80%
AND identifico Stars, Plowhorses, Puzzles, Dogs (Menu Engineering)
```

#### HU-07-09 · Cierre Z (cierre del dia)

**Prioridad:** Must · **SP:** 3 · **Sprint:** S4 · **Dependencias:** HU-04-08 · **iE_ID:** iE3.1

Como **Cajero**, quiero **generar cierre Z del dia con totales operativos**, para **cumplir con regulaciones y auditoria**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN fin de turno operativo
WHEN cajero solicita cierre Z
THEN se genera reporte con: ventas totales, IGV, propinas, anulaciones, totales por metodo de pago
AND se exporta a PDF
AND queda inmutable
```

#### HU-07-10 · Exportacion PDF/Excel/CSV

**Prioridad:** Should · **SP:** 5 · **Sprint:** S5 · **Dependencias:** HU-07-04 · **iE_ID:** iE3.1

Como **Gerente**, quiero **exportar cualquier reporte en formato PDF, Excel o CSV**, para **compartir con contador, asesor o jurado**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN un reporte generado
WHEN gerente hace click en "Exportar"
THEN puede elegir formato (PDF, Excel, CSV)
AND el archivo se genera asincronamente para reportes grandes
AND se notifica cuando esta listo y se descarga desde R2
```

### E08 — Motor de Forecasting con IA

_Pipeline TimesFM 2.5 + XReg con covariates peruanos (16 feriados, clima, eventos). Forecast zero/few-shot con quantiles q10/q50/q90 y comparacion vs baseline._

#### HU-08-01 · Configurar parametros de forecasting

**Prioridad:** Must · **SP:** 5 · **Sprint:** S4 · **Dependencias:** — · **iE_ID:** iE4.1

Como **Gerente**, quiero **configurar el horizonte y covariates del forecasting**, para **adaptar el modelo a mi realidad operativa**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN gerente en modulo IA
WHEN configura horizonte (7, 14, 28 dias) y covariates (clima, feriados, eventos)
THEN se persisten parametros
AND el siguiente run usa esa configuracion
AND existe configuracion default razonable
```

#### HU-08-02 · Ejecutar forecast manual

**Prioridad:** Must · **SP:** 5 · **Sprint:** S4 · **Dependencias:** HU-08-01 · **iE_ID:** iE4.1

Como **Gerente**, quiero **ejecutar un forecast on-demand desde la UI**, para **probar el sistema o regenerar despues de cambios**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN gerente con configuracion lista
WHEN hace click en "Generar pronostico"
THEN se encola job en BullMQ → AI Service
AND ForecastRun queda en RUNNING
AND el frontend muestra progreso
AND al terminar se notifica y se actualizan resultados
```

#### HU-08-03 · Ejecutar forecast automatico semanal

**Prioridad:** Must · **SP:** 3 · **Sprint:** S4 · **Dependencias:** HU-08-02 · **iE_ID:** iE4.1

Como **Sistema**, quiero **ejecutar forecast automatico cada lunes**, para **mantener pronosticos siempre vigentes sin intervencion manual**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN cron job configurado
WHEN llega lunes a las 03:00 AM
THEN se ejecuta forecast por cada tenant activo
AND se guarda en historico
AND si falla, se reintenta hasta 3 veces con backoff
AND se notifica al gerente cuando esta listo
```

#### HU-08-04 · Ver predicciones por plato

**Prioridad:** Must · **SP:** 5 · **Sprint:** S4 · **Dependencias:** HU-08-02 · **iE_ID:** iE4.1

Como **Gerente**, quiero **ver predicciones de venta diaria por plato con quantiles**, para **planificar produccion sin sobrestock ni quiebres**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN forecast COMPLETED
WHEN gerente abre "Pronosticos"
THEN ve por plato y dia: q10 (pesimista), q50 (mediana), q90 (optimista)
AND ve grafico de barras
AND puede filtrar por categoria, fecha o plato
```

#### HU-08-05 · Comparar prediccion vs realidad

**Prioridad:** Should · **SP:** 5 · **Sprint:** S5 · **Dependencias:** HU-08-04 · **iE_ID:** iE4.1

Como **Gerente**, quiero **comparar lo predicho con lo realmente vendido**, para **validar la calidad del modelo y ganar confianza**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN forecast pasado y ventas reales
WHEN gerente abre "Validacion"
THEN ve por plato y dia: predicho vs real, error %, MAPE acumulado
AND ve grafico overlay
AND ve si el real cae dentro del intervalo q10-q90
```

#### HU-08-06 · Sugerencias de compra basadas en forecast

**Prioridad:** Should · **SP:** 8 · **Sprint:** S5 · **Dependencias:** HU-08-04,HU-05-01 · **iE_ID:** iE4.1

Como **Gerente**, quiero **recibir sugerencias automaticas de compra basadas en demanda predicha**, para **optimizar compras y bajar mermas de perecibles**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN forecast vigente y stock actual
WHEN el Purchasing Agent ejecuta planificacion
THEN propone OC sugeridas considerando: demanda futura + stock actual + lead time del proveedor
AND el gerente aprueba o ajusta antes de enviar (HITL obligatorio)
AND si aprueba se crea PurchaseOrder en DRAFT
```

#### HU-08-07 · Variables exogenas peruanas

**Prioridad:** Must · **SP:** 5 · **Sprint:** S4 · **Dependencias:** HU-08-02 · **iE_ID:** iE4.1

Como **Sistema**, quiero **incluir feriados peruanos, clima Lima y eventos especiales como covariates**, para **mejorar precision del forecasting con contexto local**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN forecast en ejecucion
WHEN se construyen covariates
THEN se incluyen: 16 feriados peruanos, lluvia/temperatura Lima (Open-Meteo), eventos (Fiestas Patrias, partidos selección)
AND el modelo aprende patrones locales
AND el MAPE mejora vs version sin covariates
```

#### HU-08-08 · Evaluacion del modelo (MAPE, sMAPE)

**Prioridad:** Must · **SP:** 5 · **Sprint:** S5 · **Dependencias:** HU-08-05 · **iE_ID:** iE4.1

Como **Sistema**, quiero **evaluar precision del forecasting comparando vs baseline**, para **demostrar valor cuantitativo del modelo (criterio de tesis)**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN forecast COMPLETED y holdout (datos reales reservados)
WHEN se ejecuta evaluacion
THEN se calcula MAPE, sMAPE, MAE
AND se compara contra baseline (promedio movil simple)
AND el sMAPE de TimesFM debe ser < baseline (criterio de exito)
```

### E09 — Chat Analitico con IA (Text-to-SQL)

_Conversacion en lenguaje natural sobre datos del restaurante. SQL generado con citaciones. Defense-in-depth de 9 capas. Streaming SSE en tiempo real._

#### HU-09-01 · Conversacion con IA en lenguaje natural

**Prioridad:** Must · **SP:** 13 · **Sprint:** S5 · **Dependencias:** — · **iE_ID:** iE4.2

Como **Gerente**, quiero **hacer preguntas en español sobre mis datos y recibir respuesta**, para **obtener insights sin saber SQL ni esperar al asesor**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN gerente en chat IA
WHEN escribe pregunta (ej: "Cual fue mi plato mas vendido el sabado pasado?")
THEN el sistema clasifica intent (Supervisor) y delega al Analytical Agent
AND el agente recupera schema relevante (LlamaIndex)
AND genera SQL
AND valida con defense-in-depth (9 capas)
AND ejecuta query con RLS
AND devuelve respuesta en lenguaje natural con datos
AND latencia total < 5s para queries simples
```

#### HU-09-02 · Visualizar SQL generado y citaciones

**Prioridad:** Should · **SP:** 3 · **Sprint:** S5 · **Dependencias:** HU-09-01 · **iE_ID:** iE4.2

Como **Gerente**, quiero **ver el SQL que el agente genero y las tablas que uso**, para **verificar que la respuesta sea correcta**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN respuesta del chat
WHEN gerente expande "Ver detalles"
THEN ve el SQL ejecutado (formateado)
AND ve las tablas/columnas usadas (citaciones)
AND ve tiempo de ejecucion
AND puede copiar el SQL
```

#### HU-09-03 · Historial de conversaciones

**Prioridad:** Should · **SP:** 3 · **Sprint:** S5 · **Dependencias:** HU-09-01 · **iE_ID:** iE4.2

Como **Gerente**, quiero **ver historial de mis conversaciones con la IA**, para **retomar consultas pasadas**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN gerente con historial
WHEN abre lista de conversaciones
THEN ve titulo, fecha, ultima actividad
AND puede continuar una conversacion antigua
AND puede archivar o borrar conversaciones
```

#### HU-09-04 · Feedback de respuestas

**Prioridad:** Could · **SP:** 2 · **Sprint:** S5 · **Dependencias:** HU-09-01 · **iE_ID:** iE4.2

Como **Gerente**, quiero **calificar las respuestas de la IA con thumbs up/down**, para **mejorar la calidad del agente con mi retroalimentacion**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN una respuesta del agente
WHEN gerente da thumbs up o down
THEN se persiste feedback_rating
AND si es positivo se agrega como few-shot example
AND si es negativo se marca para revision en LangSmith
```

#### HU-09-05 · Streaming de respuestas en tiempo real

**Prioridad:** Should · **SP:** 5 · **Sprint:** S5 · **Dependencias:** HU-09-01 · **iE_ID:** iE4.2

Como **Gerente**, quiero **ver la respuesta del agente generandose en tiempo real (token por token)**, para **sentir respuesta inmediata como ChatGPT**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN gerente envia pregunta
WHEN el agente comienza a responder
THEN los tokens aparecen en streaming SSE
AND el indicador de "escribiendo..." se ve mientras se genera
AND si hay error en mitad del stream se muestra mensaje claro
```

#### HU-09-06 · Defense-in-depth de SQL

**Prioridad:** Must · **SP:** 13 · **Sprint:** S5 · **Dependencias:** HU-09-01 · **iE_ID:** iE4.2

Como **Sistema**, quiero **validar todo SQL generado con 9 capas de defensa antes de ejecutar**, para **proteger los datos del tenant**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN SQL generado por el LLM
WHEN entra al SQL Validator
THEN se aplica: parsing AST (pglast), allowlist solo SELECT, check tenant_id obligatorio, limite de filas, timeout, RLS, sanitizacion, audit
AND si falla cualquier capa se rechaza
AND la respuesta dice claramente la razon
AND se registra en audit log
```

#### HU-09-07 · Sugerencias contextuales

**Prioridad:** Could · **SP:** 3 · **Sprint:** S5 · **Dependencias:** HU-09-01 · **iE_ID:** iE4.2

Como **Gerente**, quiero **recibir sugerencias de preguntas relevantes**, para **descubrir capacidades del sistema**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN gerente abre chat
WHEN no ha escrito nada
THEN ve 4-6 sugerencias relevantes a su rol y contexto
AND ej: "Top 5 platos del mes", "Comparar este mes vs anterior", "Mermas en la ultima semana"
AND al hacer click se envia automaticamente
```

### E10 — Notificaciones y Alertas

_Notificaciones in-app, email y push. Preferencias por usuario y canal. Alertas accionables de stock, anomalias y reportes listos._

#### HU-10-01 · Notificacion in-app

**Prioridad:** Must · **SP:** 3 · **Sprint:** S4 · **Dependencias:** — · **iE_ID:** iE3.1

Como **Usuario**, quiero **ver notificaciones in-app con badge en la campana**, para **no perderme alertas importantes**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN usuario autenticado
WHEN se crea Notification dirigida a el
THEN aparece badge con contador en campana
AND al click ve lista de notificaciones (no leidas + leidas)
AND puede marcar como leida individualmente o todas
AND cada notificacion tiene action button (deep-link)
```

#### HU-10-02 · Notificacion por email

**Prioridad:** Should · **SP:** 3 · **Sprint:** S4 · **Dependencias:** HU-10-01 · **iE_ID:** iE3.1

Como **Usuario**, quiero **recibir email de notificaciones criticas**, para **enterarme aun cuando no estoy en la plataforma**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN notificacion con channel=EMAIL en payload
WHEN se envia a Resend
THEN se entrega email con titulo, body y action button
AND si el usuario no abrio en in-app se reenvia despues de 1 hora
```

#### HU-10-03 · Preferencias de notificacion

**Prioridad:** Should · **SP:** 3 · **Sprint:** S4 · **Dependencias:** HU-10-01 · **iE_ID:** iE3.1

Como **Usuario**, quiero **configurar que tipos de notificaciones quiero recibir y por que canal**, para **evitar spam y recibir solo lo importante**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN usuario en preferencias
WHEN configura tipo (STOCK_LOW, ANOMALY_DETECTED, etc.) x canal (IN_APP/EMAIL/PUSH)
THEN se persiste NotificationPreference
AND el sistema respeta esa configuracion
AND existe configuracion default por rol
```

#### HU-10-04 · Alertas accionables de IA

**Prioridad:** Should · **SP:** 3 · **Sprint:** S5 · **Dependencias:** HU-08-06,HU-05-11 · **iE_ID:** iE3.1

Como **Gerente**, quiero **recibir alertas de la IA con sugerencia de accion**, para **convertir insights en accion**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN agente IA detecta anomalia o oportunidad
WHEN crea Notification
THEN incluye titulo claro + explicacion + action button
AND ej: "Plato X con margen <20%" → button "Ver detalle"
AND ej: "Compra sugerida" → button "Aprobar OC"
```

### E11 — Migracion desde ERPs Legacy

_Wizard guiado de migracion idempotente desde TumiSoft/Odoo/CSV/Excel. Importacion masiva con validacion y preservacion de archivos originales._

#### HU-11-01 · Wizard de migracion guiado

**Prioridad:** Should · **SP:** 8 · **Sprint:** S1 · **Dependencias:** HU-01-10 · **iE_ID:** iE3.1

Como **Administrador**, quiero **tener un wizard paso a paso para migrar desde mi ERP actual**, para **onboarding rapido sin asistencia tecnica**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN admin recien registrado
WHEN abre wizard de migracion
THEN ve pasos: 1) Tipo de fuente (TumiSoft/Odoo/CSV), 2) Subir archivos, 3) Mapear columnas, 4) Validar, 5) Importar
AND puede pausar y retomar
AND el archivo original queda en R2 para auditoria
```

#### HU-11-02 · Importar productos desde Excel/CSV

**Prioridad:** Should · **SP:** 5 · **Sprint:** S1 · **Dependencias:** HU-11-01,HU-02-02 · **iE_ID:** iE3.1

Como **Administrador**, quiero **importar mi catalogo de productos en formato libre**, para **no registrar uno por uno**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN archivo de productos
WHEN admin lo sube en wizard
THEN sistema sugiere mapeo automatico de columnas
AND admin puede ajustar
AND se valida cada fila
AND se importan los validos
AND se muestra reporte detallado de errores
```

#### HU-11-03 · Importar historico de ventas

**Prioridad:** Should · **SP:** 8 · **Sprint:** S2 · **Dependencias:** HU-11-01 · **iE_ID:** iE3.1

Como **Administrador**, quiero **importar ventas historicas para alimentar la IA**, para **tener forecast desde el dia 1 (cold-start)**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN archivo de ventas con fecha, plato, cantidad, monto
WHEN admin lo sube
THEN se mapean ventas a SalesDailyAggregate
AND si supera 6 meses se habilita forecasting con few-shot
AND si supera 12 meses se habilita forecasting con buena calidad
```

#### HU-11-04 · Idempotencia de la importacion

**Prioridad:** Must · **SP:** 3 · **Sprint:** S2 · **Dependencias:** HU-11-02 · **iE_ID:** iE3.1

Como **Administrador**, quiero **re-ejecutar la importacion sin duplicar datos**, para **corregir errores y volver a intentar sin riesgo**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN una importacion previa
WHEN se re-ejecuta el mismo archivo
THEN se detectan duplicados por key (SKU + tenant)
AND se actualizan en lugar de crear duplicados
AND se reporta cuantos creados vs actualizados
```

#### HU-11-05 · Validar e identificar errores antes de importar

**Prioridad:** Should · **SP:** 5 · **Sprint:** S2 · **Dependencias:** HU-11-02 · **iE_ID:** iE3.1

Como **Administrador**, quiero **ver pre-validacion completa antes de confirmar la importacion**, para **evitar importar data corrupta**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN archivo subido
WHEN admin hace click en "Validar"
THEN se ejecutan validaciones (formato, FKs, duplicados, valores requeridos)
AND se muestra resumen: N validas, N con error, lista de errores con linea
AND admin decide si importar parcialmente o cancelar
```

### E12 — Plataforma, DevOps y Observabilidad

_CI/CD automatizado, health checks, logs estructurados, traces OpenTelemetry, metricas por tenant, backups y disaster recovery._

#### HU-12-01 · Despliegue automatizado CI/CD

**Prioridad:** Must · **SP:** 8 · **Sprint:** S0 · **Dependencias:** — · **iE_ID:** iE3.3

Como **DevOps**, quiero **tener pipeline CI/CD que despliegue automaticamente al hacer merge a main**, para **iterar rapido sin tareas manuales**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN PR aprobado y merged a main
WHEN se dispara pipeline GitHub Actions
THEN se ejecutan tests, lint, type-check
AND si todo pasa, se despliega a staging automaticamente
AND se ejecutan smoke tests post-deploy
AND si fallan se hace rollback automatico
```

#### HU-12-02 · Health checks

**Prioridad:** Must · **SP:** 2 · **Sprint:** S0 · **Dependencias:** — · **iE_ID:** iE3.3

Como **DevOps**, quiero **health checks expuestos en /health para monitoreo**, para **detectar caidas antes que los usuarios**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN cualquier servicio (backend, AI service)
WHEN se llama a GET /health
THEN responde 200 con detalles: db_ok, redis_ok, anthropic_api_ok, version, uptime
AND si algun componente falla, devuelve 503 con detalle
```

#### HU-12-03 · Logs estructurados con correlacion

**Prioridad:** Must · **SP:** 3 · **Sprint:** S0 · **Dependencias:** — · **iE_ID:** iE3.3

Como **DevOps**, quiero **logs estructurados (JSON) con correlation_id por request**, para **debuggear problemas en produccion**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN cualquier request entrante
WHEN se procesa
THEN logs incluyen correlation_id, tenant_id, user_id, level, timestamp, mensaje, contexto
AND el correlation_id se propaga a todas las dependencias (BD, AI service, Redis)
AND se envian a Sentry/Logtail centralizado
```

#### HU-12-04 · Metricas y traces (OpenTelemetry)

**Prioridad:** Should · **SP:** 5 · **Sprint:** S0 · **Dependencias:** — · **iE_ID:** iE3.3

Como **DevOps**, quiero **metricas de latencia, throughput y errores por endpoint**, para **detectar degradaciones tempranamente**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN trafico en produccion
WHEN cualquier endpoint procesa request
THEN se emiten metricas: p50, p95, p99 latencia, requests/s, error rate
AND los traces de queries SQL y llamadas a IA se ven en LangSmith/Sentry
AND alertas cuando p99 > 2s sostenido
```

#### HU-12-05 · Backup automatico

**Prioridad:** Must · **SP:** 3 · **Sprint:** S0 · **Dependencias:** — · **iE_ID:** iE3.3

Como **DevOps**, quiero **backup diario automatico de PostgreSQL**, para **garantizar recuperacion ante desastre**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN cron job diario
WHEN llega 02:00 AM
THEN se hace pg_dump completo
AND se sube a R2 con retencion 30 dias
AND se prueba restore semanalmente en ambiente de staging
AND el RTO < 4h, RPO < 24h
```

#### HU-12-06 · Aislamiento multi-tenant verificado (RLS)

**Prioridad:** Must · **SP:** 5 · **Sprint:** S0 · **Dependencias:** HU-01-01 · **iE_ID:** iE3.2

Como **DevOps**, quiero **test suite que verifica aislamiento RLS**, para **garantizar que ningun tenant ve datos de otro**.

**Criterios de aceptación (Gherkin):**

```gherkin
GIVEN suite de tests RLS
WHEN se ejecuta en CI
THEN cada test crea 2 tenants y verifica que tenant A no ve datos de tenant B en NINGUNA tabla
AND prueba para los 5 roles
AND el resultado debe ser 0 fugas
AND si falla, el deploy se bloquea
```
