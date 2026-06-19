import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma/prisma.service';
import {
  aggregateMenuItem,
  aggregateTotalDemand,
  type AggregatedSeries,
  type SalesRow,
} from './sales-aggregation.util';

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

@Injectable()
export class ForecastingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * E08 · Construye la serie de demanda diaria (zero-filled) desde `sales_history`.
   * Por defecto usa TODO el histórico del tenant (forecasting quiere la mayor
   * ventana posible); `from`/`to` (ISO con offset) la acotan si se pasan, exigiendo
   * `from <= to`. `tenant_id` SIEMPRE del JWT; acceso vía `runInTenant` (RLS FORCE).
   */
  async demandSeries(
    tenantId: string,
    scope: 'total' | 'menuItem',
    menuItemId: string | undefined,
    fromIso: string | undefined,
    toIso: string | undefined,
  ): Promise<DemandSeriesResponse> {
    const where = this.buildWhere(fromIso, toIso);
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const rows = await tx.salesHistory.findMany({
        where,
        select: { soldOn: true, menuItemId: true, dishName: true, qty: true },
        orderBy: { soldOn: 'asc' },
      });
      const sales: SalesRow[] = rows.map((r) => ({
        soldOn: r.soldOn,
        menuItemId: r.menuItemId,
        dishName: r.dishName,
        qty: r.qty,
      }));

      const series =
        scope === 'menuItem'
          ? aggregateMenuItem(sales, menuItemId as string)
          : aggregateTotalDemand(sales);

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

  private buildWhere(
    fromIso: string | undefined,
    toIso: string | undefined,
  ): Prisma.SalesHistoryWhereInput {
    if (!fromIso && !toIso) return {};
    const from = fromIso ? new Date(fromIso) : undefined;
    const to = toIso ? new Date(toIso) : undefined;
    if (from && to && from.getTime() > to.getTime()) {
      throw new BadRequestException(
        'El rango es inválido: "from" debe ser <= "to"',
      );
    }
    return {
      soldOn: {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      },
    };
  }
}
