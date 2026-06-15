import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma/prisma.service';
import { RecipesService } from '../catalog/recipes.service';

type Tx = Prisma.TransactionClient;
type CostingCloseRow = Prisma.CostingCloseGetPayload<object>;

// HU-06-01/03/04 · Costeo de un plato del menú en un período.
//  - ingredientCost: costo directo (BOM recursivo de la receta, vía RecipesService).
//  - cifPerUnit: parte indirecta (CIF) prorrateada por unidad vendida del período.
//  - fullCost = ingredientCost + cifPerUnit (costo total directo + indirecto).
//  - foodCostPct = ingredientCost / sellPrice · 100 (food cost teórico).
//  - marginPct = (sellPrice − fullCost) / sellPrice · 100 (margen sobre precio).
//  - contributionMargin = sellPrice − fullCost (margen unitario en PEN).
// Toda la moneda se devuelve como string `.toFixed(2)` (PEN).
export interface DishCostView {
  menuItemId: string;
  name: string;
  sellPrice: string;
  ingredientCost: string;
  unitsSold: number;
  cifPerUnit: string;
  fullCost: string;
  foodCostPct: string;
  marginPct: string;
  contributionMargin: string;
}

// HU-06-03 · Resultado del prorrateo de un período + el detalle por plato.
//  - allocationBase: base de distribución del CIF (esta versión = 'units' =
//    partes iguales por unidad vendida). Documentado para evolucionar a % ventas.
//  - cifPerUnit: factor común = totalCIF / totalUnits (0 si no hubo ventas).
export interface PeriodCostingView {
  period: string;
  totalCIF: string;
  totalUnits: number;
  cifPerUnit: string;
  allocationBase: 'units';
  dishes: DishCostView[];
}

// HU-06-05 · Sugerencia de precio para alcanzar un margen objetivo.
export interface SuggestPriceView {
  menuItemId: string;
  period: string;
  fullCost: string;
  targetMarginPct: string;
  suggestedPrice: string;
}

// HU-06-06 · Cierre de período mensual: cifras finales + snapshot del reporte.
export interface CostingCloseView {
  id: string;
  period: string;
  totalCIF: string;
  totalUnits: number;
  totalIngredientCost: string;
  totalRevenue: string;
  totalContribution: string;
  closedAt: string;
  userId: string | null;
  snapshot: PeriodCostingView;
}

// HU-06-07 · Comparativo costo real (salida de inventario) vs teórico (BOM por venta).
export interface CostVarianceView {
  period: string;
  theoreticalCost: string;
  realCost: string;
  variance: string;
  variancePct: string;
  byType: { waste: string; sale: string };
  note: string;
}

const HUNDRED = new Prisma.Decimal(100);

/**
 * HU-06-07 · Aclaración de la limitación del comparativo: hoy pagar una orden NO
 * descuenta stock automáticamente (el cobro no crea un movimiento `sale` de
 * consumo; el enlace POS↔inventario es una integración futura, fuera de alcance).
 * Por eso `realCost` refleja principalmente mermas + salidas manuales, no el
 * consumo teórico de cada venta — no debe leerse como "consumo real total".
 */
const COST_VARIANCE_NOTE =
  'realCost se calcula a partir de las salidas registradas en inventario ' +
  '(type sale/waste). Hoy pagar una orden NO descuenta stock automáticamente: ' +
  'el cobro no genera un movimiento de consumo (el enlace POS↔inventario es una ' +
  'integración futura, fuera del alcance de esta HU). Por eso realCost refleja ' +
  'principalmente mermas + salidas manuales y NO debe leerse como el consumo ' +
  'real total de todas las ventas; sirve para detectar mermas no registradas o ' +
  'porciones excesivas sobre las salidas que sí se registran.';

@Injectable()
export class CostingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recipes: RecipesService,
  ) {}

  /**
   * HU-06-01/03/04 · Costeo de todos los platos activos en un período.
   *
   * Prorrateo (HU-06-03): el CIF total del período (`Σ overhead_costs.amount`) se
   * reparte en **partes iguales por unidad vendida** (base de distribución =
   * `units`): `cifPerUnit = totalCIF / totalUnits`. `totalUnits` = suma de unidades
   * vendidas de TODOS los platos en el período; las unidades de un plato = `Σ qty`
   * de sus `order_items` cuyas ventas (`Sale`) están EMITIDAS (`issued`) con
   * `issuedAt` dentro del mes. Si no hubo ventas (`totalUnits = 0`) → `cifPerUnit = 0`.
   */
  async dishes(tenantId: string, period: string): Promise<PeriodCostingView> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const totalCIF = await this.totalCif(tx, period);
      const unitsByDish = await this.unitsSoldByDish(tx, period);
      const totalUnits = [...unitsByDish.values()].reduce((a, b) => a + b, 0);
      const cifPerUnit = totalUnits > 0 ? totalCIF.div(totalUnits) : NEW_ZERO();

      const menuItems = await tx.menuItem.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: { name: 'asc' },
      });

      const dishes: DishCostView[] = [];
      for (const item of menuItems) {
        const ingredientCost = await this.recipes.costPerYieldTx(
          tx,
          item.recipeId,
        );
        const unitsSold = unitsByDish.get(item.id) ?? 0;
        const fullCost = ingredientCost.add(cifPerUnit);
        const sellPrice = item.price;
        const foodCostPct = sellPrice.isZero()
          ? NEW_ZERO()
          : ingredientCost.div(sellPrice).mul(HUNDRED);
        const marginPct = sellPrice.isZero()
          ? NEW_ZERO()
          : sellPrice.sub(fullCost).div(sellPrice).mul(HUNDRED);
        dishes.push({
          menuItemId: item.id,
          name: item.name,
          sellPrice: sellPrice.toFixed(2),
          ingredientCost: ingredientCost.toFixed(2),
          unitsSold,
          cifPerUnit: cifPerUnit.toFixed(2),
          fullCost: fullCost.toFixed(2),
          foodCostPct: foodCostPct.toFixed(2),
          marginPct: marginPct.toFixed(2),
          contributionMargin: sellPrice.sub(fullCost).toFixed(2),
        });
      }

      return {
        period,
        totalCIF: totalCIF.toFixed(2),
        totalUnits,
        cifPerUnit: cifPerUnit.toFixed(2),
        allocationBase: 'units',
        dishes,
      };
    });
  }

  /**
   * HU-06-05 · Precio sugerido para un margen objetivo:
   * `suggestedPrice = fullCost / (1 − targetMarginPct/100)`. `targetMarginPct` en
   * [0, 99]. El `fullCost` (ingredientes + CIF prorrateado) se toma del mismo
   * período. Fórmula determinista — NO depende de ningún servicio de IA.
   */
  async suggestPrice(
    tenantId: string,
    menuItemId: string,
    targetMarginPct: number,
    period: string,
  ): Promise<SuggestPriceView> {
    if (targetMarginPct < 0 || targetMarginPct > 99) {
      throw new BadRequestException(
        'El margen objetivo debe estar entre 0 y 99',
      );
    }
    const periodView = await this.dishes(tenantId, period);
    const dish = periodView.dishes.find((d) => d.menuItemId === menuItemId);
    if (!dish) {
      throw new BadRequestException(
        'El plato no existe o no está activo en el período',
      );
    }
    const fullCost = new Prisma.Decimal(dish.fullCost);
    const target = new Prisma.Decimal(targetMarginPct);
    const factor = new Prisma.Decimal(1).sub(target.div(HUNDRED)); // 1 − m/100
    const suggested = fullCost.div(factor);
    return {
      menuItemId,
      period,
      fullCost: fullCost.toFixed(2),
      targetMarginPct: target.toFixed(2),
      suggestedPrice: suggested.toFixed(2),
    };
  }

  /**
   * HU-06-06 · Cierre de período mensual. Reutiliza `dishes()` (reporte de platos
   * del período) y agrega las cifras finales:
   *  - `totalCIF`, `totalUnits` = del reporte.
   *  - `totalIngredientCost = Σ unitsSold·ingredientCost` (costo directo de lo vendido).
   *  - `totalRevenue = Σ unitsSold·sellPrice`.
   *  - `totalContribution = Σ unitsSold·contributionMargin`.
   * Persiste un `CostingClose` con el reporte completo como `snapshot` (foto
   * histórica inmutable) y `userId` = quién cerró. El cierre NO es recerrable:
   * `@@unique([tenantId, period])` → segundo cierre del mismo mes lanza 409.
   */
  async closePeriod(
    tenantId: string,
    period: string,
    userId: string | null,
  ): Promise<CostingCloseView> {
    const report = await this.dishes(tenantId, period);

    let totalIngredientCost = NEW_ZERO();
    let totalRevenue = NEW_ZERO();
    let totalContribution = NEW_ZERO();
    for (const dish of report.dishes) {
      const units = new Prisma.Decimal(dish.unitsSold);
      totalIngredientCost = totalIngredientCost.add(
        units.mul(dish.ingredientCost),
      );
      totalRevenue = totalRevenue.add(units.mul(dish.sellPrice));
      totalContribution = totalContribution.add(
        units.mul(dish.contributionMargin),
      );
    }

    return this.prisma.runInTenant(tenantId, async (tx) => {
      const existing = await tx.costingClose.findFirst({ where: { period } });
      if (existing) {
        throw new ConflictException('El período ya está cerrado');
      }
      const row = await tx.costingClose.create({
        data: {
          tenantId,
          period,
          totalCIF: new Prisma.Decimal(report.totalCIF),
          totalUnits: report.totalUnits,
          totalIngredientCost,
          totalRevenue,
          totalContribution,
          snapshot: report as unknown as Prisma.InputJsonValue,
          userId,
        },
      });
      return closeToView(row);
    });
  }

  /** HU-06-06 · Lista los cierres del tenant (más reciente primero). */
  async listCloses(tenantId: string): Promise<CostingCloseView[]> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const rows = await tx.costingClose.findMany({
        orderBy: { period: 'desc' },
      });
      return rows.map(closeToView);
    });
  }

  /** HU-06-06 · Devuelve el cierre de un período; 404 si no existe. */
  async getClose(tenantId: string, period: string): Promise<CostingCloseView> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const row = await tx.costingClose.findFirst({ where: { period } });
      if (!row) {
        throw new NotFoundException('El período no está cerrado');
      }
      return closeToView(row);
    });
  }

  /**
   * HU-06-07 · Comparativo costo real vs teórico del período.
   *  - `theoreticalCost = Σ unitsSold·ingredientCost` (del reporte de platos = el
   *    costo de ingredientes que debió consumirse según el BOM por lo vendido).
   *  - `realCost` = salida valorizada de inventario = `Σ |qty|·ingredient.unitCost`
   *    sobre `inventory_movements` con `type ∈ {sale, waste}` y `createdAt` en el mes.
   *  - `variance = realCost − theoreticalCost`; `variancePct = variance/teórico·100`.
   *  - `byType` desglosa el real por tipo de movimiento.
   * LIMITACIÓN (ver COST_VARIANCE_NOTE): pagar una orden no descuenta stock aún,
   * por lo que `realCost` refleja mermas + salidas manuales, no el consumo de cada venta.
   */
  async costVariance(
    tenantId: string,
    period: string,
  ): Promise<CostVarianceView> {
    const report = await this.dishes(tenantId, period);
    let theoretical = NEW_ZERO();
    for (const dish of report.dishes) {
      theoretical = theoretical.add(
        new Prisma.Decimal(dish.unitsSold).mul(dish.ingredientCost),
      );
    }

    const { start, end } = monthRange(period);
    const byType = await this.prisma.runInTenant(tenantId, async (tx) => {
      const movements = await tx.inventoryMovement.findMany({
        where: {
          type: { in: ['sale', 'waste'] },
          createdAt: { gte: start, lt: end },
        },
        include: { ingredient: true },
      });
      let waste = NEW_ZERO();
      let sale = NEW_ZERO();
      for (const m of movements) {
        const valued = m.qty.abs().mul(m.ingredient.unitCost);
        if (m.type === 'waste') waste = waste.add(valued);
        else sale = sale.add(valued);
      }
      return { waste, sale };
    });

    const real = byType.waste.add(byType.sale);
    const variance = real.sub(theoretical);
    const variancePct = theoretical.isZero()
      ? NEW_ZERO()
      : variance.div(theoretical).mul(HUNDRED);

    return {
      period,
      theoreticalCost: theoretical.toFixed(2),
      realCost: real.toFixed(2),
      variance: variance.toFixed(2),
      variancePct: variancePct.toFixed(2),
      byType: { waste: byType.waste.toFixed(2), sale: byType.sale.toFixed(2) },
      note: COST_VARIANCE_NOTE,
    };
  }

  // --- helpers ---

  // HU-06-02/03 · CIF total del período = Σ amount de los costos indirectos vivos.
  private async totalCif(tx: Tx, period: string): Promise<Prisma.Decimal> {
    const rows = await tx.overheadCost.findMany({
      where: { period, deletedAt: null },
    });
    return rows.reduce((sum, r) => sum.add(r.amount), NEW_ZERO());
  }

  /**
   * Unidades vendidas por plato en el período: para cada `Sale` EMITIDA (`issued`)
   * con `issuedAt` dentro del mes, suma `qty` de los `order_items` vivos de su orden,
   * agrupando por `menuItemId`. Ignora las ventas anuladas (`void`). Devuelve un
   * Map menuItemId → unidades.
   */
  private async unitsSoldByDish(
    tx: Tx,
    period: string,
  ): Promise<Map<string, number>> {
    const { start, end } = monthRange(period);
    const sales = await tx.sale.findMany({
      where: { status: 'issued', issuedAt: { gte: start, lt: end } },
      select: { orderId: true },
    });
    const byDish = new Map<string, number>();
    if (sales.length === 0) {
      return byDish;
    }
    const orderIds = sales.map((s) => s.orderId);
    const items = await tx.orderItem.findMany({
      where: { orderId: { in: orderIds }, deletedAt: null },
      select: { menuItemId: true, qty: true },
    });
    for (const it of items) {
      byDish.set(it.menuItemId, (byDish.get(it.menuItemId) ?? 0) + it.qty);
    }
    return byDish;
  }
}

// Helpers libres (sin estado). Decimal cero nuevo (Decimal es mutable-friendly: se
// crea uno por uso para no compartir referencias).
function NEW_ZERO(): Prisma.Decimal {
  return new Prisma.Decimal(0);
}

// HU-06-06 · Mapea una fila de cierre a su vista (moneda como string; el snapshot
// se guardó como JSON del PeriodCostingView, se devuelve tipado).
function closeToView(row: CostingCloseRow): CostingCloseView {
  return {
    id: row.id,
    period: row.period,
    totalCIF: row.totalCIF.toFixed(2),
    totalUnits: row.totalUnits,
    totalIngredientCost: row.totalIngredientCost.toFixed(2),
    totalRevenue: row.totalRevenue.toFixed(2),
    totalContribution: row.totalContribution.toFixed(2),
    closedAt: row.closedAt.toISOString(),
    userId: row.userId,
    snapshot: row.snapshot as unknown as PeriodCostingView,
  };
}

// Rango [inicio, fin) del mes calendario `YYYY-MM` en UTC (las fechas de venta se
// guardan como timestamp; el corte mensual usa el primer día del mes y el del
// siguiente). Lanza si el formato es inválido.
function monthRange(period: string): { start: Date; end: Date } {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) {
    throw new BadRequestException('El período debe tener formato YYYY-MM');
  }
  const year = Number(match[1]);
  const month = Number(match[2]); // 1..12
  if (month < 1 || month > 12) {
    throw new BadRequestException('Mes inválido en el período');
  }
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start, end };
}
