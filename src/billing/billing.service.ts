import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma/prisma.service';
import { OrdersService, type OrderView } from '../pos/orders.service';
import { type PayOrderInput, type VoidSaleInput } from '../shared';

type Tx = Prisma.TransactionClient;
type SaleRow = Prisma.SaleGetPayload<object>;
type PaymentRow = Prisma.PaymentGetPayload<object>;
type OrderRow = Prisma.OrderGetPayload<object>;
type OrderItemRow = Prisma.OrderItemGetPayload<object>;

// Series por tipo de comprobante (correlativo por tenant+serie). Boleta = B001,
// factura = F001 (alineado con el frontend: settings.tax.boletaSerie/facturaSerie).
const SERIE_BOLETA = 'B001';
const SERIE_FACTURA = 'F001';

// Estados de orden desde los que se puede cobrar (cuenta viva, no cerrada).
const PAYABLE_ORDER_STATUSES = new Set(['open', 'sent_to_kitchen', 'served']);

// Línea de la pre-cuenta (preview, sin persistir). HU-04-01.
export interface PreBillItem {
  name: string;
  qty: number;
  unitPrice: string;
  lineTotal: string;
}

export interface PreBillView {
  orderId: string;
  tableCode: string;
  items: PreBillItem[];
  subtotal: string;
  igv: string;
  total: string;
}

// Ítem del ticket (espejo del SaleItem del frontend).
export interface SaleItemView {
  name: string;
  qty: number;
  unitPrice: string;
  total: string;
}

// Espejo del `Sale` del frontend (moneda como string). `date` = issuedAt ISO.
export interface SaleView {
  id: string;
  orderId: string;
  serie: string;
  number: number;
  docType: string;
  customer: string | null;
  customerDoc: string | null;
  date: string;
  tableLabel: string;
  items: SaleItemView[];
  subtotal: string;
  igv: string;
  total: string;
  method: string;
  payments: { method: string; amount: string }[];
  status: string;
}

// Totales (con IGV incluido en los precios) calculados desde los ítems vivos.
interface Totals {
  total: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  igv: Prisma.Decimal;
}

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
  ) {}

  /**
   * HU-04-01 · Pre-cuenta (preview, NO persiste). Calcula totales desde los
   * ítems de la orden con el IGV del tenant. La orden no debe estar cerrada.
   */
  async preBill(tenantId: string, orderId: string): Promise<PreBillView> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const order = await this.findOrder(tx, orderId);
      if (order.status === 'paid' || order.status === 'void') {
        throw new ConflictException(
          'La orden ya está cerrada (pagada o anulada)',
        );
      }
      const items = await this.liveItems(tx, order.id);
      const igvRate = await this.igvRate(tx, tenantId);
      const totals = this.computeTotals(items, igvRate);
      const table = await tx.diningTable.findFirst({
        where: { id: order.tableId },
      });
      return {
        orderId: order.id,
        tableCode: table?.code ?? '',
        items: items.map((it) => ({
          name: it.name,
          qty: it.qty,
          unitPrice: it.unitPrice.toFixed(2),
          lineTotal: it.unitPrice.mul(it.qty).toFixed(2),
        })),
        subtotal: totals.subtotal.toFixed(2),
        igv: totals.igv.toFixed(2),
        total: totals.total.toFixed(2),
      };
    });
  }

  /**
   * HU-04-02/04/05/06 · Cobrar: emite el ticket (serie+correlativo + IGV) y
   * registra los pagos en UNA transacción; cierra la orden (paid) y libera la
   * mesa (free). 409 si la orden no es cobrable o ya está pagada; 400 si los
   * pagos no cubren el total.
   */
  async pay(
    tenantId: string,
    orderId: string,
    dto: PayOrderInput,
  ): Promise<{ order: OrderView; sale: SaleView }> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const order = await this.findOrder(tx, orderId);
      if (order.status === 'paid') {
        throw new ConflictException('La orden ya fue cobrada');
      }
      if (!PAYABLE_ORDER_STATUSES.has(order.status)) {
        throw new ConflictException(
          'La orden no se puede cobrar en este estado',
        );
      }

      const items = await this.liveItems(tx, order.id);
      const igvRate = await this.igvRate(tx, tenantId);
      const totals = this.computeTotals(items, igvRate);

      const paid = dto.payments.reduce(
        (sum, p) => sum.add(new Prisma.Decimal(p.amount)),
        new Prisma.Decimal(0),
      );
      if (paid.lessThan(totals.total)) {
        throw new BadRequestException(
          'Los pagos no cubren el total del ticket',
        );
      }

      const serie = dto.docType === 'factura' ? SERIE_FACTURA : SERIE_BOLETA;
      const number = await this.nextCorrelative(tx, tenantId, serie);

      const sale = await tx.sale.create({
        data: {
          tenantId,
          orderId: order.id,
          serie,
          number,
          docType: dto.docType,
          customer: dto.customer ?? null,
          customerDoc: dto.customerDoc ?? null,
          subtotal: totals.subtotal,
          igv: totals.igv,
          total: totals.total,
          status: 'issued',
        },
      });
      await tx.payment.createMany({
        data: dto.payments.map((p) => ({
          tenantId,
          saleId: sale.id,
          method: p.method,
          amount: new Prisma.Decimal(p.amount),
        })),
      });

      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: { status: 'paid' },
      });
      await tx.diningTable.update({
        where: { id: order.tableId },
        data: { status: 'free' },
      });

      // Vista de la orden en la MISMA transacción (ya `paid`); reutiliza OrdersService.
      const orderView = await this.orders.buildView(tx, updatedOrder);
      const saleView = await this.buildSaleView(tx, sale);
      return { order: orderView, sale: saleView };
    });
  }

  /** HU-04-07 · Anular ticket con razón (manager/owner). issued → void. */
  async void(
    tenantId: string,
    saleId: string,
    dto: VoidSaleInput,
  ): Promise<SaleView> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const sale = await this.findSale(tx, saleId);
      if (sale.status !== 'issued') {
        throw new ConflictException(
          'El ticket no se puede anular en este estado',
        );
      }
      const updated = await tx.sale.update({
        where: { id: sale.id },
        data: { status: 'void', voidReason: dto.reason },
      });
      return this.buildSaleView(tx, updated);
    });
  }

  async list(tenantId: string): Promise<SaleView[]> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const sales = await tx.sale.findMany({ orderBy: { issuedAt: 'desc' } });
      return Promise.all(sales.map((s) => this.buildSaleView(tx, s)));
    });
  }

  async get(tenantId: string, saleId: string): Promise<SaleView> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const sale = await this.findSale(tx, saleId);
      return this.buildSaleView(tx, sale);
    });
  }

  // --- helpers ---

  private async findOrder(tx: Tx, id: string): Promise<OrderRow> {
    const order = await tx.order.findFirst({ where: { id, deletedAt: null } });
    if (!order) {
      throw new NotFoundException('Orden no encontrada');
    }
    return order;
  }

  private async findSale(tx: Tx, id: string): Promise<SaleRow> {
    const sale = await tx.sale.findFirst({ where: { id } });
    if (!sale) {
      throw new NotFoundException('Ticket no encontrado');
    }
    return sale;
  }

  private liveItems(tx: Tx, orderId: string): Promise<OrderItemRow[]> {
    return tx.orderItem.findMany({
      where: { orderId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async igvRate(tx: Tx, tenantId: string): Promise<number> {
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
    });
    return tenant.igvRate;
  }

  // Precios INCLUYEN IGV: total = Σ unitPrice·qty; subtotal = total/(1+igvRate);
  // igv = total − subtotal. Redondeo a 2 decimales (PEN).
  private computeTotals(items: OrderItemRow[], igvRate: number): Totals {
    let total = new Prisma.Decimal(0);
    for (const item of items) {
      total = total.add(item.unitPrice.mul(item.qty));
    }
    total = total.toDecimalPlaces(2);
    const subtotal = total
      .div(new Prisma.Decimal(1).add(igvRate))
      .toDecimalPlaces(2);
    const igv = total.sub(subtotal);
    return { total, subtotal, igv };
  }

  // Correlativo: (max number para tenant+serie) + 1; arranca en 1.
  private async nextCorrelative(
    tx: Tx,
    tenantId: string,
    serie: string,
  ): Promise<number> {
    const last = await tx.sale.findFirst({
      where: { tenantId, serie },
      orderBy: { number: 'desc' },
    });
    return (last?.number ?? 0) + 1;
  }

  private async buildSaleView(tx: Tx, sale: SaleRow): Promise<SaleView> {
    const payments = await tx.payment.findMany({
      where: { saleId: sale.id },
      orderBy: { createdAt: 'asc' },
    });
    const items = await this.liveItems(tx, sale.orderId);
    const order = await tx.order.findFirst({ where: { id: sale.orderId } });
    const table = order
      ? await tx.diningTable.findFirst({ where: { id: order.tableId } })
      : null;
    return {
      id: sale.id,
      orderId: sale.orderId,
      serie: sale.serie,
      number: sale.number,
      docType: sale.docType,
      customer: sale.customer,
      customerDoc: sale.customerDoc,
      date: sale.issuedAt.toISOString(),
      tableLabel: table ? `Mesa ${table.code}` : '',
      items: items.map((it) => ({
        name: it.name,
        qty: it.qty,
        unitPrice: it.unitPrice.toFixed(2),
        total: it.unitPrice.mul(it.qty).toFixed(2),
      })),
      subtotal: sale.subtotal.toFixed(2),
      igv: sale.igv.toFixed(2),
      total: sale.total.toFixed(2),
      method: this.firstMethod(payments),
      payments: payments.map((p) => ({
        method: p.method,
        amount: p.amount.toFixed(2),
      })),
      status: sale.status,
    };
  }

  private firstMethod(payments: PaymentRow[]): string {
    return payments[0]?.method ?? 'cash';
  }
}
