import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma/prisma.service';
import { RecipesService } from '../catalog/recipes.service';

type Tx = Prisma.TransactionClient;

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

const HUNDRED = new Prisma.Decimal(100);

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
