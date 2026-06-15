import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PoliciesGuard } from '../authz/policies.guard';
import { RequireAbility } from '../authz/require-ability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  ok,
  reportWindowQuerySchema,
  salesReportQuerySchema,
  type ApiResponse,
  type JwtClaims,
  type ReportWindowQueryInput,
  type SalesReportQueryInput,
} from '../shared';
import {
  ReportsService,
  type AdminDashboard,
  type CashierDashboard,
  type ManagerDashboard,
  type ParetoReport,
  type SalesReport,
} from './reports.service';

/**
 * E07 · Reportes y dashboards (read-only). Per-endpoint RBAC:
 *  - Dashboards de admin/gerente, reporte de ventas y Pareto = `read Report`
 *    (owner/manager; staff → 403): información de gestión.
 *  - Dashboard del cajero (HU-07-03) = `read Sale` (staff lo tiene): es operativo
 *    para cuadrar caja durante el turno.
 * Ventana de fechas `?from=ISO&to=ISO`; sin parámetros = hoy (Lima). Moneda string.
 */
@Controller('reports')
@UseGuards(JwtAuthGuard, PoliciesGuard)
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
  @Get('sales')
  @RequireAbility('read', 'Report')
  async salesReport(
    @CurrentUser() claims: JwtClaims,
    @Query(new ZodValidationPipe(salesReportQuerySchema))
    query: SalesReportQueryInput,
  ): Promise<ApiResponse<SalesReport>> {
    return ok(
      await this.reports.salesReport(
        claims.tenant_id,
        query.from,
        query.to,
        query.groupBy,
      ),
    );
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
}
