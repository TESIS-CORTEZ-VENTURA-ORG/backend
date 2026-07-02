import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../platform/prisma/prisma.service';
import { FORECAST_QUEUE } from '../platform/queue/redis-connection';
import {
  type AppRole,
  type BacktestMetrics,
  type CoreAiForecastResponse,
  type ForecastAccuracyResponse,
  type ForecastContextStatus,
  type ForecastDriver,
  type ForecastInsightsResponse,
  type ForecastPoint,
  type ForecastRunStatus,
  type RunForecastInput,
  type ShoppingSuggestionsResponse,
} from '../shared';
import { type CoreAiLocation, CoreAiClient } from './core-ai.client';
import {
  compareForecastVsActual,
  type ForecastPointLike,
  type ForecastValidation,
} from './forecast-validation.util';
import {
  mostRelevantDriver,
  planShortfallNotifications,
} from './forecast-shortfall.util';
import {
  zeroFillDailySeries,
  type AggregatedSeries,
  type DailyTotal,
} from './sales-aggregation.util';

// core-ai exige al menos 2 puntos para inferir; con menos no hay serie útil.
const MIN_POINTS_TO_FORECAST = 2;

// Errores transitorios de infra (core-ai caído/lento) → vale reintentar el job.
// El 422 (histórico insuficiente) es terminal: no se reintenta.
const TRANSIENT_STATUSES = new Set([502, 503, 504]);

// HU-08-07 (fase 2) · Toda corrida de negocio pide contexto exógeno (calendario
// peruano + clima) a core-ai; el motor SIEMPRE se pide "auto" — core-ai decide
// si "ml" aplica según la historia disponible (nunca se hardcodea "ml" acá, ver
// `team-core-ai/README.md` §HU-08-07). No es configurable por el cliente: es una
// decisión de negocio, no una preferencia del request.
const USE_CONTEXT = true;
const DEFAULT_ENGINE = 'auto';

// E10×E08 (notificaciones proactivas) · Hasta esta cantidad de insumos en
// shortfall se notifica UNO POR UNO (mismo estilo que `low_stock`); más allá se
// agrupa en una sola notificación para no floodear la campana (ver
// `forecast-shortfall.util.planShortfallNotifications`).
const SHORTFALL_INDIVIDUAL_LIMIT = 3;

// Solo owner/manager gestionan compras — staff no recibe `forecast_shortfall`
// (igual matriz de permisos que `manage Report`, ver `CaslAbilityFactory`).
const SHORTFALL_RECIPIENT_ROLES: AppRole[] = ['owner', 'manager'];

// HU-08-08 · Umbral mínimo de días ya transcurridos para que las métricas de
// `accuracy` sean representativas (una muestra de 1-2 días puede dar un SMAPE
// engañoso). Por debajo, la respuesta sigue siendo 200 con `needsMoreData: true`.
const MIN_ACCURACY_POINTS = 3;

/** Respuesta del seam de demanda: la serie + metadatos de calidad. Lo que `points`
 *  contiene es exactamente el `history` que consume `core-ai` (`frequency:"D"`). */
export interface DemandSeriesResponse {
  scope: 'total' | 'menuItem';
  seriesId: string;
  label: string;
  frequency: 'D';
  observations: number;
  spanDays: number;
  dataQuality: AggregatedSeries['dataQuality'];
  points: AggregatedSeries['points'];
}

// Fila cruda del GROUP BY: ya un total por día local (no toda la tabla de ventas).
type DailyRow = { ds: string; y: number };

type Tx = Prisma.TransactionClient;

/** Resultado del cómputo (serie de origen + salida de core-ai), antes de persistir. */
export interface ComputedForecast {
  series: Omit<DemandSeriesResponse, 'points'>;
  forecast: CoreAiForecastResponse;
}

/** Datos del job de la cola BullMQ. */
export interface ForecastJobData {
  runId: string;
  tenantId: string;
  input: RunForecastInput;
}

/** Validación de un pronóstico contra el real (HU-08-05). */
export interface ForecastValidationView {
  runId: string;
  scope: string;
  menuItemId: string | null;
  model: string | null;
  completedAt: string | null;
  rows: ForecastValidation['rows'];
  summary: ForecastValidation['summary'];
}

/**
 * E09×E08 (chat futuro, LOTE B3) · Respuesta de {@link ForecastingService.getForecastForRange}.
 * Usada por `ChatModule` (import directo del servicio — mismo patrón que
 * `ForecastingModule → NotificationsModule`, ver `forecasting.module.ts`) para
 * responder preguntas sobre el futuro SIN generar SQL: en `sales_history`
 * jamás hay filas para una fecha futura, así que ese camino no tiene sentido
 * para esta intención (a diferencia de `historical`, que sí pasa por nl2sql).
 */
export interface ForecastRangeAnswer {
  /** `true` cuando el tenant todavía no tiene ninguna corrida `completed` (scope=total). */
  needsForecast: boolean;
  /** Corrida usada; `null` solo si `needsForecast`. */
  runId: string | null;
  /** `true` cuando SÍ hay una corrida, pero el rango pedido no se solapa con su horizonte. */
  outOfHorizon: boolean;
  /** Último día pronosticado por la corrida (para sugerirle al usuario un rango dentro del horizonte). `null` si `needsForecast`. */
  horizonEnd: string | null;
  /** `completedAt` de la corrida usada, ISO. `null` si `needsForecast`. */
  generatedAt: string | null;
  /** Puntos de la corrida que caen dentro de `[from,to]`, ordenados por fecha. */
  points: ForecastPoint[];
  /** Suma de `yhat` de `points`; `null` si no hay puntos en rango. */
  totalYhat: number | null;
  /** Suma de `yhat_lo` de `points`; `null` si no hay puntos en rango. */
  totalLo: number | null;
  /** Suma de `yhat_hi` de `points`; `null` si no hay puntos en rango. */
  totalHi: number | null;
  /** Drivers de la corrida que caen dentro de `[from,to]`, ordenados por fecha. */
  drivers: ForecastDriver[];
}

/** Vista de una corrida persistida (lo que devuelven run/poll/predictions). */
export interface ForecastRunView {
  id: string;
  scope: string;
  menuItemId: string | null;
  horizon: number;
  engine: string | null;
  status: ForecastRunStatus;
  model: string | null;
  baseline: string | null;
  observations: number | null;
  spanDays: number | null;
  dataQuality: string | null;
  points: ForecastPoint[] | null;
  backtest: BacktestMetrics | null;
  // HU-08-07 (fase 2) · [] / null en corridas previas a la migración (lectura
  // hacia atrás compatible) o cuando el contexto no aportó factores en el horizonte.
  drivers: ForecastDriver[];
  contextStatus: ForecastContextStatus | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

@Injectable()
export class ForecastingService {
  private readonly logger = new Logger(ForecastingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly coreAi: CoreAiClient,
    private readonly notifications: NotificationsService,
    @InjectQueue(FORECAST_QUEUE) private readonly queue: Queue<ForecastJobData>,
  ) {}

  /**
   * HU-08-02 · Encola un forecast (async). Crea la corrida en estado `running`,
   * encola el job en BullMQ y devuelve la vista de la corrida. El worker la
   * procesará (ver `processRun`). `tenant_id` SIEMPRE del JWT.
   */
  async enqueueForecast(
    tenantId: string,
    input: RunForecastInput,
  ): Promise<ForecastRunView> {
    const run = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.forecastRun.create({
        data: {
          tenantId,
          scope: input.scope,
          menuItemId: input.scope === 'menuItem' ? input.menuItemId : null,
          horizon: input.horizon,
          engine: input.engine ?? null,
          status: 'running',
        },
      }),
    );

    await this.queue.add(
      'forecast',
      { runId: run.id, tenantId, input },
      {
        jobId: run.id,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: 500,
      },
    );

    return this.toView(run);
  }

  /**
   * Procesa una corrida encolada (lo ejecuta el worker). Computa el pronóstico y
   * persiste el resultado (`completed`) o el error (`failed`). No relanza: el fallo
   * queda visible en la corrida (el cliente la consulta por polling).
   */
  async processRun(
    runId: string,
    tenantId: string,
    input: RunForecastInput,
  ): Promise<void> {
    try {
      const result = await this.computeForecast(tenantId, input);
      await this.prisma.runInTenant(tenantId, (tx) =>
        tx.forecastRun.update({
          where: { id: runId },
          data: {
            status: 'completed',
            model: result.forecast.model,
            baseline: result.forecast.baseline,
            observations: result.series.observations,
            spanDays: result.series.spanDays,
            dataQuality: result.series.dataQuality,
            points: result.forecast.points as unknown as Prisma.InputJsonValue,
            backtest:
              (result.forecast.backtest as unknown as Prisma.InputJsonValue) ??
              Prisma.DbNull,
            // HU-08-07 (fase 2) · drivers/contextStatus tal cual los devolvió
            // core-ai (siempre presentes: `use_context` va SIEMPRE true en
            // corridas de negocio — ver `computeForecast`).
            drivers: result.forecast
              .drivers as unknown as Prisma.InputJsonValue,
            contextStatus: result.forecast.context_status,
            completedAt: new Date(),
          },
        }),
      );

      // E10×E08 (notificaciones proactivas) · Solo las corridas `scope=total`
      // alimentan `shoppingSuggestions` (BOM del menú completo); una corrida
      // `menuItem` no cambia esa sugerencia, así que no dispara el chequeo.
      // No debe tumbar la corrida ya completada si falla — ver `notifyShortfalls`.
      if (input.scope === 'total') {
        await this.notifyShortfalls(tenantId, input.horizon);
      }
    } catch (err) {
      await this.prisma.runInTenant(tenantId, (tx) =>
        tx.forecastRun.update({
          where: { id: runId },
          data: {
            status: 'failed',
            error: err instanceof Error ? err.message : 'Error desconocido',
            completedAt: new Date(),
          },
        }),
      );
      // Transitorio (infra) → relanzar para que BullMQ reintente (attempts+backoff).
      // Terminal (negocio, p. ej. 422) → no relanzar: el job termina, sin loop.
      if (this.isTransient(err)) throw err;
    }
  }

  private isTransient(err: unknown): boolean {
    return (
      err instanceof HttpException && TRANSIENT_STATUSES.has(err.getStatus())
    );
  }

  /** HU-08-02 · Consulta una corrida por id (polling de estado/resultado). */
  async getRun(tenantId: string, runId: string): Promise<ForecastRunView> {
    const run = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.forecastRun.findUnique({ where: { id: runId } }),
    );
    if (!run)
      throw new NotFoundException('Corrida de forecasting no encontrada');
    return this.toView(run);
  }

  /**
   * HU-08-04 · Últimas predicciones por ámbito: la corrida `completed` más reciente
   * para ese `scope`/`menuItemId`. 404 si todavía no hay ninguna completada.
   */
  async getLatestPredictions(
    tenantId: string,
    scope: 'total' | 'menuItem',
    menuItemId: string | undefined,
  ): Promise<ForecastRunView> {
    const run = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.forecastRun.findFirst({
        where: {
          scope,
          menuItemId: scope === 'menuItem' ? menuItemId : null,
          status: 'completed',
        },
        orderBy: { completedAt: 'desc' },
      }),
    );
    if (!run) {
      throw new NotFoundException(
        'Aún no hay un pronóstico completado para ese ámbito',
      );
    }
    return this.toView(run);
  }

  /**
   * HU-08-05 · Valida el último pronóstico completado contra la demanda real:
   * por día, predicho vs real, error % (APE) y si el real cayó en el intervalo
   * q10–q90; en el resumen, MAPE acumulado y cobertura del intervalo. Solo se
   * comparan los días ya transcurridos (target_date <= último día con ventas);
   * los futuros quedan `pending`. `runInTenant` (RLS FORCE).
   */
  async validateLatest(
    tenantId: string,
    scope: 'total' | 'menuItem',
    menuItemId: string | undefined,
  ): Promise<ForecastValidationView> {
    const menuId = scope === 'menuItem' ? (menuItemId as string) : null;

    return this.prisma.runInTenant(tenantId, async (tx) => {
      const run = await tx.forecastRun.findFirst({
        where: { scope, menuItemId: menuId, status: 'completed' },
        orderBy: { completedAt: 'desc' },
      });
      if (!run) {
        throw new NotFoundException(
          'Aún no hay un pronóstico completado para ese ámbito',
        );
      }

      const points = (run.points as unknown as ForecastPoint[] | null) ?? [];
      const dates = points.map((p) => p.target_date).sort();
      const actualByDay: Record<string, number> = {};

      if (dates.length > 0) {
        const from = new Date(`${dates[0]}T00:00:00-05:00`);
        const to = new Date(`${dates[dates.length - 1]}T23:59:59-05:00`);
        const [daily, maxDay] = await Promise.all([
          this.dailyTotals(tx, menuId, from, to),
          this.maxActualDay(tx, menuId),
        ]);
        const totalsByDay = new Map(daily.map((d) => [d.ds, d.y]));
        for (const p of points) {
          // Día transcurrido (hay datos hasta esa fecha) → comparar (0 si sin venta).
          if (maxDay && p.target_date <= maxDay) {
            actualByDay[p.target_date] = totalsByDay.get(p.target_date) ?? 0;
          }
        }
      }

      const validation = compareForecastVsActual(points, actualByDay);
      return {
        runId: run.id,
        scope: run.scope,
        menuItemId: run.menuItemId,
        model: run.model,
        completedAt: run.completedAt ? run.completedAt.toISOString() : null,
        rows: validation.rows,
        summary: validation.summary,
      };
    });
  }

  /**
   * HU-08-06 · Sugerencias de compra basadas en el último pronóstico completado
   * (scope='total'). Flujo:
   *   1. Encuentra la corrida completada más reciente del tenant.
   *   2. Suma `yhat` de hoy hacia adelante hasta `horizon` días (zona Lima).
   *   3. Calcula la participación de cada plato en las ventas de los últimos 30 días.
   *   4. Explota el BOM (2 niveles) de cada plato activo con receta.
   *   5. Compara el consumo proyectado de cada insumo contra el stock actual.
   *   6. Devuelve solo los insumos con shortfall > 0, ordenados de mayor a menor.
   *
   * Invariantes: `tenant_id` SIEMPRE del JWT; RLS FORCE en la tx; sin BOM nivel 3.
   * Si no existe corrida completada → `needsForecast: true`, lista vacía.
   */
  async shoppingSuggestions(
    tenantId: string,
    horizon: number,
  ): Promise<ShoppingSuggestionsResponse> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      // Step 1: latest completed total-scope forecast run.
      const run = await tx.forecastRun.findFirst({
        where: { status: 'completed', scope: 'total' },
        orderBy: { completedAt: 'desc' },
      });

      if (!run) {
        return {
          horizon,
          source: 'forecast',
          runId: null,
          needsForecast: true,
          suggestions: [],
          drivers: [],
          contextStatus: null,
        };
      }

      // HU-08-07 (fase 2): estado del contexto de la corrida usada — viaja tal
      // cual en toda respuesta que sí encontró una corrida (aunque termine sin
      // sugerencias), para que el frontend siempre pueda mostrarlo.
      const contextStatus = run.contextStatus as ForecastContextStatus | null;

      // Step 2: sum yhat from today (Lima) forward for up to `horizon` days.
      const today = this.todayLima();
      const points = (run.points as unknown as ForecastPoint[] | null) ?? [];
      const futurePoints = points
        .filter((p) => p.target_date >= today)
        .slice(0, horizon);

      // Drivers dentro de la misma ventana de días que `futurePoints` (no todo
      // el horizonte original de la corrida, que puede estar parcialmente en
      // el pasado si la corrida es de hace unos días).
      const windowEnd = futurePoints.at(-1)?.target_date;
      const allDrivers =
        (run.drivers as unknown as ForecastDriver[] | null) ?? [];
      const drivers = windowEnd
        ? allDrivers
            .filter((d) => d.date >= today && d.date <= windowEnd)
            .sort((a, b) => a.date.localeCompare(b.date))
        : [];

      if (futurePoints.length === 0) {
        // All forecast points are in the past — client should trigger a new run.
        return {
          horizon,
          source: 'forecast',
          runId: run.id,
          needsForecast: true,
          suggestions: [],
          drivers: [],
          contextStatus,
        };
      }

      let totalForecast = new Prisma.Decimal(0);
      for (const p of futurePoints) {
        totalForecast = totalForecast.add(new Prisma.Decimal(p.yhat));
      }

      // Step 3: dish sales shares from the last 30 days in sales_history.
      type DishRow = { menu_item_id: string; qty: string };
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const dishRows = await tx.$queryRaw<DishRow[]>(Prisma.sql`
        SELECT menu_item_id::text, SUM(qty)::text AS qty
        FROM   sales_history
        WHERE  sold_on >= ${thirtyDaysAgo}::timestamp
        GROUP  BY menu_item_id
      `);

      const totalSold = dishRows.reduce((acc, d) => acc + Number(d.qty), 0);

      if (totalSold === 0) {
        // No historical sales → cannot distribute the forecast across dishes.
        return {
          horizon,
          source: 'forecast',
          runId: run.id,
          needsForecast: false,
          suggestions: [],
          drivers,
          contextStatus,
        };
      }

      // Step 4: load active menu items with their 2-level BOM.
      const menuItems = await tx.menuItem.findMany({
        where: { isActive: true, deletedAt: null },
        include: {
          recipe: {
            include: {
              items: {
                include: {
                  ingredient: true,
                  subRecipe: {
                    include: {
                      items: {
                        include: { ingredient: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      // Index recipes by menuItemId for quick lookup during BOM explosion.
      type RecipeWithBom = (typeof menuItems)[0]['recipe'];
      const recipeByItemId = new Map<string, RecipeWithBom>();
      for (const mi of menuItems) {
        recipeByItemId.set(mi.id, mi.recipe);
      }

      // Step 5: BOM explosion — accumulate projected ingredient consumption.
      const consumptionMap = new Map<
        string,
        { name: string; unit: string; qty: Prisma.Decimal }
      >();

      for (const dish of dishRows) {
        const recipe = recipeByItemId.get(dish.menu_item_id);
        if (!recipe) continue;

        // Fraction of total demand attributed to this dish × total forecast.
        const dishShare = new Prisma.Decimal(dish.qty).div(
          new Prisma.Decimal(totalSold),
        );
        const dishDemand = totalForecast.mul(dishShare);

        for (const item of recipe.items) {
          if (item.ingredient) {
            // Level-1 ingredient.
            const prev = consumptionMap.get(item.ingredientId!);
            const add = dishDemand.mul(item.qty);
            consumptionMap.set(item.ingredientId!, {
              name: item.ingredient.name,
              unit: item.ingredient.unit,
              qty: prev ? prev.qty.add(add) : add,
            });
          } else if (item.subRecipe) {
            // Level-2 sub-recipe: distribute sub-recipe qty across its ingredients.
            for (const sub of item.subRecipe.items) {
              if (!sub.ingredient) continue;
              const prev = consumptionMap.get(sub.ingredientId!);
              const add = dishDemand.mul(item.qty).mul(sub.qty);
              consumptionMap.set(sub.ingredientId!, {
                name: sub.ingredient.name,
                unit: sub.ingredient.unit,
                qty: prev ? prev.qty.add(add) : add,
              });
            }
          }
        }
      }

      // Step 6: compare projected consumption vs current stock; return shortfalls.
      const suggestions: ShoppingSuggestionsResponse['suggestions'] = [];

      for (const [ingredientId, { name, unit, qty }] of consumptionMap) {
        const ing = await tx.ingredient.findFirst({
          where: { id: ingredientId, deletedAt: null },
          select: { stock: true },
        });
        if (!ing) continue;

        const shortfall = qty.sub(ing.stock);
        if (shortfall.gt(0)) {
          suggestions.push({
            ingredientId,
            name,
            unit,
            currentStock: ing.stock.toFixed(3),
            forecastConsumption: qty.toFixed(3),
            shortfall: shortfall.toFixed(3),
            suggestedQty: shortfall.toFixed(3),
          });
        }
      }

      suggestions.sort((a, b) => Number(b.shortfall) - Number(a.shortfall));

      return {
        horizon,
        source: 'forecast',
        runId: run.id,
        needsForecast: false,
        suggestions,
        drivers,
        contextStatus,
      };
    });
  }

  /**
   * E09×E08 (chat futuro, LOTE B3) · Puntos + drivers de la última corrida
   * `completed` (scope=total) que caen dentro de `[from,to]` (fechas
   * 'YYYY-MM-DD', Lima). El chat usa esto para responder preguntas sobre el
   * futuro SIN ejecutar SQL: no hay "ventas futuras" en `sales_history`, así
   * que la única fuente de verdad posible es un pronóstico ya generado.
   *
   * Invariante de producto: NUNCA dispara una corrida nueva — si no hay
   * ninguna completada (`needsForecast`) o el rango cae fuera del horizonte
   * ya pronosticado (`outOfHorizon`), el llamador debe explicarlo y sugerir
   * generar/ampliar el pronóstico manualmente (`POST /forecasting/run`), no
   * auto-ejecutarlo — lanzar un forecast es una acción de gestión explícita
   * (`manage Report`, ver `ForecastingController.run`), no un side-effect de
   * una pregunta de chat.
   *
   * `tenant_id` SIEMPRE del JWT (pasado por el caller); lectura vía
   * `runInTenant` (RLS FORCE).
   */
  async getForecastForRange(
    tenantId: string,
    from: string,
    to: string,
  ): Promise<ForecastRangeAnswer> {
    const run = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.forecastRun.findFirst({
        where: { status: 'completed', scope: 'total' },
        orderBy: { completedAt: 'desc' },
      }),
    );

    if (!run) {
      return {
        needsForecast: true,
        runId: null,
        outOfHorizon: false,
        horizonEnd: null,
        generatedAt: null,
        points: [],
        totalYhat: null,
        totalLo: null,
        totalHi: null,
        drivers: [],
      };
    }

    const allPoints = (run.points as unknown as ForecastPoint[] | null) ?? [];
    const horizonEnd = allPoints.at(-1)?.target_date ?? null;
    const generatedAt = run.completedAt ? run.completedAt.toISOString() : null;

    const points = allPoints
      .filter((p) => p.target_date >= from && p.target_date <= to)
      .sort((a, b) => a.target_date.localeCompare(b.target_date));

    if (points.length === 0) {
      return {
        needsForecast: false,
        runId: run.id,
        outOfHorizon: true,
        horizonEnd,
        generatedAt,
        points: [],
        totalYhat: null,
        totalLo: null,
        totalHi: null,
        drivers: [],
      };
    }

    const allDrivers =
      (run.drivers as unknown as ForecastDriver[] | null) ?? [];
    const drivers = allDrivers
      .filter((d) => d.date >= from && d.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date));

    let totalYhat = 0;
    let totalLo = 0;
    let totalHi = 0;
    for (const p of points) {
      totalYhat += p.yhat;
      totalLo += p.yhat_lo;
      totalHi += p.yhat_hi;
    }

    return {
      needsForecast: false,
      runId: run.id,
      outOfHorizon: false,
      horizonEnd,
      generatedAt,
      points,
      totalYhat,
      totalLo,
      totalHi,
      drivers,
    };
  }

  /**
   * E10×E08 (notificaciones proactivas) · Tras completar una corrida
   * `scope=total`, reusa `shoppingSuggestions` (MISMA lógica de BOM/shortfall
   * que el endpoint manual — no se duplica) para detectar insumos que no
   * cubren la demanda proyectada y avisar a owner/manager por la campana.
   *
   * Diseño:
   *  - `planShortfallNotifications` decide 1-por-insumo (≤3, mismo estilo que
   *    `low_stock`) vs. UNA agrupada (>3, evita floodear la campana).
   *  - `mostRelevantDriver` narra el POR QUÉ ("se viene Fiestas Patrias") con
   *    el factor exógeno de mayor impacto dentro de la ventana del horizonte.
   *  - Antispam vía `NotificationsService.createForRolesTx` (`dedupKey` por
   *    insumo o `:grouped`): una corrida repetida con el MISMO shortfall no
   *    genera una notificación nueva mientras la anterior siga vigente.
   *  - Resiliente: un fallo acá NUNCA debe tumbar la corrida ya persistida
   *    como `completed` — se loguea y sigue (mismo criterio que
   *    `ForecastScheduler.runWeeklyForecasts`, que no corta por tenant).
   */
  private async notifyShortfalls(
    tenantId: string,
    horizon: number,
  ): Promise<void> {
    try {
      const result = await this.shoppingSuggestions(tenantId, horizon);
      if (result.needsForecast || result.suggestions.length === 0) return;

      const plan = planShortfallNotifications(
        result.suggestions,
        SHORTFALL_INDIVIDUAL_LIMIT,
      );
      if (plan.mode === 'none') return;

      const driver = mostRelevantDriver(result.drivers);
      const driverSuffix = driver ? ` (se viene ${driver.label})` : '';

      if (plan.mode === 'individual') {
        for (const item of plan.items) {
          await this.prisma.runInTenant(tenantId, (tx) =>
            this.notifications.createForRolesTx(tx, tenantId, {
              roles: SHORTFALL_RECIPIENT_ROLES,
              type: 'forecast_shortfall',
              title: `${item.name} no cubre los próximos ${horizon} días`,
              body:
                `El stock de ${item.name} no alcanza para cubrir la demanda ` +
                `proyectada de los próximos ${horizon} días${driverSuffix} — ` +
                `considerá pedir ${item.suggestedQty} ${item.unit}.`,
              data: {
                ingredientId: item.ingredientId,
                horizon,
                runId: result.runId,
                href: '/forecasting/shopping-suggestions',
              },
              dedupKey: `forecast_shortfall:${item.ingredientId}`,
            }),
          );
        }
        return;
      }

      // plan.mode === 'grouped'
      const names = plan.items.map((i) => i.name).join(', ');
      await this.prisma.runInTenant(tenantId, (tx) =>
        this.notifications.createForRolesTx(tx, tenantId, {
          roles: SHORTFALL_RECIPIENT_ROLES,
          type: 'forecast_shortfall',
          title: `${plan.totalCount} insumos no cubren los próximos ${horizon} días`,
          body:
            `${names} y ${plan.extraCount} más no alcanzan para cubrir la ` +
            `demanda proyectada${driverSuffix} — revisá las sugerencias de compra.`,
          data: {
            ingredientIds: result.suggestions.map((s) => s.ingredientId),
            horizon,
            runId: result.runId,
            href: '/forecasting/shopping-suggestions',
          },
          dedupKey: 'forecast_shortfall:grouped',
        }),
      );
    } catch (err) {
      this.logger.error(
        `No se pudo generar la notificación proactiva de shortfall ` +
          `(tenant ${tenantId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Returns today's date in the Lima timezone (America/Lima, UTC-5, no DST)
   * as 'YYYY-MM-DD'. Used to filter forecast points that are still in the future.
   */
  private todayLima(): string {
    return new Date().toLocaleDateString('en-CA', {
      timeZone: 'America/Lima',
    });
  }

  /**
   * HU-08-07 (fase 2) · Coordenadas del tenant para el clima del forecast
   * contextual. Solo plumbing: sin UI de config todavía (fase 3), así que la
   * mayoría de tenants tendrán `latitude`/`longitude` en `null`. Cuando faltan,
   * se devuelve `undefined` (no se manda `location` a core-ai) para que
   * core-ai aplique su propio default (Lima) — evita duplicar esa constante
   * en dos stacks. `tenant_id` SIEMPRE del JWT; lectura vía `runInTenant` (RLS).
   */
  private async resolveTenantLocation(
    tenantId: string,
  ): Promise<CoreAiLocation | undefined> {
    const tenant = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.tenant.findUnique({
        where: { id: tenantId },
        select: { latitude: true, longitude: true },
      }),
    );
    if (tenant?.latitude == null || tenant?.longitude == null) return undefined;
    return { latitude: tenant.latitude, longitude: tenant.longitude };
  }

  /**
   * Computa el pronóstico: arma la serie diaria desde `sales_history` (mismo seam)
   * y la envía a `core-ai`. Lo usa el worker. 422 si el histórico es insuficiente.
   */
  async computeForecast(
    tenantId: string,
    input: RunForecastInput,
  ): Promise<ComputedForecast> {
    const series = await this.demandSeries(
      tenantId,
      input.scope,
      input.menuItemId,
      input.from,
      input.to,
    );

    if (series.points.length < MIN_POINTS_TO_FORECAST) {
      throw new UnprocessableEntityException(
        'Histórico insuficiente para pronosticar (se requieren al menos ' +
          `${MIN_POINTS_TO_FORECAST} días con datos).`,
      );
    }

    const location = await this.resolveTenantLocation(tenantId);
    const forecast = await this.coreAi.runForecast({
      series_id: series.seriesId,
      frequency: series.frequency,
      horizon: input.horizon,
      history: series.points,
      // HU-08-07 (fase 2): "auto" (nunca "ml" hardcodeado) + use_context SIEMPRE
      // true para corridas de negocio — core-ai decide si "ml" aplica según la
      // historia disponible y degrada solo si no alcanza. `input.engine` sigue
      // existiendo por si algún caller quiere forzar otro motor explícito
      // (p. ej. QA comparando `seasonalnaive` vs `auto`).
      engine: input.engine ?? DEFAULT_ENGINE,
      use_context: USE_CONTEXT,
      location,
    });

    return {
      series: {
        scope: series.scope,
        seriesId: series.seriesId,
        label: series.label,
        frequency: series.frequency,
        observations: series.observations,
        spanDays: series.spanDays,
        dataQuality: series.dataQuality,
      },
      forecast,
    };
  }

  /**
   * E08 · Construye la serie de demanda diaria (zero-filled) desde `sales_history`.
   * La agregación por día (zona Lima, UTC-5 sin DST) y la suma de unidades las
   * hace Postgres (GROUP BY) — no se cargan todas las filas a memoria. Por defecto
   * usa TODO el histórico del tenant; `from`/`to` (ISO) la acotan, exigiendo
   * `from <= to`. `tenant_id` SIEMPRE del JWT; acceso vía `runInTenant` (RLS FORCE).
   */
  async demandSeries(
    tenantId: string,
    scope: 'total' | 'menuItem',
    menuItemId: string | undefined,
    fromIso: string | undefined,
    toIso: string | undefined,
  ): Promise<DemandSeriesResponse> {
    const { from, to } = this.parseWindow(fromIso, toIso);
    const menuId = scope === 'menuItem' ? (menuItemId as string) : null;

    return this.prisma.runInTenant(tenantId, async (tx) => {
      const daily = await this.dailyTotals(tx, menuId, from, to);
      const totals: DailyTotal[] = daily.map((r) => ({ ds: r.ds, y: r.y }));
      const seriesId = scope === 'menuItem' ? (menuItemId as string) : 'total';
      const label =
        scope === 'menuItem'
          ? await this.menuItemLabel(tx, menuItemId as string)
          : 'Demanda total';

      const series = zeroFillDailySeries(totals, seriesId, label);
      return {
        scope,
        seriesId: series.seriesId,
        label: series.label,
        frequency: 'D',
        observations: series.observations,
        spanDays: series.spanDays,
        dataQuality: series.dataQuality,
        points: series.points,
      };
    });
  }

  // Totales de demanda por día local (Lima): `sold_on - interval '5h'` (la columna
  // es timestamp sin tz, en UTC). RLS filtra el tenant; nunca se filtra en la app.
  private dailyTotals(
    tx: Tx,
    menuId: string | null,
    from: Date | null,
    to: Date | null,
  ): Promise<DailyRow[]> {
    return tx.$queryRaw<DailyRow[]>(Prisma.sql`
      SELECT to_char((sold_on - interval '5 hours')::date, 'YYYY-MM-DD') AS ds,
             SUM(qty)::int AS y
      FROM sales_history
      WHERE (${menuId}::uuid IS NULL OR menu_item_id = ${menuId}::uuid)
        AND (${from}::timestamp IS NULL OR sold_on >= ${from}::timestamp)
        AND (${to}::timestamp IS NULL OR sold_on <= ${to}::timestamp)
      GROUP BY 1
      ORDER BY 1
    `);
  }

  // Último día local (Lima) con ventas para el ámbito; null si no hay ninguna.
  private async maxActualDay(
    tx: Tx,
    menuId: string | null,
  ): Promise<string | null> {
    const rows = await tx.$queryRaw<{ ds: string | null }[]>(Prisma.sql`
      SELECT to_char(max((sold_on - interval '5 hours')::date), 'YYYY-MM-DD') AS ds
      FROM sales_history
      WHERE (${menuId}::uuid IS NULL OR menu_item_id = ${menuId}::uuid)
    `);
    return rows[0]?.ds ?? null;
  }

  // Etiqueta del plato: nombre del MenuItem si existe; si fue borrado, el nombre
  // más reciente visto en el histórico; si no, el propio id.
  private async menuItemLabel(tx: Tx, menuItemId: string): Promise<string> {
    const item = await tx.menuItem.findFirst({
      where: { id: menuItemId },
      select: { name: true },
    });
    if (item) return item.name;
    const last = await tx.salesHistory.findFirst({
      where: { menuItemId },
      orderBy: { soldOn: 'desc' },
      select: { dishName: true },
    });
    return last?.dishName ?? menuItemId;
  }

  private parseWindow(
    fromIso: string | undefined,
    toIso: string | undefined,
  ): { from: Date | null; to: Date | null } {
    const from = fromIso ? new Date(fromIso) : null;
    const to = toIso ? new Date(toIso) : null;
    if (from && to && from.getTime() > to.getTime()) {
      throw new BadRequestException(
        'El rango es inválido: "from" debe ser <= "to"',
      );
    }
    return { from, to };
  }

  // Mapea la fila persistida a la vista de API (Json → tipos del contrato).
  private toView(run: Prisma.ForecastRunGetPayload<object>): ForecastRunView {
    return {
      id: run.id,
      scope: run.scope,
      menuItemId: run.menuItemId,
      horizon: run.horizon,
      engine: run.engine,
      status: run.status as ForecastRunStatus,
      model: run.model,
      baseline: run.baseline,
      observations: run.observations,
      spanDays: run.spanDays,
      dataQuality: run.dataQuality,
      points: (run.points as unknown as ForecastPoint[] | null) ?? null,
      backtest: this.normalizeBacktest(run.backtest),
      // HU-08-07 (fase 2) · [] / null en corridas previas a la migración —
      // lectura hacia atrás compatible (columnas nuevas, filas viejas en NULL).
      drivers: (run.drivers as unknown as ForecastDriver[] | null) ?? [],
      contextStatus: run.contextStatus as ForecastContextStatus | null,
      error: run.error,
      createdAt: run.createdAt.toISOString(),
      completedAt: run.completedAt ? run.completedAt.toISOString() : null,
    };
  }

  // `model_smape_no_context` puede faltar en JSON persistido antes de HU-08-07
  // (la columna `backtest` es la misma; solo cambió el shape del valor) —
  // se normaliza a `null` explícito para que la vista nunca exponga `undefined`.
  private normalizeBacktest(
    raw: Prisma.JsonValue | null,
  ): BacktestMetrics | null {
    const backtest = raw as unknown as BacktestMetrics | null;
    if (!backtest) return null;
    return {
      ...backtest,
      model_smape_no_context: backtest.model_smape_no_context ?? null,
    };
  }

  /**
   * HU-08-07 (fase 2) · Resumen narrable para el dashboard de gestión: toma la
   * última corrida `completed` (`scope=total`) del tenant y expone los
   * factores exógenos que caen dentro de lo que queda de su horizonte
   * (`date >= hoy`), el estado del contexto y la comparativa de backtest
   * con/sin contexto. `needsForecast: true` (200, no 404) si el tenant aún no
   * completó ninguna corrida — igual criterio que `shoppingSuggestions`, para
   * que el dashboard pueda mostrar un estado vacío en vez de manejar un error.
   * `tenant_id` SIEMPRE del JWT; `runInTenant` (RLS FORCE). CASL `read Report`
   * (gateado en el controller, igual que el resto de reportes de gestión).
   */
  async getInsights(tenantId: string): Promise<ForecastInsightsResponse> {
    const run = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.forecastRun.findFirst({
        where: { status: 'completed', scope: 'total' },
        orderBy: { completedAt: 'desc' },
      }),
    );

    if (!run) {
      return {
        runId: null,
        status: null,
        contextStatus: null,
        horizon: null,
        generatedAt: null,
        upcomingDrivers: [],
        backtest: null,
        needsForecast: true,
      };
    }

    const today = this.todayLima();
    const drivers = (run.drivers as unknown as ForecastDriver[] | null) ?? [];
    const upcomingDrivers = drivers
      .filter((d) => d.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date));

    const backtest = this.normalizeBacktest(run.backtest);

    return {
      runId: run.id,
      status: run.status as ForecastRunStatus,
      contextStatus: run.contextStatus as ForecastContextStatus | null,
      horizon: run.horizon,
      generatedAt: run.completedAt ? run.completedAt.toISOString() : null,
      upcomingDrivers,
      backtest: backtest ? this.toInsightsBacktest(backtest) : null,
      needsForecast: false,
    };
  }

  /**
   * HU-08-08 · "El sistema se autoevalúa": combina TODAS las corridas
   * `completed` del ámbito (no solo la última, a diferencia de
   * `validateLatest`) y compara predicho vs. real día a día para las fechas
   * YA transcurridas. Reusa el MISMO seam de agregación que el resto de E08
   * (`dailyTotals`/`maxActualDay`, sobre `sales_history`) y el mismo comparador
   * puro que `validateLatest` (`compareForecastVsActual`) — cero lógica
   * duplicada. `tenant_id` SIEMPRE del JWT; `runInTenant` (RLS FORCE).
   *
   * Merge multi-corrida: si dos corridas predijeron el mismo día (re-forecasts
   * a lo largo del tiempo), gana la predicción de la corrida MÁS RECIENTE para
   * ESE día (se itera asc y se sobreescribe) — es la que mejor refleja lo que
   * el sistema mostraba en ese momento. `runsEvaluated` cuenta las corridas que
   * aportaron al menos un día ya transcurrido.
   *
   * Nunca 404/500 por falta de datos: 0 corridas, 0 corridas con días
   * transcurridos, o pocos puntos (< `MIN_ACCURACY_POINTS`) → 200 con
   * `needsMoreData: true` y la serie parcial que haya.
   */
  async getAccuracy(
    tenantId: string,
    scope: 'total' | 'menuItem',
    menuItemId: string | undefined,
  ): Promise<ForecastAccuracyResponse> {
    const menuId = scope === 'menuItem' ? (menuItemId as string) : null;

    return this.prisma.runInTenant(tenantId, async (tx) => {
      const runs = await tx.forecastRun.findMany({
        where: { scope, menuItemId: menuId, status: 'completed' },
        orderBy: { completedAt: 'asc' },
      });

      if (runs.length === 0) {
        return this.emptyAccuracy(
          0,
          'Aún no hay corridas de pronóstico completadas para este ámbito.',
        );
      }

      const maxDay = await this.maxActualDay(tx, menuId);
      if (!maxDay) {
        return this.emptyAccuracy(
          0,
          'Todavía no hay historial de ventas para comparar contra lo predicho.',
        );
      }

      // Merge: por cada corrida (asc por completedAt), los puntos con fecha ya
      // transcurrida (<= maxDay) sobreescriben el mapa — la corrida más
      // reciente que predijo ese día "gana".
      const seriesMap = new Map<string, ForecastPointLike>();
      const contributingRunIds = new Set<string>();
      for (const run of runs) {
        const points = (run.points as unknown as ForecastPoint[] | null) ?? [];
        for (const p of points) {
          if (p.target_date <= maxDay) {
            seriesMap.set(p.target_date, p);
            contributingRunIds.add(run.id);
          }
        }
      }

      if (seriesMap.size === 0) {
        return this.emptyAccuracy(
          contributingRunIds.size,
          'Las corridas completadas todavía no tienen fechas transcurridas para comparar.',
        );
      }

      const dates = [...seriesMap.keys()].sort();
      const from = new Date(`${dates[0]}T00:00:00-05:00`);
      const to = new Date(`${dates[dates.length - 1]}T23:59:59-05:00`);
      const daily = await this.dailyTotals(tx, menuId, from, to);
      const totalsByDay = new Map(daily.map((d) => [d.ds, d.y]));

      const actualByDay: Record<string, number> = {};
      for (const date of dates) {
        actualByDay[date] = totalsByDay.get(date) ?? 0;
      }

      const mergedPoints = dates.map(
        (d) => seriesMap.get(d) as ForecastPointLike,
      );
      const validation = compareForecastVsActual(mergedPoints, actualByDay);

      const series: ForecastAccuracyResponse['series'] = validation.rows.map(
        (r) => ({
          date: r.targetDate,
          predicted: r.yhat,
          actual: r.actual as number, // siempre presente: todo target_date <= maxDay
          yhatLo: r.yhatLo,
          yhatHi: r.yhatHi,
        }),
      );

      const points = validation.summary.comparedDays;
      const needsMoreData = points < MIN_ACCURACY_POINTS;

      return {
        series,
        metrics: {
          smapeRealized: validation.summary.smape,
          mapeRealized: validation.summary.mape,
          coveragePct: validation.summary.intervalCoveragePct,
          points,
        },
        runsEvaluated: contributingRunIds.size,
        needsMoreData,
        message: needsMoreData
          ? 'Pocos días transcurridos todavía — las métricas se irán afinando con más historia.'
          : undefined,
      };
    });
  }

  // Respuesta válida (nunca 404/500) para los casos sin datos suficientes.
  private emptyAccuracy(
    runsEvaluated: number,
    message: string,
  ): ForecastAccuracyResponse {
    return {
      series: [],
      metrics: {
        smapeRealized: null,
        mapeRealized: null,
        coveragePct: null,
        points: 0,
      },
      runsEvaluated,
      needsMoreData: true,
      message,
    };
  }

  // Deriva la mejora relativa con-contexto-vs-sin-contexto a partir del
  // backtest crudo. `null` salvo que exista `model_smape_no_context` (motor
  // "ml" con contexto) y sea > 0 (evita dividir por 0 / inventar una mejora).
  private toInsightsBacktest(
    backtest: BacktestMetrics,
  ): ForecastInsightsResponse['backtest'] {
    const noContext = backtest.model_smape_no_context ?? null;
    const contextImprovementPct =
      noContext !== null && noContext > 0
        ? ((noContext - backtest.model_smape) / noContext) * 100
        : null;

    return {
      modelSmape: backtest.model_smape,
      baselineSmape: backtest.baseline_smape,
      improvementPct: backtest.improvement_pct,
      modelSmapeNoContext: noContext,
      contextImprovementPct,
    };
  }
}
