import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma/prisma.service';
import {
  type CreatePurchaseOrderInput,
  type ReceivePurchaseOrderInput,
} from '../shared';

type Tx = Prisma.TransactionClient;
type PurchaseOrderRow = Prisma.PurchaseOrderGetPayload<{
  include: { supplier: true; items: { include: { ingredient: true } } };
}>;

// HU-05-06: estados desde los que se puede recepcionar (la OC ya fue enviada).
const RECEIVABLE_STATUSES = new Set(['sent', 'partially_received']);
// HU-05-07: estados desde los que se puede cancelar (aún no movió inventario).
const CANCELLABLE_STATUSES = new Set(['draft', 'sent']);

export interface PurchaseOrderItemView {
  id: string;
  ingredientId: string;
  ingredientName: string;
  qtyOrdered: string;
  qtyReceived: string;
  unitCost: string;
  lineTotal: string;
}

export interface PurchaseOrderView {
  id: string;
  supplierId: string;
  supplierName: string;
  status: string;
  expectedAt: string | null;
  notes: string | null;
  items: PurchaseOrderItemView[];
  total: string;
}

function toView(po: PurchaseOrderRow): PurchaseOrderView {
  let total = new Prisma.Decimal(0);
  const items = po.items.map((item) => {
    const lineTotal = item.qtyOrdered.mul(item.unitCost);
    total = total.add(lineTotal);
    return {
      id: item.id,
      ingredientId: item.ingredientId,
      ingredientName: item.ingredient.name,
      qtyOrdered: item.qtyOrdered.toFixed(3),
      qtyReceived: item.qtyReceived.toFixed(3),
      unitCost: item.unitCost.toFixed(2),
      lineTotal: lineTotal.toFixed(2),
    };
  });
  return {
    id: po.id,
    supplierId: po.supplierId,
    supplierName: po.supplier.name,
    status: po.status,
    expectedAt: po.expectedAt ? po.expectedAt.toISOString() : null,
    notes: po.notes,
    items,
    total: total.toFixed(2),
  };
}

@Injectable()
export class PurchaseOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * HU-05-04 · Crear una OC (estado `draft`). Valida que el proveedor y cada
   * insumo existan (no borrados). Las líneas nacen con qtyReceived = 0.
   */
  async create(
    tenantId: string,
    dto: CreatePurchaseOrderInput,
  ): Promise<PurchaseOrderView> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const supplier = await tx.supplier.findFirst({
        where: { id: dto.supplierId, deletedAt: null },
      });
      if (!supplier) {
        throw new BadRequestException('El proveedor no existe');
      }
      for (const line of dto.items) {
        const ingredient = await tx.ingredient.findFirst({
          where: { id: line.ingredientId, deletedAt: null },
        });
        if (!ingredient) {
          throw new BadRequestException(
            `El insumo ${line.ingredientId} no existe`,
          );
        }
      }

      const po = await tx.purchaseOrder.create({
        data: {
          tenantId,
          supplierId: dto.supplierId,
          status: 'draft',
          notes: dto.notes ?? null,
          expectedAt: dto.expectedAt ? new Date(dto.expectedAt) : null,
          items: {
            create: dto.items.map((line) => ({
              tenantId,
              ingredientId: line.ingredientId,
              qtyOrdered: new Prisma.Decimal(line.qtyOrdered),
              unitCost: new Prisma.Decimal(line.unitCost),
            })),
          },
        },
      });
      return this.buildView(tx, po.id);
    });
  }

  async list(tenantId: string): Promise<PurchaseOrderView[]> {
    const rows = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.purchaseOrder.findMany({
        where: { deletedAt: null },
        include: {
          supplier: true,
          items: {
            include: { ingredient: true },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    );
    return rows.map(toView);
  }

  async get(tenantId: string, id: string): Promise<PurchaseOrderView> {
    return this.prisma.runInTenant(tenantId, (tx) => this.buildView(tx, id));
  }

  /**
   * HU-05-05 (solo estado) · Enviar la OC al proveedor: `draft → sent`. Cualquier
   * otro estado → 409.
   *
   * DIFERIDO (servicio externo): el envío real del email al proveedor con el PDF
   * adjunto requiere un servicio de correo (Resend) + render de PDF, igual que las
   * invitaciones de E01. Aquí solo se transiciona el estado; el dispatch se
   * conectará cuando exista el servicio de correo (E10).
   */
  async send(tenantId: string, id: string): Promise<PurchaseOrderView> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const po = await this.find(tx, id);
      if (po.status !== 'draft') {
        throw new ConflictException(
          'Solo se puede enviar una OC en borrador (draft)',
        );
      }
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: 'sent' },
      });
      return this.buildView(tx, po.id);
    });
  }

  /**
   * HU-05-06 · Recepcionar una OC (parcial o total). Solo permitido si la OC está
   * en {sent, partially_received} (else 409). En UNA transacción, por cada línea:
   * suma a qtyReceived (no puede exceder qtyOrdered → 400), crea un movimiento de
   * inventario `purchase` (qty = +recibido, igual forma que Inc 1), sube el stock
   * del insumo y fija su unitCost (último precio de compra). Recalcula el estado:
   * todas las líneas full → `received`; algo recibido → `partially_received`.
   */
  async receive(
    tenantId: string,
    userId: string,
    id: string,
    dto: ReceivePurchaseOrderInput,
  ): Promise<PurchaseOrderView> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const po = await this.find(tx, id);
      if (!RECEIVABLE_STATUSES.has(po.status)) {
        throw new ConflictException(
          'Solo se puede recepcionar una OC enviada o parcialmente recibida',
        );
      }

      const items = await tx.purchaseOrderItem.findMany({
        where: { purchaseOrderId: po.id },
      });
      const itemById = new Map(items.map((item) => [item.id, item]));

      for (const line of dto.items) {
        const item = itemById.get(line.itemId);
        if (!item) {
          throw new BadRequestException(
            `La línea ${line.itemId} no pertenece a esta OC`,
          );
        }
        const received = new Prisma.Decimal(line.qtyReceived);
        const newReceived = item.qtyReceived.add(received);
        if (newReceived.gt(item.qtyOrdered)) {
          throw new BadRequestException(
            `La cantidad recibida excede la ordenada para la línea ${item.id}`,
          );
        }

        // Acumular lo recibido en la línea de la OC.
        await tx.purchaseOrderItem.update({
          where: { id: item.id },
          data: { qtyReceived: newReceived },
        });

        // Movimiento de inventario `purchase` (delta positivo) — misma forma que
        // Inc 1 (InventoryService.createMovement): suma el delta al stock.
        await tx.inventoryMovement.create({
          data: {
            tenantId,
            ingredientId: item.ingredientId,
            type: 'purchase',
            qty: received,
            note: `Recepción OC ${po.id}`,
            userId,
          },
        });

        // Subir el stock del insumo y fijar el último precio de compra (unitCost).
        const ingredient = await tx.ingredient.findFirstOrThrow({
          where: { id: item.ingredientId },
        });
        await tx.ingredient.update({
          where: { id: item.ingredientId },
          data: {
            stock: ingredient.stock.add(received),
            unitCost: item.unitCost,
          },
        });

        // HU-05-12: register the purchase price in the history so the price-trend
        // endpoint has real data points. One row per received PO line, within the
        // same transaction that updates stock (atomicity guaranteed).
        await tx.ingredientPriceHistory.create({
          data: {
            tenantId,
            ingredientId: item.ingredientId,
            unitCost: item.unitCost,
            recordedAt: new Date(),
            source: 'purchase_order',
          },
        });

        // Reflejar el acumulado en el mapa para multi-línea del mismo insumo.
        itemById.set(item.id, { ...item, qtyReceived: newReceived });
      }

      // Recalcular el estado tras aplicar todas las recepciones.
      const finalItems = await tx.purchaseOrderItem.findMany({
        where: { purchaseOrderId: po.id },
      });
      const allReceived = finalItems.every((item) =>
        item.qtyReceived.gte(item.qtyOrdered),
      );
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: allReceived ? 'received' : 'partially_received' },
      });

      return this.buildView(tx, po.id);
    });
  }

  /**
   * HU-05-07 · Cancelar una OC. Solo permitido en {draft, sent} (una OC que ya
   * recibió algo movió inventario → no se puede cancelar → 409). → `cancelled`.
   */
  async cancel(tenantId: string, id: string): Promise<PurchaseOrderView> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const po = await this.find(tx, id);
      if (!CANCELLABLE_STATUSES.has(po.status)) {
        throw new ConflictException(
          'No se puede cancelar una OC ya recibida (parcial o total)',
        );
      }
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: 'cancelled' },
      });
      return this.buildView(tx, po.id);
    });
  }

  private async find(
    tx: Tx,
    id: string,
  ): Promise<Prisma.PurchaseOrderGetPayload<object>> {
    const po = await tx.purchaseOrder.findFirst({
      where: { id, deletedAt: null },
    });
    if (!po) {
      throw new NotFoundException('Orden de compra no encontrada');
    }
    return po;
  }

  private async buildView(tx: Tx, id: string): Promise<PurchaseOrderView> {
    const po = await tx.purchaseOrder.findFirst({
      where: { id, deletedAt: null },
      include: {
        supplier: true,
        items: {
          include: { ingredient: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!po) {
      throw new NotFoundException('Orden de compra no encontrada');
    }
    return toView(po);
  }
}
