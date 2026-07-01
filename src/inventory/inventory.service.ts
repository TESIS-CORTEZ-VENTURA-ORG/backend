import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type Ingredient, Prisma } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../platform/prisma/prisma.service';
import {
  type CreateMovementInput,
  type IngredientCoverageResponse,
  type PriceTrendResponse,
  type UpdateInventoryLevelInput,
} from '../shared';

type MovementRow = Prisma.InventoryMovementGetPayload<{
  include: { ingredient: true };
}>;

// Umbral crítico = la mitad del mínimo (stock ≤ minStock·0.5 → 'critical').
const CRITICAL_FACTOR = new Prisma.Decimal('0.5');

/** Estado del stock frente a su mínimo de reorden (HU-05-01/10). */
export type StockStatus = 'ok' | 'low' | 'critical';

export interface StockView {
  ingredientId: string;
  name: string;
  unit: string;
  unitCost: string;
  stock: string;
  minStock: string;
  status: StockStatus;
}

// HU-05-01 · Línea del kardex. qty es un delta CON SIGNO (string para precisión).
export interface MovementView {
  id: string;
  ingredientId: string;
  ingredientName: string;
  type: string;
  qty: string;
  unit: string;
  note: string | null;
  reason: string | null;
  userId: string | null;
  createdAt: string;
}

// HU-05-10 · Insumo bajo el mínimo (alerta). deficit = minStock − stock (> 0).
export interface AlertView {
  ingredientId: string;
  name: string;
  unit: string;
  stock: string;
  minStock: string;
  deficit: string;
  status: StockStatus;
}

// HU-05-09 · Histórico de mermas + costo total perdido (Σ |qty|·unitCost).
export interface WasteHistoryView {
  items: MovementView[];
  totalWasteCost: string;
}

/** Clasifica el stock frente al mínimo: critical ≤ min·0.5; low < min; si no ok. */
function statusFor(
  stock: Prisma.Decimal,
  minStock: Prisma.Decimal,
): StockStatus {
  if (minStock.lte(0)) return 'ok'; // sin umbral configurado → nunca alerta
  if (stock.lte(minStock.mul(CRITICAL_FACTOR))) return 'critical';
  if (stock.lt(minStock)) return 'low';
  return 'ok';
}

function stockToView(i: Ingredient): StockView {
  return {
    ingredientId: i.id,
    name: i.name,
    unit: i.unit,
    unitCost: i.unitCost.toFixed(2),
    stock: i.stock.toFixed(3),
    minStock: i.minStock.toFixed(3),
    status: statusFor(i.stock, i.minStock),
  };
}

function movementToView(m: MovementRow): MovementView {
  return {
    id: m.id,
    ingredientId: m.ingredientId,
    ingredientName: m.ingredient.name,
    type: m.type,
    qty: m.qty.toFixed(3),
    unit: m.ingredient.unit,
    note: m.note,
    reason: m.reason,
    userId: m.userId,
    createdAt: m.createdAt.toISOString(),
  };
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** HU-05-01 · Stock actual (kardex) de cada insumo con su estado de alerta. */
  async listStock(tenantId: string): Promise<StockView[]> {
    const rows = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.ingredient.findMany({
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
      }),
    );
    return rows.map(stockToView);
  }

  /**
   * HU-05-01 · Movimientos (kardex) ordenados por fecha desc, opcionalmente
   * filtrados por insumo.
   */
  async listMovements(
    tenantId: string,
    ingredientId?: string,
  ): Promise<MovementView[]> {
    const rows = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.inventoryMovement.findMany({
        where: ingredientId ? { ingredientId } : {},
        include: { ingredient: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
    return rows.map(movementToView);
  }

  /**
   * HU-05-02/03/08 · Registrar un movimiento (entrada/salida/merma). En UNA
   * transacción: crea el movimiento (userId = JWT sub) y aplica el delta al stock
   * del insumo. La merma (waste) exige `reason` (HU-05-08). El stock no puede
   * quedar negativo (HU-05-03) → 400.
   */
  async createMovement(
    tenantId: string,
    userId: string,
    dto: CreateMovementInput,
  ): Promise<MovementView> {
    if (dto.type === 'waste' && !dto.reason) {
      throw new BadRequestException('La merma requiere una razón');
    }

    return this.prisma.runInTenant(tenantId, async (tx) => {
      const ingredient = await tx.ingredient.findFirst({
        where: { id: dto.ingredientId, deletedAt: null },
      });
      if (!ingredient) {
        throw new BadRequestException('El insumo no existe');
      }

      const delta = new Prisma.Decimal(dto.qty);
      const newStock = ingredient.stock.add(delta);
      if (newStock.lt(0)) {
        throw new BadRequestException('El stock no puede quedar negativo');
      }

      const movement = await tx.inventoryMovement.create({
        data: {
          tenantId,
          ingredientId: ingredient.id,
          type: dto.type,
          qty: delta,
          note: dto.note ?? null,
          reason: dto.reason ?? null,
          userId,
        },
        include: { ingredient: true },
      });

      await tx.ingredient.update({
        where: { id: ingredient.id },
        data: { stock: newStock },
      });

      // E10/HU-10-01 (trigger HU-05-10) · Notificación `low_stock` cuando el
      // movimiento CRUZA el umbral: stock previo ≥ minStock y nuevo < minStock.
      // Crossing-only (idempotente): si ya estaba por debajo no se re-notifica
      // (no hace spam en cada salida posterior). Broadcast (userId=null), en la
      // MISMA tx que el movimiento.
      await this.notifyIfCrossedLowStock(tx, tenantId, ingredient, newStock);

      return movementToView(movement);
    });
  }

  /**
   * E10/HU-10-01 · Emite una notificación `low_stock` (broadcast) cuando el
   * stock CRUZA de ≥ minStock (antes del movimiento) a < minStock (después). No
   * notifica si no hay umbral (minStock ≤ 0) ni si el stock ya estaba por debajo
   * (crossing-only → sin spam). `pre` es el insumo ANTES de aplicar el delta.
   */
  private async notifyIfCrossedLowStock(
    tx: Prisma.TransactionClient,
    tenantId: string,
    pre: Ingredient,
    newStock: Prisma.Decimal,
  ): Promise<void> {
    const min = pre.minStock;
    if (min.lte(0)) return; // sin umbral configurado → nunca alerta
    const crossed = pre.stock.gte(min) && newStock.lt(min);
    if (!crossed) return;

    const status = statusFor(newStock, min);
    await this.notifications.createTx(tx, tenantId, {
      userId: null, // broadcast: todos los del tenant
      type: 'low_stock',
      title: `Stock bajo: ${pre.name}`,
      body: `${pre.name} está en ${newStock.toFixed(3)} ${pre.unit} (mínimo ${min.toFixed(3)}).`,
      data: {
        ingredientId: pre.id,
        stock: newStock.toFixed(3),
        minStock: min.toFixed(3),
        status,
        href: '/inventory/alerts',
      },
    });
  }

  /** HU-05-10 · Configurar el mínimo de reorden (umbral de alerta) de un insumo. */
  async updateLevel(
    tenantId: string,
    ingredientId: string,
    dto: UpdateInventoryLevelInput,
  ): Promise<StockView> {
    const ingredient = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.ingredient.findFirst({ where: { id: ingredientId, deletedAt: null } }),
    );
    if (!ingredient) {
      throw new NotFoundException('Insumo no encontrado');
    }
    const updated = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.ingredient.update({
        where: { id: ingredientId },
        data: { minStock: dto.minStock },
      }),
    );
    return stockToView(updated);
  }

  /**
   * HU-05-10 · Alertas de stock bajo: insumos con stock < minStock, más críticos
   * primero (mayor déficit relativo). Solo considera insumos con mínimo > 0.
   */
  async listAlerts(tenantId: string): Promise<AlertView[]> {
    const rows = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.ingredient.findMany({ where: { deletedAt: null } }),
    );
    return (
      rows
        .filter((i) => i.minStock.gt(0) && i.stock.lt(i.minStock))
        .map((i) => ({
          ingredientId: i.id,
          name: i.name,
          unit: i.unit,
          stock: i.stock.toFixed(3),
          minStock: i.minStock.toFixed(3),
          deficit: i.minStock.sub(i.stock).toFixed(3),
          status: statusFor(i.stock, i.minStock),
        }))
        // Más crítico primero: mayor déficit absoluto encabeza.
        .sort((a, b) => Number(b.deficit) - Number(a.deficit))
    );
  }

  /**
   * HU-05-11 · Cobertura de stock: días estimados que durará el stock actual dado
   * el consumo promedio diario de los últimos 30 días (movimientos type='sale').
   * `daysLeft` es null cuando avgDailyConsumption = 0 (cobertura indefinida).
   * Usa `$queryRaw` para el `SUM(ABS(qty))` en la ventana fija (RLS FORCE activo).
   */
  async ingredientCoverage(
    tenantId: string,
    ingredientId: string,
  ): Promise<IngredientCoverageResponse> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const ingredient = await tx.ingredient.findFirst({
        where: { id: ingredientId, deletedAt: null },
        select: { id: true, stock: true },
      });
      if (!ingredient) {
        throw new NotFoundException('Insumo no encontrado');
      }

      // Consumption = sum of absolute qty for type='sale' in last 30 days.
      // Using $queryRaw for the ABS aggregate — Prisma ORM lacks SUM(ABS(...)).
      const rows = await tx.$queryRaw<{ total: string | null }[]>(Prisma.sql`
        SELECT SUM(ABS(qty))::text AS total
        FROM inventory_movements
        WHERE ingredient_id = ${ingredientId}::uuid
          AND type = 'sale'
          AND created_at >= NOW() - INTERVAL '30 days'
      `);

      const totalConsumed = new Prisma.Decimal(rows[0]?.total ?? '0');
      const BASE_DAYS = new Prisma.Decimal(30);
      const avgDaily = totalConsumed.div(BASE_DAYS);

      const daysLeft = avgDaily.gt(0)
        ? ingredient.stock.div(avgDaily).toFixed(1)
        : null;

      return {
        ingredientId: ingredient.id,
        currentStock: ingredient.stock.toFixed(3),
        avgDailyConsumption: avgDaily.toFixed(3),
        basedOnDays: 30,
        daysLeft,
      };
    });
  }

  /**
   * HU-05-12 · Historial de precios de compra de un insumo, descendente por fecha.
   * Se alimenta automáticamente al recepcionar cada OC (purchase-orders.service).
   * `limit` controla cuántos puntos devolver (default 12, max 50 según el schema).
   */
  async priceTrend(
    tenantId: string,
    ingredientId: string,
    limit: number,
  ): Promise<PriceTrendResponse> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const ingredient = await tx.ingredient.findFirst({
        where: { id: ingredientId, deletedAt: null },
        select: { id: true },
      });
      if (!ingredient) {
        throw new NotFoundException('Insumo no encontrado');
      }

      const rows = await tx.ingredientPriceHistory.findMany({
        where: { ingredientId },
        orderBy: { recordedAt: 'desc' },
        take: limit,
        select: { unitCost: true, recordedAt: true, source: true },
      });

      return rows.map((r) => ({
        recordedAt: r.recordedAt.toISOString(),
        unitCost: r.unitCost.toFixed(2),
        source: r.source as 'purchase_order' | 'manual',
      }));
    });
  }

  /**
   * HU-05-09 · Histórico de mermas (type='waste'), desc por fecha, con el costo
   * total perdido (Σ |qty|·unitCost).
   */
  async listWaste(tenantId: string): Promise<WasteHistoryView> {
    const rows = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.inventoryMovement.findMany({
        where: { type: 'waste' },
        include: { ingredient: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
    let total = new Prisma.Decimal(0);
    for (const m of rows) {
      total = total.add(m.qty.abs().mul(m.ingredient.unitCost));
    }
    return {
      items: rows.map(movementToView),
      totalWasteCost: total.toFixed(2),
    };
  }
}
