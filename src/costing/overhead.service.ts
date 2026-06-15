import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma/prisma.service';
import {
  type CreateOverheadCostInput,
  type UpdateOverheadCostInput,
} from '../shared';

type Tx = Prisma.TransactionClient;
type OverheadRow = Prisma.OverheadCostGetPayload<object>;

// HU-06-02 · Vista de un CIF (moneda como string, PEN).
export interface OverheadCostView {
  id: string;
  period: string;
  concept: string;
  amount: string;
}

/**
 * HU-06-02 · Gestión de costos indirectos (CIF) mensuales. CRUD por tenant,
 * filtrable por período `YYYY-MM`. Soft-delete (`deletedAt`). Solo owner/manager
 * (gate en el controller: `manage Report`). Todo el acceso vía `runInTenant`.
 */
@Injectable()
export class OverheadService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, period?: string): Promise<OverheadCostView[]> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const rows = await tx.overheadCost.findMany({
        where: { deletedAt: null, ...(period ? { period } : {}) },
        orderBy: [{ period: 'desc' }, { concept: 'asc' }],
      });
      return rows.map(toView);
    });
  }

  async create(
    tenantId: string,
    dto: CreateOverheadCostInput,
  ): Promise<OverheadCostView> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const row = await tx.overheadCost.create({
        data: {
          tenantId,
          period: dto.period,
          concept: dto.concept,
          amount: new Prisma.Decimal(dto.amount),
        },
      });
      return toView(row);
    });
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateOverheadCostInput,
  ): Promise<OverheadCostView> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      await this.find(tx, id);
      const data: Prisma.OverheadCostUncheckedUpdateInput = {};
      if (dto.period !== undefined) data.period = dto.period;
      if (dto.concept !== undefined) data.concept = dto.concept;
      if (dto.amount !== undefined)
        data.amount = new Prisma.Decimal(dto.amount);
      const row = await tx.overheadCost.update({ where: { id }, data });
      return toView(row);
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.prisma.runInTenant(tenantId, async (tx) => {
      await this.find(tx, id);
      await tx.overheadCost.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    });
  }

  private async find(tx: Tx, id: string): Promise<OverheadRow> {
    const row = await tx.overheadCost.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) {
      throw new NotFoundException('Costo indirecto no encontrado');
    }
    return row;
  }
}

function toView(row: OverheadRow): OverheadCostView {
  return {
    id: row.id,
    period: row.period,
    concept: row.concept,
    amount: row.amount.toFixed(2),
  };
}
