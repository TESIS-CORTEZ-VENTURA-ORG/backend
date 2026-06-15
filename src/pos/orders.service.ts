import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma/prisma.service';
import {
  type AddOrderItemsInput,
  type OpenOrderInput,
  type UpdateOrderItemInput,
  type VoidOrderInput,
} from '../shared';

type Tx = Prisma.TransactionClient;
type OrderRow = Prisma.OrderGetPayload<object>;
type OrderItemRow = Prisma.OrderItemGetPayload<object>;

// Snapshot de modificador embebido en el ítem (JSONB). priceDelta es number (PEN).
interface ModifierSnapshot {
  name: string;
  priceDelta: number;
}

// Estados desde los que se puede anular una orden (HU-03-11).
const VOIDABLE_STATUSES = new Set(['open', 'sent_to_kitchen', 'served']);

export interface OrderItemView {
  id: string;
  menuItemId: string;
  name: string;
  qty: number;
  unitPrice: string;
  notes: string | null;
  modifiers: ModifierSnapshot[];
  status: string;
}

export interface OrderView {
  id: string;
  tableId: string;
  waiterId: string | null;
  guests: number;
  status: string;
  openedAt: string;
  items: OrderItemView[];
  subtotal: string;
}

function itemToView(item: OrderItemRow): OrderItemView {
  return {
    id: item.id,
    menuItemId: item.menuItemId,
    name: item.name,
    qty: item.qty,
    unitPrice: item.unitPrice.toFixed(2),
    notes: item.notes,
    modifiers: item.modifiers as unknown as ModifierSnapshot[],
    status: item.status,
  };
}

function toView(order: OrderRow, items: OrderItemRow[]): OrderView {
  let subtotal = new Prisma.Decimal(0);
  for (const item of items) {
    subtotal = subtotal.add(item.unitPrice.mul(item.qty));
  }
  return {
    id: order.id,
    tableId: order.tableId,
    waiterId: order.waiterId,
    guests: order.guests,
    status: order.status,
    openedAt: order.openedAt.toISOString(),
    items: items.map(itemToView),
    subtotal: subtotal.toFixed(2),
  };
}

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /** HU-03-03 · Abrir una mesa libre (crea la orden). Idempotente por idempotencyKey. */
  async open(
    tenantId: string,
    waiterId: string,
    dto: OpenOrderInput,
  ): Promise<OrderView> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      // Idempotencia: si ya existe una orden con esa clave, devolverla sin duplicar.
      if (dto.idempotencyKey) {
        const existing = await tx.order.findFirst({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (existing) {
          return this.buildView(tx, existing);
        }
      }

      const table = await tx.diningTable.findFirst({
        where: { id: dto.tableId, deletedAt: null },
      });
      if (!table) {
        throw new BadRequestException('La mesa no existe');
      }
      if (table.status !== 'free') {
        throw new ConflictException('La mesa no está libre');
      }
      const guests = dto.guests ?? 1;
      if (guests > table.capacity) {
        throw new BadRequestException(
          `La mesa admite hasta ${table.capacity} comensales`,
        );
      }

      let order: OrderRow;
      try {
        order = await tx.order.create({
          data: {
            tenantId,
            tableId: dto.tableId,
            waiterId,
            guests,
            status: 'open',
            idempotencyKey: dto.idempotencyKey ?? null,
          },
        });
      } catch (e) {
        // Carrera con la misma idempotencyKey → devolver la orden existente.
        if (
          dto.idempotencyKey &&
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          const existing = await tx.order.findFirst({
            where: { idempotencyKey: dto.idempotencyKey },
          });
          if (existing) {
            return this.buildView(tx, existing);
          }
        }
        throw e;
      }

      await tx.diningTable.update({
        where: { id: dto.tableId },
        data: { status: 'occupied' },
      });
      return this.buildView(tx, order);
    });
  }

  async get(tenantId: string, id: string): Promise<OrderView> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const order = await this.find(tx, id);
      return this.buildView(tx, order);
    });
  }

  /** HU-03-04/05 · Tomar orden: añade ítems con sus modificadores (precio snapshot). */
  async addItems(
    tenantId: string,
    id: string,
    dto: AddOrderItemsInput,
  ): Promise<OrderView> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const order = await this.find(tx, id);
      for (const line of dto.items) {
        const menuItem = await tx.menuItem.findFirst({
          where: { id: line.menuItemId, deletedAt: null },
        });
        if (!menuItem) {
          throw new BadRequestException(
            `El plato ${line.menuItemId} no existe`,
          );
        }

        const modifierIds = line.modifierIds ?? [];
        const modifierSnapshots: ModifierSnapshot[] = [];
        let unitPrice = menuItem.price;
        for (const modifierId of modifierIds) {
          const modifier = await tx.menuModifier.findFirst({
            where: {
              id: modifierId,
              menuItemId: menuItem.id,
              deletedAt: null,
            },
          });
          if (!modifier) {
            throw new BadRequestException(
              `El modificador ${modifierId} no pertenece al plato`,
            );
          }
          unitPrice = unitPrice.add(modifier.priceDelta);
          modifierSnapshots.push({
            name: modifier.name,
            priceDelta: Number(modifier.priceDelta.toFixed(2)),
          });
        }

        await tx.orderItem.create({
          data: {
            tenantId,
            orderId: order.id,
            menuItemId: menuItem.id,
            name: menuItem.name,
            qty: line.qty,
            unitPrice,
            notes: line.notes ?? null,
            modifiers: modifierSnapshots as unknown as Prisma.InputJsonValue,
            status: 'pending',
          },
        });
      }
      return this.buildView(tx, order);
    });
  }

  /** HU-03-04/10 · Editar un ítem: cantidad, estado (servido) o quitarlo (soft-delete). */
  async updateItem(
    tenantId: string,
    id: string,
    itemId: string,
    dto: UpdateOrderItemInput,
  ): Promise<OrderView> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const order = await this.find(tx, id);
      const item = await tx.orderItem.findFirst({
        where: { id: itemId, orderId: order.id, deletedAt: null },
      });
      if (!item) {
        throw new NotFoundException('Ítem de orden no encontrado');
      }

      if (dto.remove) {
        await tx.orderItem.update({
          where: { id: itemId },
          data: { deletedAt: new Date() },
        });
        return this.buildView(tx, order);
      }

      const data: Prisma.OrderItemUncheckedUpdateInput = {};
      if (dto.qty !== undefined) data.qty = dto.qty;
      if (dto.status !== undefined) {
        data.status = dto.status;
        // HU-03-10: marcar servido sella servedAt (habilita KPIs de tiempo de servicio).
        if (dto.status === 'served') data.servedAt = new Date();
      }
      await tx.orderItem.update({ where: { id: itemId }, data });
      return this.buildView(tx, order);
    });
  }

  /** HU-03-11 · Anular orden con razón obligatoria; libera la mesa. */
  async void(
    tenantId: string,
    id: string,
    dto: VoidOrderInput,
  ): Promise<OrderView> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const order = await this.find(tx, id);
      if (!VOIDABLE_STATUSES.has(order.status)) {
        throw new ConflictException(
          'No se puede anular una orden en este estado',
        );
      }
      const updated = await tx.order.update({
        where: { id: order.id },
        data: { status: 'void', voidReason: dto.reason },
      });
      await tx.diningTable.update({
        where: { id: order.tableId },
        data: { status: 'free' },
      });
      return this.buildView(tx, updated);
    });
  }

  private async find(tx: Tx, id: string): Promise<OrderRow> {
    const order = await tx.order.findFirst({
      where: { id, deletedAt: null },
    });
    if (!order) {
      throw new NotFoundException('Orden no encontrada');
    }
    return order;
  }

  private async buildView(tx: Tx, order: OrderRow): Promise<OrderView> {
    const items = await tx.orderItem.findMany({
      where: { orderId: order.id, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return toView(order, items);
  }
}
