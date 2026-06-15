import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type Ingredient, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma/prisma.service';
import {
  type CreateMovementInput,
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
  constructor(private readonly prisma: PrismaService) {}

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

      return movementToView(movement);
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
