import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { type FastifyReply } from 'fastify';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PoliciesGuard } from '../authz/policies.guard';
import { RequireAbility } from '../authz/require-ability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  foodCostReportQuerySchema,
  inventoryReportQuerySchema,
  ok,
  reportWindowQuerySchema,
  salesReportQuerySchema,
  wasteReportQuerySchema,
  type ApiResponse,
  type FoodCostReportQueryInput,
  type InventoryReportQueryInput,
  type JwtClaims,
  type ReportWindowQueryInput,
  type SalesReportQueryInput,
  type WasteReportQueryInput,
} from '../shared';
import { toCsv } from './csv.util';
import { limaDayKey } from './report-window.util';
import {
  ReportsService,
  type AdminDashboard,
  type CashierDashboard,
  type FoodCostReport,
  type InventoryReport,
  type ManagerDashboard,
  type ParetoReport,
  type SalesReport,
  type WasteReport,
} from './reports.service';

@Controller('reports')
@UseGuards(JwtAuthGuard, PoliciesGuard)
/**
 * E07 · Reportes y dashboards (read-only). Per-endpoint RBAC:
 *  - Dashboards de admin/gerente, reporte de ventas, Pareto y los reportes
 *    operativos (inventario/food cost/mermas) = `read Report` (owner/manager;
 *    staff → 403): información de gestión.
 *  - Dashboard del cajero (HU-07-03) = `read Sale` (staff lo tiene): es operativo
 *    para cuadrar caja durante el turno.
 * Ventana de fechas `?from=ISO&to=ISO`; sin parámetros = hoy (Lima). Moneda string.
 * HU-07-10 · Exportación: `?format=csv` en sales/inventory/food-cost/waste devuelve
 * RFC-4180 (text/csv + Content-Disposition); sin el param = envelope JSON. PDF/Excel
 * = futuro (requieren librería externa; ver spec). El gate CASL corre antes del
 * handler, así que `staff` recibe 403 también para `?format=csv`.
 */
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  // HU-07-03 · Dashboard del cajero: caja del día (staff lo ve → read Sale).
  @Get('dashboard/cashier')
  @RequireAbility('read', 'Sale')
  async cashierDashboard(
    @CurrentUser() claims: JwtClaims,
    @Query(new ZodValidationPipe(reportWindowQuerySchema))
    query: ReportWindowQueryInput,
  ): Promise<ApiResponse<CashierDashboard>> {
    return ok(
      await this.reports.cashierDashboard(
        claims.tenant_id,
        query.from,
        query.to,
      ),
    );
  }

  // HU-07-02 · Dashboard del gerente (operativo, foco en hoy). read Report.
  @Get('dashboard/manager')
  @RequireAbility('read', 'Report')
  async managerDashboard(
    @CurrentUser() claims: JwtClaims,
    @Query(new ZodValidationPipe(reportWindowQuerySchema))
    query: ReportWindowQueryInput,
  ): Promise<ApiResponse<ManagerDashboard>> {
    return ok(
      await this.reports.managerDashboard(
        claims.tenant_id,
        query.from,
        query.to,
      ),
    );
  }

  // HU-07-01 · Dashboard del admin (ejecutivo, KPIs financieros). read Report.
  @Get('dashboard/admin')
  @RequireAbility('read', 'Report')
  async adminDashboard(
    @CurrentUser() claims: JwtClaims,
    @Query(new ZodValidationPipe(reportWindowQuerySchema))
    query: ReportWindowQueryInput,
  ): Promise<ApiResponse<AdminDashboard>> {
    return ok(
      await this.reports.adminDashboard(claims.tenant_id, query.from, query.to),
    );
  }

  // HU-07-04 · Reporte de ventas (ventana + groupBy day|method|docType). read Report.
  // HU-07-10 · `?format=csv` → exporta la serie como CSV.
  @Get('sales')
  @RequireAbility('read', 'Report')
  async salesReport(
    @CurrentUser() claims: JwtClaims,
    @Query(new ZodValidationPipe(salesReportQuerySchema))
    query: SalesReportQueryInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ApiResponse<SalesReport> | string> {
    const report = await this.reports.salesReport(
      claims.tenant_id,
      query.from,
      query.to,
      query.groupBy,
    );
    if (query.format === 'csv') {
      return this.sendCsv(
        reply,
        'sales',
        ['key', 'revenue', 'count'],
        report.series,
      );
    }
    return ok(report);
  }

  // HU-07-08 · Análisis Pareto/ABC de platos por revenue en la ventana. read Report.
  @Get('pareto-dishes')
  @RequireAbility('read', 'Report')
  async paretoDishes(
    @CurrentUser() claims: JwtClaims,
    @Query(new ZodValidationPipe(reportWindowQuerySchema))
    query: ReportWindowQueryInput,
  ): Promise<ApiResponse<ParetoReport>> {
    return ok(
      await this.reports.paretoDishes(claims.tenant_id, query.from, query.to),
    );
  }

  // HU-07-05 · Reporte de inventario: valoración del stock actual. read Report.
  // HU-07-10 · `?format=csv` → exporta los items como CSV.
  @Get('inventory')
  @RequireAbility('read', 'Report')
  async inventoryReport(
    @CurrentUser() claims: JwtClaims,
    @Query(new ZodValidationPipe(inventoryReportQuerySchema))
    query: InventoryReportQueryInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ApiResponse<InventoryReport> | string> {
    const report = await this.reports.inventoryReport(claims.tenant_id);
    if (query.format === 'csv') {
      return this.sendCsv(
        reply,
        'inventory',
        [
          'ingredientId',
          'name',
          'unit',
          'stock',
          'minStock',
          'unitCost',
          'stockValue',
          'status',
        ],
        report.items,
      );
    }
    return ok(report);
  }

  // HU-07-06 · Reporte de food cost del período (YYYY-MM). read Report.
  // HU-07-10 · `?format=csv` → exporta los platos como CSV.
  @Get('food-cost')
  @RequireAbility('read', 'Report')
  async foodCostReport(
    @CurrentUser() claims: JwtClaims,
    @Query(new ZodValidationPipe(foodCostReportQuerySchema))
    query: FoodCostReportQueryInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ApiResponse<FoodCostReport> | string> {
    const report = await this.reports.foodCostReport(
      claims.tenant_id,
      query.period,
    );
    if (query.format === 'csv') {
      return this.sendCsv(
        reply,
        'food-cost',
        [
          'name',
          'sellPrice',
          'ingredientCost',
          'foodCostPct',
          'unitsSold',
          'revenue',
        ],
        report.dishes,
      );
    }
    return ok(report);
  }

  // HU-07-07 · Reporte de mermas en la ventana (?from=&to=). read Report.
  // HU-07-10 · `?format=csv` → exporta los movimientos como CSV.
  @Get('waste')
  @RequireAbility('read', 'Report')
  async wasteReport(
    @CurrentUser() claims: JwtClaims,
    @Query(new ZodValidationPipe(wasteReportQuerySchema))
    query: WasteReportQueryInput,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ApiResponse<WasteReport> | string> {
    const report = await this.reports.wasteReport(
      claims.tenant_id,
      query.from,
      query.to,
    );
    if (query.format === 'csv') {
      return this.sendCsv(
        reply,
        'waste',
        [
          'id',
          'ingredientId',
          'ingredientName',
          'qty',
          'unit',
          'reason',
          'createdAt',
        ],
        report.movements,
      );
    }
    return ok(report);
  }

  /**
   * HU-07-10 · Fija las cabeceras de descarga CSV en la `FastifyReply` y devuelve el
   * cuerpo RFC-4180 (la cadena se envía tal cual con `@Res({ passthrough: true })`).
   * `filename = <report>-<YYYY-MM-DD local Lima>.csv`.
   */
  private sendCsv<T>(
    reply: FastifyReply,
    report: string,
    headers: readonly (keyof T & string)[],
    rows: readonly T[],
  ): string {
    const filename = `${report}-${limaDayKey(new Date())}.csv`;
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`);
    return toCsv(headers, rows);
  }
}
