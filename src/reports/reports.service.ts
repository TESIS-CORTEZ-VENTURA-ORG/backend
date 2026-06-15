import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma/prisma.service';
import { RecipesService } from '../catalog/recipes.service';
import { type SalesGroupBy } from '../shared';
import {
  lastNLimaDays,
  limaDayKey,
  limaDayStart,
  resolveWindow,
  type DateWindow,
} from './report-window.util';

type Tx = Prisma.TransactionClient;
type SaleRow = Prisma.SaleGetPayload<object>;
type PaymentRow = Prisma.PaymentGetPayload<object>;

// Métodos de pago soportados (mismo orden estable que el cierre Z de E04).
const PAYMENT_METHODS = ['cash', 'card', 'yape', 'plin'] as const;
type PaymentMethodKey = (typeof PAYMENT_METHODS)[number];

// Tipos de comprobante (alineados con E04).
const DOC_TYPES = ['boleta', 'factura'] as const;
type DocTypeKey = (typeof DOC_TYPES)[number];

// Estados de orden "viva" (cuenta abierta) — para ordersOpen/openTables.
const LIVE_ORDER_STATUSES = ['open', 'sent_to_kitchen', 'served'];
// Estados de ítem que cuentan como "en cocina" (HU-07-02).
const IN_KITCHEN_ITEM_STATUSES = ['pending', 'preparing'];

const HUNDRED = new Prisma.Decimal(100);
// Umbrales ABC/Pareto por revenue acumulado (HU-07-08, Menu Engineering / 80-20).
const ABC_A_MAX = new Prisma.Decimal(80);
const ABC_B_MAX = new Prisma.Decimal(95);

// HU-07-05 · Estado del stock frente a su mínimo de reorden (misma regla que E05
// InventoryService.statusFor; se replica aquí para no cruzar la frontera de módulos).
const CRITICAL_FACTOR = new Prisma.Decimal('0.5'); // crítico = stock ≤ minStock·0.5
export type StockStatus = 'ok' | 'low' | 'critical';

// HU-07-06 · Food cost objetivo de referencia (la UI resalta los platos que lo superen).
const TARGET_FOOD_COST_PCT = new Prisma.Decimal(30);

// HU-07-07 · Etiqueta para mermas sin razón registrada (agrupación de byReason).
const NO_REASON_LABEL = 'sin razón';

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

/**
 * Rango [inicio, fin) del mes calendario `YYYY-MM` en UTC (las fechas de venta se
 * guardan como timestamp; el corte mensual usa el primer día del mes y el del
 * siguiente). Igual que `CostingService.monthRange` (replicado: frontera de módulos).
 */
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
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

export type ByMethod = Record<PaymentMethodKey, string>;
export type ByDocType = Record<DocTypeKey, string>;

// HU-07-03 · Dashboard de cajero: caja del día (totales + por método de pago).
export interface CashierDashboard {
  date: string;
  salesCount: number;
  voidCount: number;
  totalCollected: string;
  byMethod: ByMethod;
  avgTicket: string;
}

// Plato más vendido (top N) — usado por los dashboards (sin contribución).
export interface TopDish {
  name: string;
  qty: number;
  revenue: string;
}

// HU-07-02 · Dashboard de gerente (operativo, foco en hoy).
export interface ManagerDashboard {
  date: string;
  salesToday: number;
  revenueToday: string;
  openTables: number;
  ordersOpen: number;
  itemsInKitchen: number;
  lowStockCount: number;
  topDishesToday: TopDish[];
}

// Plato del top con contribución (revenue − costo de ingredientes vendidos).
export interface TopDishWithContribution extends TopDish {
  contribution: string;
}

// HU-07-01 · Dashboard de admin (ejecutivo, KPIs financieros + operativos).
export interface AdminDashboard {
  date: string;
  revenueToday: string;
  revenue7d: string;
  ordersToday: number;
  avgTicket: string;
  grossMarginPct: string;
  topDishes: TopDishWithContribution[];
  lowStockCount: number;
  salesByDay7d: { day: string; revenue: string }[];
}

// HU-07-04 · Punto de la serie del reporte de ventas (clave según groupBy).
export interface SalesSeriesPoint {
  key: string;
  revenue: string;
  count: number;
}

// HU-07-04 · Reporte de ventas en una ventana (totales + desgloses + serie).
export interface SalesReport {
  from: string;
  to: string;
  totalRevenue: string;
  salesCount: number;
  avgTicket: string;
  byMethod: ByMethod;
  byDocType: ByDocType;
  series: SalesSeriesPoint[];
}

// HU-07-08 · Una línea del análisis Pareto/ABC.
export interface ParetoDish {
  name: string;
  qty: number;
  revenue: string;
  revenuePct: string;
  cumulativePct: string;
  abcClass: 'A' | 'B' | 'C';
}

export interface ParetoReport {
  items: ParetoDish[];
  totalRevenue: string;
}

// HU-07-05 · Una línea del reporte de inventario (valoración del stock actual).
export interface InventoryReportItem {
  ingredientId: string;
  name: string;
  unit: string;
  stock: string; // .toFixed(3)
  minStock: string; // .toFixed(3)
  unitCost: string; // .toFixed(2)
  stockValue: string; // stock·unitCost (.toFixed(2))
  status: StockStatus;
}

// HU-07-05 · Reporte de inventario: valoración total + alertas + detalle por insumo.
export interface InventoryReport {
  generatedAt: string;
  totalSkus: number;
  totalStockValue: string;
  lowStockCount: number;
  criticalCount: number;
  items: InventoryReportItem[];
}

// HU-07-06 · Una línea del reporte de food cost (food cost % por plato).
export interface FoodCostDish {
  name: string;
  sellPrice: string;
  ingredientCost: string;
  foodCostPct: string;
  unitsSold: number;
  revenue: string;
}

// HU-07-06 · Reporte de food cost: % global + objetivo + detalle por plato.
export interface FoodCostReport {
  period: string;
  overallFoodCostPct: string;
  targetFoodCostPct: string;
  dishes: FoodCostDish[];
}

// HU-07-07 · Merma agregada por insumo / por razón (qty = magnitud, cost = PEN).
export interface WasteByIngredient {
  ingredientId: string;
  name: string;
  qty: string;
  cost: string;
}
export interface WasteByReason {
  reason: string;
  qty: string;
  cost: string;
}
// HU-07-07 · Una merma del detalle (kardex de salidas type='waste').
export interface WasteMovement {
  id: string;
  ingredientId: string;
  ingredientName: string;
  qty: string; // magnitud .toFixed(3)
  unit: string;
  reason: string | null;
  createdAt: string;
}
// HU-07-07 · Reporte de mermas en una ventana: totales + desgloses + detalle.
export interface WasteReport {
  from: string;
  to: string;
  totalWasteQty: string;
  totalWasteCost: string;
  byIngredient: WasteByIngredient[];
  byReason: WasteByReason[];
  movements: WasteMovement[];
}

// Agregado interno de un plato vendido en la ventana.
interface DishAgg {
  menuItemId: string;
  name: string;
  qty: number;
  revenue: Prisma.Decimal;
}

/**
 * E07 · Reportes y dashboards (READ-ONLY). No crea tablas: agrega las ventas
 * EMITIDAS (`Sale.status='issued'`) y sus pagos/ítems en una ventana de fechas.
 * Reutiliza datos de E04 (sales/payments), E03 (orders/order_items/tables) y E05
 * (ingredients) leyéndolos vía `runInTenant` (sin importar sus servicios). Sólo se
 * inyecta `RecipesService` (exportado por CatalogModule, igual que en E06) para el
 * costo de ingredientes del margen/contribución. Moneda como string `.toFixed(2)`.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recipes: RecipesService,
  ) {}

  /**
   * HU-07-03 · Dashboard del cajero: caja del día. Agrega las ventas emitidas en
   * la ventana (default = hoy en Lima): total cobrado, desglose por método de
   * pago, conteo de tickets, anulaciones y ticket promedio.
   */
  async cashierDashboard(
    tenantId: string,
    fromIso?: string,
    toIso?: string,
  ): Promise<CashierDashboard> {
    const window = resolveWindow(fromIso, toIso);
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const issued = await this.issuedSales(tx, window);
      const voidCount = await this.voidCount(tx, window);
      const byMethod = this.sumByMethod(issued);
      const totalCollected = this.sumTotals(issued);
      return {
        date: window.from.toISOString(),
        salesCount: issued.length,
        voidCount,
        totalCollected: totalCollected.toFixed(2),
        byMethod: this.byMethodToStrings(byMethod),
        avgTicket: this.avg(totalCollected, issued.length).toFixed(2),
      };
    });
  }

  /**
   * HU-07-02 · Dashboard del gerente (operativo): ventas/ingresos de hoy, mesas
   * ocupadas, órdenes abiertas, ítems en cocina (pending+preparing), alertas de
   * stock bajo y top 5 platos del día.
   */
  async managerDashboard(
    tenantId: string,
    fromIso?: string,
    toIso?: string,
  ): Promise<ManagerDashboard> {
    const window = resolveWindow(fromIso, toIso);
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const issued = await this.issuedSales(tx, window);
      const dishes = await this.dishAggregates(tx, issued);
      const topDishesToday = this.topDishes(dishes, 5).map((d) => ({
        name: d.name,
        qty: d.qty,
        revenue: d.revenue.toFixed(2),
      }));
      const [openTables, ordersOpen, itemsInKitchen, lowStockCount] =
        await Promise.all([
          this.openTablesCount(tx),
          this.openOrdersCount(tx),
          this.itemsInKitchenCount(tx),
          this.lowStockCount(tx),
        ]);
      return {
        date: window.from.toISOString(),
        salesToday: issued.length,
        revenueToday: this.sumTotals(issued).toFixed(2),
        openTables,
        ordersOpen,
        itemsInKitchen,
        lowStockCount,
        topDishesToday,
      };
    });
  }

  /**
   * HU-07-01 · Dashboard del admin (ejecutivo): ingresos hoy y de los últimos 7
   * días, órdenes/ticket promedio de hoy, margen bruto del período, top 5 platos
   * con contribución, alertas de stock bajo y la serie de ventas por día (7d).
   */
  async adminDashboard(
    tenantId: string,
    fromIso?: string,
    toIso?: string,
  ): Promise<AdminDashboard> {
    const window = resolveWindow(fromIso, toIso);
    const now = new Date();
    const last7 = lastNLimaDays(7, now);
    // Ventana de 7 días: desde la medianoche local del primer día hasta ahora.
    const week: DateWindow = { from: limaDayStart(last7[0]), to: now };
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const issuedToday = await this.issuedSales(tx, window);
      const issued7d = await this.issuedSales(tx, week);
      const revenueToday = this.sumTotals(issuedToday);

      const dishesToday = await this.dishAggregates(tx, issuedToday);
      const topDishes = await this.topDishesWithContribution(
        tx,
        this.topDishes(dishesToday, 5),
      );

      // Margen bruto del período (hoy): (subtotal − COGS) / subtotal · 100.
      const grossMarginPct = await this.grossMarginPct(tx, issuedToday);

      // Serie de los últimos 7 días en Lima (revenue por día; días sin venta = 0).
      const revenueByDay = this.sumTotalsByDay(issued7d);
      const salesByDay7d = last7.map((day) => ({
        day,
        revenue: (revenueByDay.get(day) ?? new Prisma.Decimal(0)).toFixed(2),
      }));
      const lowStockCount = await this.lowStockCount(tx);

      return {
        date: window.from.toISOString(),
        revenueToday: revenueToday.toFixed(2),
        revenue7d: this.sumTotals(issued7d).toFixed(2),
        ordersToday: issuedToday.length,
        avgTicket: this.avg(revenueToday, issuedToday.length).toFixed(2),
        grossMarginPct: grossMarginPct.toFixed(2),
        topDishes,
        lowStockCount,
        salesByDay7d,
      };
    });
  }

  /**
   * HU-07-04 · Reporte de ventas en una ventana: total, conteo, ticket promedio,
   * desglose por método y por tipo de doc, y la serie agrupada por `groupBy`
   * (`day` por defecto / `method` / `docType`).
   */
  async salesReport(
    tenantId: string,
    fromIso?: string,
    toIso?: string,
    groupBy: SalesGroupBy = 'day',
  ): Promise<SalesReport> {
    const window = resolveWindow(fromIso, toIso);
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const issued = await this.issuedSales(tx, window);
      const total = this.sumTotals(issued);
      const byMethod = this.sumByMethod(issued);
      const byDocType = this.sumByDocType(issued);
      return {
        from: window.from.toISOString(),
        to: window.to.toISOString(),
        totalRevenue: total.toFixed(2),
        salesCount: issued.length,
        avgTicket: this.avg(total, issued.length).toFixed(2),
        byMethod: this.byMethodToStrings(byMethod),
        byDocType: this.byDocTypeToStrings(byDocType),
        series: this.buildSeries(issued, byMethod, byDocType, groupBy),
      };
    });
  }

  /**
   * HU-07-08 · Análisis Pareto/ABC de platos por revenue en la ventana. Ordena
   * desc por revenue, calcula `revenuePct` y `cumulativePct`, y asigna la clase
   * ABC: A hasta 80% acumulado, B hasta 95%, C el resto.
   */
  async paretoDishes(
    tenantId: string,
    fromIso?: string,
    toIso?: string,
  ): Promise<ParetoReport> {
    const window = resolveWindow(fromIso, toIso);
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const issued = await this.issuedSales(tx, window);
      const dishes = await this.dishAggregates(tx, issued);
      const sorted = [...dishes].sort((a, b) => {
        const diff = b.revenue.comparedTo(a.revenue);
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
      });
      const totalRevenue = sorted.reduce(
        (sum, d) => sum.add(d.revenue),
        new Prisma.Decimal(0),
      );

      let cumulative = new Prisma.Decimal(0);
      const items: ParetoDish[] = sorted.map((d) => {
        const revenuePct = totalRevenue.isZero()
          ? new Prisma.Decimal(0)
          : d.revenue.div(totalRevenue).mul(HUNDRED);
        cumulative = cumulative.add(revenuePct);
        return {
          name: d.name,
          qty: d.qty,
          revenue: d.revenue.toFixed(2),
          revenuePct: revenuePct.toFixed(2),
          cumulativePct: cumulative.toFixed(2),
          abcClass: this.abcClass(cumulative),
        };
      });

      return { items, totalRevenue: totalRevenue.toFixed(2) };
    });
  }

  /**
   * HU-07-05 · Reporte de inventario: valoración del stock ACTUAL (no hay snapshots
   * históricos por fecha en el kardex; la "fecha de corte" es el instante de
   * generación). Por cada insumo vivo: stock, costo unitario, valor (stock·unitCost)
   * y estado de alerta (misma regla que E05). Totales: nº de SKUs, valor total del
   * stock, conteo de bajos (`minStock>0 && stock<minStock`) y de críticos.
   */
  async inventoryReport(tenantId: string): Promise<InventoryReport> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const rows = await tx.ingredient.findMany({
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
      });
      let totalStockValue = new Prisma.Decimal(0);
      let lowStockCount = 0;
      let criticalCount = 0;
      const items: InventoryReportItem[] = rows.map((i) => {
        const stockValue = i.stock.mul(i.unitCost);
        totalStockValue = totalStockValue.add(stockValue);
        const status = statusFor(i.stock, i.minStock);
        if (status === 'low' || status === 'critical') lowStockCount += 1;
        if (status === 'critical') criticalCount += 1;
        return {
          ingredientId: i.id,
          name: i.name,
          unit: i.unit,
          stock: i.stock.toFixed(3),
          minStock: i.minStock.toFixed(3),
          unitCost: i.unitCost.toFixed(2),
          stockValue: stockValue.toFixed(2),
          status,
        };
      });
      return {
        generatedAt: new Date().toISOString(),
        totalSkus: rows.length,
        totalStockValue: totalStockValue.toFixed(2),
        lowStockCount,
        criticalCount,
        items,
      };
    });
  }

  /**
   * HU-07-06 · Reporte de food cost del período (`YYYY-MM`): food cost % global y
   * por plato. Por plato: `ingredientCost` (BOM recursivo, vía RecipesService),
   * `sellPrice`, `foodCostPct = ingredientCost/sellPrice·100`, `unitsSold` (Σ qty de
   * los `order_items` de ventas `issued` del mes) y `revenue = sellPrice·unitsSold`.
   * `overallFoodCostPct = Σ(ingredientCost·unitsSold) / Σ revenue · 100`. Ordena los
   * platos desc por `foodCostPct` (ranking; desempate por nombre).
   */
  async foodCostReport(
    tenantId: string,
    period: string,
  ): Promise<FoodCostReport> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const unitsByDish = await this.unitsSoldByDish(tx, period);
      const menuItems = await tx.menuItem.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: { name: 'asc' },
      });

      let totalIngredientCost = new Prisma.Decimal(0);
      let totalRevenue = new Prisma.Decimal(0);
      const dishes: FoodCostDish[] = [];
      for (const item of menuItems) {
        const ingredientCost = await this.recipes.costPerYieldTx(
          tx,
          item.recipeId,
        );
        const unitsSold = unitsByDish.get(item.id) ?? 0;
        const sellPrice = item.price;
        const revenue = sellPrice.mul(unitsSold);
        const foodCostPct = sellPrice.isZero()
          ? new Prisma.Decimal(0)
          : ingredientCost.div(sellPrice).mul(HUNDRED);
        totalIngredientCost = totalIngredientCost.add(
          ingredientCost.mul(unitsSold),
        );
        totalRevenue = totalRevenue.add(revenue);
        dishes.push({
          name: item.name,
          sellPrice: sellPrice.toFixed(2),
          ingredientCost: ingredientCost.toFixed(2),
          foodCostPct: foodCostPct.toFixed(2),
          unitsSold,
          revenue: revenue.toFixed(2),
        });
      }
      dishes.sort((a, b) => {
        const diff = Number(b.foodCostPct) - Number(a.foodCostPct);
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
      });

      const overall = totalRevenue.isZero()
        ? new Prisma.Decimal(0)
        : totalIngredientCost.div(totalRevenue).mul(HUNDRED);
      return {
        period,
        overallFoodCostPct: overall.toFixed(2),
        targetFoodCostPct: TARGET_FOOD_COST_PCT.toFixed(2),
        dishes,
      };
    });
  }

  /**
   * HU-07-07 · Reporte de mermas en la ventana (`inventory_movements.type='waste'`
   * con `createdAt ∈ [from, to]`). Por cada merma el costo = `|qty|·ingredient.unitCost`
   * (igual que E05). Agrega por insumo (`byIngredient`) y por razón (`byReason`),
   * ambos desc por costo, y devuelve el detalle (`movements`, desc por fecha). `qty`
   * se reporta siempre como magnitud (`|qty|`).
   */
  async wasteReport(
    tenantId: string,
    fromIso?: string,
    toIso?: string,
  ): Promise<WasteReport> {
    const window = resolveWindow(fromIso, toIso);
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const rows = await tx.inventoryMovement.findMany({
        where: {
          type: 'waste',
          createdAt: { gte: window.from, lte: window.to },
        },
        include: { ingredient: true },
        orderBy: { createdAt: 'desc' },
      });

      let totalQty = new Prisma.Decimal(0);
      let totalCost = new Prisma.Decimal(0);
      const byIngredient = new Map<
        string,
        { name: string; qty: Prisma.Decimal; cost: Prisma.Decimal }
      >();
      const byReason = new Map<
        string,
        { qty: Prisma.Decimal; cost: Prisma.Decimal }
      >();
      const movements: WasteMovement[] = [];

      for (const m of rows) {
        const qty = m.qty.abs();
        const cost = qty.mul(m.ingredient.unitCost);
        totalQty = totalQty.add(qty);
        totalCost = totalCost.add(cost);

        const ing = byIngredient.get(m.ingredientId) ?? {
          name: m.ingredient.name,
          qty: new Prisma.Decimal(0),
          cost: new Prisma.Decimal(0),
        };
        ing.qty = ing.qty.add(qty);
        ing.cost = ing.cost.add(cost);
        byIngredient.set(m.ingredientId, ing);

        const reasonKey = m.reason ?? NO_REASON_LABEL;
        const rsn = byReason.get(reasonKey) ?? {
          qty: new Prisma.Decimal(0),
          cost: new Prisma.Decimal(0),
        };
        rsn.qty = rsn.qty.add(qty);
        rsn.cost = rsn.cost.add(cost);
        byReason.set(reasonKey, rsn);

        movements.push({
          id: m.id,
          ingredientId: m.ingredientId,
          ingredientName: m.ingredient.name,
          qty: qty.toFixed(3),
          unit: m.ingredient.unit,
          reason: m.reason,
          createdAt: m.createdAt.toISOString(),
        });
      }

      return {
        from: window.from.toISOString(),
        to: window.to.toISOString(),
        totalWasteQty: totalQty.toFixed(3),
        totalWasteCost: totalCost.toFixed(2),
        byIngredient: [...byIngredient.entries()]
          .map(([ingredientId, v]) => ({
            ingredientId,
            name: v.name,
            qty: v.qty.toFixed(3),
            cost: v.cost.toFixed(2),
          }))
          .sort((a, b) => Number(b.cost) - Number(a.cost)),
        byReason: [...byReason.entries()]
          .map(([reason, v]) => ({
            reason,
            qty: v.qty.toFixed(3),
            cost: v.cost.toFixed(2),
          }))
          .sort((a, b) => Number(b.cost) - Number(a.cost)),
        movements,
      };
    });
  }

  // --- helpers de datos (lectura directa, sin cruzar de módulo) ---

  // Ventas EMITIDAS (issued) en la ventana, con sus pagos. Excluye anuladas.
  private issuedSales(
    tx: Tx,
    window: DateWindow,
  ): Promise<(SaleRow & { payments: PaymentRow[] })[]> {
    return tx.sale.findMany({
      where: {
        status: 'issued',
        issuedAt: { gte: window.from, lte: window.to },
      },
      include: { payments: true },
      orderBy: { issuedAt: 'asc' },
    });
  }

  /**
   * HU-07-06 · Unidades vendidas por plato en el período `YYYY-MM`: para cada `Sale`
   * EMITIDA (`issued`) con `issuedAt` dentro del mes, suma `qty` de los `order_items`
   * vivos de su orden, agrupando por `menuItemId`. Ignora ventas anuladas (`void`).
   * Misma definición que `CostingService.unitsSoldByDish` (replicada: frontera de módulos).
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
    if (sales.length === 0) return byDish;
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

  private async voidCount(tx: Tx, window: DateWindow): Promise<number> {
    return tx.sale.count({
      where: {
        status: 'void',
        issuedAt: { gte: window.from, lte: window.to },
      },
    });
  }

  // Agrega los ítems vivos de las órdenes de las ventas emitidas, por plato.
  private async dishAggregates(tx: Tx, sales: SaleRow[]): Promise<DishAgg[]> {
    if (sales.length === 0) return [];
    const orderIds = sales.map((s) => s.orderId);
    const items = await tx.orderItem.findMany({
      where: { orderId: { in: orderIds }, deletedAt: null },
    });
    const byDish = new Map<string, DishAgg>();
    for (const it of items) {
      const agg = byDish.get(it.menuItemId) ?? {
        menuItemId: it.menuItemId,
        name: it.name,
        qty: 0,
        revenue: new Prisma.Decimal(0),
      };
      agg.qty += it.qty;
      agg.revenue = agg.revenue.add(it.unitPrice.mul(it.qty));
      byDish.set(it.menuItemId, agg);
    }
    return [...byDish.values()];
  }

  // Top N platos por revenue (desc; desempate por nombre para estabilidad).
  private topDishes(dishes: DishAgg[], n: number): DishAgg[] {
    return [...dishes]
      .sort((a, b) => {
        const diff = b.revenue.comparedTo(a.revenue);
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
      })
      .slice(0, n);
  }

  // Añade la contribución (revenue − Σ costo de ingredientes·qty) a cada top dish.
  private async topDishesWithContribution(
    tx: Tx,
    dishes: DishAgg[],
  ): Promise<TopDishWithContribution[]> {
    const result: TopDishWithContribution[] = [];
    for (const d of dishes) {
      const unitCost = await this.ingredientUnitCost(tx, d.menuItemId);
      const contribution = d.revenue.sub(unitCost.mul(d.qty));
      result.push({
        name: d.name,
        qty: d.qty,
        revenue: d.revenue.toFixed(2),
        contribution: contribution.toFixed(2),
      });
    }
    return result;
  }

  // Costo de ingredientes por unidad de un plato (BOM recursivo vía RecipesService).
  // 0 si el plato fue borrado o no tiene receta resoluble.
  private async ingredientUnitCost(
    tx: Tx,
    menuItemId: string,
  ): Promise<Prisma.Decimal> {
    const menuItem = await tx.menuItem.findFirst({
      where: { id: menuItemId },
    });
    if (!menuItem) return new Prisma.Decimal(0);
    return this.recipes.costPerYieldTx(tx, menuItem.recipeId);
  }

  // HU-07-01 · Margen bruto del período: (Σ subtotal − Σ COGS) / Σ subtotal · 100.
  // COGS = Σ por plato (costo de ingredientes/unidad · unidades vendidas). El
  // subtotal (sin IGV) de cada venta ya está persistido en `Sale`.
  private async grossMarginPct(
    tx: Tx,
    sales: SaleRow[],
  ): Promise<Prisma.Decimal> {
    const subtotal = sales.reduce(
      (sum, s) => sum.add(s.subtotal),
      new Prisma.Decimal(0),
    );
    if (subtotal.isZero()) return new Prisma.Decimal(0);
    const dishes = await this.dishAggregates(tx, sales);
    let cogs = new Prisma.Decimal(0);
    for (const d of dishes) {
      const unitCost = await this.ingredientUnitCost(tx, d.menuItemId);
      cogs = cogs.add(unitCost.mul(d.qty));
    }
    return subtotal.sub(cogs).div(subtotal).mul(HUNDRED);
  }

  // Mesas ocupadas (no libres) y no borradas (HU-07-02).
  private openTablesCount(tx: Tx): Promise<number> {
    return tx.diningTable.count({
      where: { deletedAt: null, status: { not: 'free' } },
    });
  }

  // Órdenes con cuenta abierta (open/sent_to_kitchen/served).
  private openOrdersCount(tx: Tx): Promise<number> {
    return tx.order.count({
      where: { deletedAt: null, status: { in: LIVE_ORDER_STATUSES } },
    });
  }

  // Ítems en cocina = pending + preparing, vivos, de órdenes no cerradas.
  private itemsInKitchenCount(tx: Tx): Promise<number> {
    return tx.orderItem.count({
      where: {
        deletedAt: null,
        status: { in: IN_KITCHEN_ITEM_STATUSES },
        order: { deletedAt: null, status: { in: LIVE_ORDER_STATUSES } },
      },
    });
  }

  // HU-05-10 · Insumos bajo el mínimo de reorden (minStock>0 && stock<minStock).
  // Igual que InventoryService.listAlerts: se compara en JS (no hay field-ref de
  // columna a columna sin el preview feature) sobre los insumos con mínimo > 0.
  private async lowStockCount(tx: Tx): Promise<number> {
    const rows = await tx.ingredient.findMany({
      where: { deletedAt: null, minStock: { gt: 0 } },
      select: { stock: true, minStock: true },
    });
    return rows.filter((i) => i.stock.lt(i.minStock)).length;
  }

  // --- helpers de agregación (puros sobre las filas ya cargadas) ---

  private sumTotals(sales: SaleRow[]): Prisma.Decimal {
    return sales.reduce((sum, s) => sum.add(s.total), new Prisma.Decimal(0));
  }

  private sumByMethod(
    sales: (SaleRow & { payments: PaymentRow[] })[],
  ): Record<PaymentMethodKey, Prisma.Decimal> {
    const byMethod = this.emptyByMethod();
    for (const sale of sales) {
      for (const payment of sale.payments) {
        if (this.isPaymentMethod(payment.method)) {
          byMethod[payment.method] = byMethod[payment.method].add(
            payment.amount,
          );
        }
      }
    }
    return byMethod;
  }

  private sumByDocType(sales: SaleRow[]): Record<DocTypeKey, Prisma.Decimal> {
    const byDocType = this.emptyByDocType();
    for (const sale of sales) {
      if (this.isDocType(sale.docType)) {
        byDocType[sale.docType] = byDocType[sale.docType].add(sale.total);
      }
    }
    return byDocType;
  }

  // Revenue por día local (Lima) → Map dayKey → Decimal.
  private sumTotalsByDay(sales: SaleRow[]): Map<string, Prisma.Decimal> {
    const byDay = new Map<string, Prisma.Decimal>();
    for (const sale of sales) {
      const key = limaDayKey(sale.issuedAt);
      byDay.set(key, (byDay.get(key) ?? new Prisma.Decimal(0)).add(sale.total));
    }
    return byDay;
  }

  // Serie del reporte de ventas según el groupBy.
  private buildSeries(
    sales: (SaleRow & { payments: PaymentRow[] })[],
    byMethod: Record<PaymentMethodKey, Prisma.Decimal>,
    byDocType: Record<DocTypeKey, Prisma.Decimal>,
    groupBy: SalesGroupBy,
  ): SalesSeriesPoint[] {
    if (groupBy === 'method') {
      // count = nº de pagos de ese método (un ticket mixto cuenta en cada método).
      const counts = this.countPaymentsByMethod(sales);
      return PAYMENT_METHODS.map((key) => ({
        key,
        revenue: byMethod[key].toFixed(2),
        count: counts[key],
      }));
    }
    if (groupBy === 'docType') {
      const counts = this.countByDocType(sales);
      return DOC_TYPES.map((key) => ({
        key,
        revenue: byDocType[key].toFixed(2),
        count: counts[key],
      }));
    }
    // groupBy === 'day' → por día local (Lima), ascendente.
    const revenueByDay = new Map<string, Prisma.Decimal>();
    const countByDay = new Map<string, number>();
    for (const sale of sales) {
      const key = limaDayKey(sale.issuedAt);
      revenueByDay.set(
        key,
        (revenueByDay.get(key) ?? new Prisma.Decimal(0)).add(sale.total),
      );
      countByDay.set(key, (countByDay.get(key) ?? 0) + 1);
    }
    return [...revenueByDay.keys()].sort().map((key) => ({
      key,
      revenue: (revenueByDay.get(key) ?? new Prisma.Decimal(0)).toFixed(2),
      count: countByDay.get(key) ?? 0,
    }));
  }

  private countPaymentsByMethod(
    sales: (SaleRow & { payments: PaymentRow[] })[],
  ): Record<PaymentMethodKey, number> {
    const counts: Record<PaymentMethodKey, number> = {
      cash: 0,
      card: 0,
      yape: 0,
      plin: 0,
    };
    for (const sale of sales) {
      for (const payment of sale.payments) {
        if (this.isPaymentMethod(payment.method)) {
          counts[payment.method] += 1;
        }
      }
    }
    return counts;
  }

  private countByDocType(sales: SaleRow[]): Record<DocTypeKey, number> {
    const counts: Record<DocTypeKey, number> = { boleta: 0, factura: 0 };
    for (const sale of sales) {
      if (this.isDocType(sale.docType)) counts[sale.docType] += 1;
    }
    return counts;
  }

  private abcClass(cumulativePct: Prisma.Decimal): 'A' | 'B' | 'C' {
    if (cumulativePct.lte(ABC_A_MAX)) return 'A';
    if (cumulativePct.lte(ABC_B_MAX)) return 'B';
    return 'C';
  }

  private avg(total: Prisma.Decimal, count: number): Prisma.Decimal {
    return count > 0 ? total.div(count) : new Prisma.Decimal(0);
  }

  private emptyByMethod(): Record<PaymentMethodKey, Prisma.Decimal> {
    return {
      cash: new Prisma.Decimal(0),
      card: new Prisma.Decimal(0),
      yape: new Prisma.Decimal(0),
      plin: new Prisma.Decimal(0),
    };
  }

  private emptyByDocType(): Record<DocTypeKey, Prisma.Decimal> {
    return {
      boleta: new Prisma.Decimal(0),
      factura: new Prisma.Decimal(0),
    };
  }

  private byMethodToStrings(
    byMethod: Record<PaymentMethodKey, Prisma.Decimal>,
  ): ByMethod {
    return {
      cash: byMethod.cash.toFixed(2),
      card: byMethod.card.toFixed(2),
      yape: byMethod.yape.toFixed(2),
      plin: byMethod.plin.toFixed(2),
    };
  }

  private byDocTypeToStrings(
    byDocType: Record<DocTypeKey, Prisma.Decimal>,
  ): ByDocType {
    return {
      boleta: byDocType.boleta.toFixed(2),
      factura: byDocType.factura.toFixed(2),
    };
  }

  private isPaymentMethod(method: string): method is PaymentMethodKey {
    return (PAYMENT_METHODS as readonly string[]).includes(method);
  }

  private isDocType(docType: string): docType is DocTypeKey {
    return (DOC_TYPES as readonly string[]).includes(docType);
  }
}
