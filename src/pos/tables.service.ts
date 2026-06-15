import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma/prisma.service';
import { type CreateTableInput, type UpdateTableInput } from '../shared';
import {
  OrdersService,
  type OrderView,
  type TableOrderSummary,
} from './orders.service';

type Tx = Prisma.TransactionClient;
type TableRow = Prisma.DiningTableGetPayload<{ include: { zone: true } }>;

export interface TableView {
  id: string;
  zoneId: string;
  zoneName: string;
  code: string;
  capacity: number;
  status: string;
  posX: number | null;
  posY: number | null;
  // Derivados de la orden actual de la mesa (null cuando está libre).
  currentOrderId: string | null;
  openedAt: string | null;
  guests: number | null;
  waiterId: string | null;
  waiterName: string | null;
}

export interface TableDetailView {
  table: TableView;
  order: OrderView | null;
}

function toView(t: TableRow, summary?: TableOrderSummary): TableView {
  return {
    id: t.id,
    zoneId: t.zoneId,
    zoneName: t.zone.name,
    code: t.code,
    capacity: t.capacity,
    status: t.status,
    posX: t.posX,
    posY: t.posY,
    currentOrderId: summary?.currentOrderId ?? null,
    openedAt: summary?.openedAt ?? null,
    guests: summary?.guests ?? null,
    waiterId: summary?.waiterId ?? null,
    waiterName: summary?.waiterName ?? null,
  };
}

@Injectable()
export class TablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
  ) {}

  async list(tenantId: string): Promise<TableView[]> {
    const rows = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.diningTable.findMany({
        where: { deletedAt: null },
        include: { zone: true },
        orderBy: { code: 'asc' },
      }),
    );
    // Enriquecer con la orden actual de cada mesa (una sola consulta → sin N+1).
    const summaries = await this.orders.currentSummariesByTable(tenantId);
    return rows.map((row) => toView(row, summaries.get(row.id)));
  }

  /** Read-model del POS: la mesa + su orden actual (o null si está libre). */
  async getOne(tenantId: string, id: string): Promise<TableDetailView> {
    const row = await this.prisma.runInTenant(tenantId, (tx) =>
      this.find(tx, id),
    );
    const order = await this.orders.findCurrentForTable(tenantId, id);
    const summary: TableOrderSummary | undefined = order
      ? {
          currentOrderId: order.id,
          openedAt: order.openedAt,
          guests: order.guests,
          waiterId: order.waiterId,
          waiterName: order.waiterName,
        }
      : undefined;
    return { table: toView(row, summary), order };
  }

  async create(tenantId: string, dto: CreateTableInput): Promise<TableView> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      await this.assertZone(tx, dto.zoneId);
      try {
        const created = await tx.diningTable.create({
          data: {
            tenantId,
            zoneId: dto.zoneId,
            code: dto.code,
            capacity: dto.capacity ?? 2,
            posX: dto.posX ?? null,
            posY: dto.posY ?? null,
          },
          include: { zone: true },
        });
        return toView(created);
      } catch (e) {
        throw this.mapDuplicate(e);
      }
    });
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateTableInput,
  ): Promise<TableView> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      await this.find(tx, id);
      if (dto.zoneId !== undefined) {
        await this.assertZone(tx, dto.zoneId);
      }
      const data: Prisma.DiningTableUncheckedUpdateInput = {};
      if (dto.zoneId !== undefined) data.zoneId = dto.zoneId;
      if (dto.code !== undefined) data.code = dto.code;
      if (dto.capacity !== undefined) data.capacity = dto.capacity;
      if (dto.status !== undefined) data.status = dto.status;
      if (dto.posX !== undefined) data.posX = dto.posX;
      if (dto.posY !== undefined) data.posY = dto.posY;
      try {
        const updated = await tx.diningTable.update({
          where: { id },
          data,
          include: { zone: true },
        });
        return toView(updated);
      } catch (e) {
        throw this.mapDuplicate(e);
      }
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.prisma.runInTenant(tenantId, async (tx) => {
      const table = await this.find(tx, id);
      if (table.status !== 'free') {
        throw new ConflictException(
          'No se puede eliminar una mesa que no está libre',
        );
      }
      await tx.diningTable.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    });
  }

  private async find(tx: Tx, id: string): Promise<TableRow> {
    const row = await tx.diningTable.findFirst({
      where: { id, deletedAt: null },
      include: { zone: true },
    });
    if (!row) {
      throw new NotFoundException('Mesa no encontrada');
    }
    return row;
  }

  private async assertZone(tx: Tx, zoneId: string): Promise<void> {
    const zone = await tx.zone.findFirst({
      where: { id: zoneId, deletedAt: null },
    });
    if (!zone) {
      throw new BadRequestException('La zona no existe');
    }
  }

  private mapDuplicate(e: unknown): unknown {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      return new ConflictException('Ya existe una mesa con ese código');
    }
    return e;
  }
}
