import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../platform/prisma/prisma.service';
import { FORECAST_QUEUE } from '../platform/queue/redis-connection';
import {
  type BacktestMetrics,
  type CoreAiForecastResponse,
  type ForecastPoint,
  type ForecastRunStatus,
  type RunForecastInput,
} from '../shared';
import { CoreAiClient } from './core-ai.client';
import {
  zeroFillDailySeries,
  type AggregatedSeries,
  type DailyTotal,
} from './sales-aggregation.util';

// core-ai exige al menos 2 puntos para inferir; con menos no hay serie útil.
const MIN_POINTS_TO_FORECAST = 2;

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
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

@Injectable()
export class ForecastingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coreAi: CoreAiClient,
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
      { jobId: run.id, removeOnComplete: true, removeOnFail: 500 },
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
            completedAt: new Date(),
          },
        }),
      );
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
    }
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

    const forecast = await this.coreAi.runForecast({
      series_id: series.seriesId,
      frequency: series.frequency,
      horizon: input.horizon,
      history: series.points,
      engine: input.engine,
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
      // `sold_on - interval '5 hours'` = día local Lima (la columna es timestamp
      // sin tz, en UTC). RLS filtra el tenant; nunca se filtra tenant_id en la app.
      const daily = await tx.$queryRaw<DailyRow[]>(Prisma.sql`
        SELECT to_char((sold_on - interval '5 hours')::date, 'YYYY-MM-DD') AS ds,
               SUM(qty)::int AS y
        FROM sales_history
        WHERE (${menuId}::uuid IS NULL OR menu_item_id = ${menuId}::uuid)
          AND (${from}::timestamp IS NULL OR sold_on >= ${from}::timestamp)
          AND (${to}::timestamp IS NULL OR sold_on <= ${to}::timestamp)
        GROUP BY 1
        ORDER BY 1
      `);

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
      backtest: (run.backtest as unknown as BacktestMetrics | null) ?? null,
      error: run.error,
      createdAt: run.createdAt.toISOString(),
      completedAt: run.completedAt ? run.completedAt.toISOString() : null,
    };
  }
}
