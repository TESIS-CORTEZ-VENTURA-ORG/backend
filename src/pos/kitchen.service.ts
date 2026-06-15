import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type KitchenStation, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma/prisma.service';
import {
  type CreateKitchenStationInput,
  type KitchenQueueQueryInput,
  type UpdateKitchenItemInput,
  type UpdateKitchenStationInput,
} from '../shared';

type Tx = Prisma.TransactionClient;

// Modificador embebido en el ítem (snapshot JSONB). priceDelta en PEN.
interface ModifierSnapshot {
  name: string;
  priceDelta: number;
}

// HU-03-07: minutos a partir de los cuales un ítem se considera retrasado.
const LATE_THRESHOLD_MINUTES = 10;
// Estados visibles en la cola del KDS (ítems aún por preparar / preparándose).
const QUEUE_STATUSES = ['pending', 'preparing'];

export interface KitchenStationView {
  id: string;
  name: string;
  position: number;
}

export interface KitchenItemView {
  orderItemId: string;
  orderId: string;
  tableCode: string;
  dishName: string;
  qty: number;
  modifiers: ModifierSnapshot[];
  notes: string | null;
  status: string;
  sentToKitchenAt: string;
  waitMinutes: number;
  isLate: boolean;
}

function stationToView(s: KitchenStation): KitchenStationView {
  return { id: s.id, name: s.name, position: s.position };
}

@Injectable()
export class KitchenService {
  constructor(private readonly prisma: PrismaService) {}

  // ── HU-03-07 · Estaciones (CRUD) ───────────────────────────────────────────

  async listStations(tenantId: string): Promise<KitchenStationView[]> {
    const rows = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.kitchenStation.findMany({
        where: { deletedAt: null },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
      }),
    );
    return rows.map(stationToView);
  }

  async createStation(
    tenantId: string,
    dto: CreateKitchenStationInput,
  ): Promise<KitchenStationView> {
    const row = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.kitchenStation.create({
        data: {
          tenantId,
          name: dto.name,
          position: dto.position ?? 0,
        },
      }),
    );
    return stationToView(row);
  }

  async updateStation(
    tenantId: string,
    id: string,
    dto: UpdateKitchenStationInput,
  ): Promise<KitchenStationView> {
    const row = await this.prisma.runInTenant(tenantId, async (tx) => {
      await this.findStation(tx, id);
      const data: Prisma.KitchenStationUncheckedUpdateInput = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.position !== undefined) data.position = dto.position;
      return tx.kitchenStation.update({ where: { id }, data });
    });
    return stationToView(row);
  }

  /**
   * Soft-delete de una estación. Bloquea (409) si alguna categoría de menú aún
   * apunta a ella: el frontend debe re-enrutar esas categorías antes de borrar
   * (evita dejar platos sin destino de cocina silenciosamente).
   */
  async removeStation(tenantId: string, id: string): Promise<void> {
    await this.prisma.runInTenant(tenantId, async (tx) => {
      await this.findStation(tx, id);
      const linked = await tx.menuCategory.count({
        where: { kitchenStationId: id, deletedAt: null },
      });
      if (linked > 0) {
        throw new ConflictException(
          'No se puede eliminar una estación con categorías de menú asociadas',
        );
      }
      await tx.kitchenStation.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    });
  }

  // ── HU-03-07 · Cola del KDS ─────────────────────────────────────────────────

  /**
   * Cola de cocina: ítems en estado pending|preparing que ya fueron enviados a
   * cocina (sentToKitchenAt no null), ordenados por antigüedad (FIFO). Opcional:
   * filtrar por estación. waitMinutes/isLate se calculan contra `now`.
   */
  async queue(
    tenantId: string,
    query: KitchenQueueQueryInput,
  ): Promise<KitchenItemView[]> {
    const now = Date.now();
    const rows = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.orderItem.findMany({
        where: {
          deletedAt: null,
          status: { in: QUEUE_STATUSES },
          sentToKitchenAt: { not: null },
          ...(query.stationId ? { kitchenStationId: query.stationId } : {}),
        },
        include: { order: { include: { table: true } } },
        orderBy: { sentToKitchenAt: 'asc' },
      }),
    );
    return rows.map((row) => this.itemToView(row, now));
  }

  // ── HU-03-08/09 · Transición de estado de un ítem ───────────────────────────

  /**
   * Avanza un ítem en el KDS: preparing sella preparingAt, ready sella readyAt.
   * Transiciones válidas: pending→preparing, preparing→ready (cocina hacia
   * adelante). Cualquier otra → 409.
   */
  async updateItem(
    tenantId: string,
    itemId: string,
    dto: UpdateKitchenItemInput,
  ): Promise<KitchenItemView> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const item = await tx.orderItem.findFirst({
        where: { id: itemId, deletedAt: null },
        include: { order: { include: { table: true } } },
      });
      if (!item) {
        throw new NotFoundException('Ítem de orden no encontrado');
      }
      if (item.sentToKitchenAt === null) {
        throw new BadRequestException('El ítem no fue enviado a cocina');
      }

      this.assertTransition(item.status, dto.status);

      const data: Prisma.OrderItemUncheckedUpdateInput = { status: dto.status };
      const now = new Date();
      if (dto.status === 'preparing') data.preparingAt = now;
      if (dto.status === 'ready') data.readyAt = now;

      const updated = await tx.orderItem.update({
        where: { id: itemId },
        data,
        include: { order: { include: { table: true } } },
      });
      return this.itemToView(updated, now.getTime());
    });
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  private assertTransition(from: string, to: 'preparing' | 'ready'): void {
    const valid =
      (to === 'preparing' && from === 'pending') ||
      (to === 'ready' && from === 'preparing');
    if (!valid) {
      throw new ConflictException(
        `Transición de '${from}' a '${to}' no permitida`,
      );
    }
  }

  private async findStation(tx: Tx, id: string): Promise<KitchenStation> {
    const row = await tx.kitchenStation.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) {
      throw new NotFoundException('Estación de cocina no encontrada');
    }
    return row;
  }

  private itemToView(
    item: Prisma.OrderItemGetPayload<{
      include: { order: { include: { table: true } } };
    }>,
    now: number,
  ): KitchenItemView {
    // sentToKitchenAt está garantizado por el filtro de la query / la guarda.
    const sentAt = item.sentToKitchenAt as Date;
    const waitMinutes = Math.floor((now - sentAt.getTime()) / 60000);
    return {
      orderItemId: item.id,
      orderId: item.orderId,
      tableCode: item.order.table.code,
      dishName: item.name,
      qty: item.qty,
      modifiers: item.modifiers as unknown as ModifierSnapshot[],
      notes: item.notes,
      status: item.status,
      sentToKitchenAt: sentAt.toISOString(),
      waitMinutes,
      isLate: waitMinutes > LATE_THRESHOLD_MINUTES,
    };
  }
}
