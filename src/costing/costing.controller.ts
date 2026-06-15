import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Audited } from '../audit/audited.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PoliciesGuard } from '../authz/policies.guard';
import { RequireAbility } from '../authz/require-ability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  closePeriodSchema,
  costingDishesQuerySchema,
  costVarianceQuerySchema,
  ok,
  suggestPriceQuerySchema,
  type ApiResponse,
  type ClosePeriodInput,
  type CostingDishesQueryInput,
  type CostVarianceQueryInput,
  type JwtClaims,
  type SuggestPriceQueryInput,
} from '../shared';
import {
  CostingService,
  type CostingCloseView,
  type CostVarianceView,
  type PeriodCostingView,
  type SuggestPriceView,
} from './costing.service';

/**
 * E06 · Costeo dinámico y márgenes. Toda la información de costeo es de gestión:
 * lectura = owner/manager (`read Report`); el staff no accede (403).
 */
@Controller('costing')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class CostingController {
  constructor(private readonly costing: CostingService) {}

  // HU-06-01/03/04 · Costeo de los platos activos en un período (ingredientes +
  // CIF prorrateado, margen, food cost). El período (`?period=YYYY-MM`) es requerido.
  @Get('dishes')
  @RequireAbility('read', 'Report')
  async dishes(
    @CurrentUser() claims: JwtClaims,
    @Query(new ZodValidationPipe(costingDishesQuerySchema))
    query: CostingDishesQueryInput,
  ): Promise<ApiResponse<PeriodCostingView>> {
    return ok(await this.costing.dishes(claims.tenant_id, query.period));
  }

  // HU-06-05 · Precio sugerido para un margen objetivo (fórmula determinista).
  @Get('suggest-price')
  @RequireAbility('read', 'Report')
  async suggestPrice(
    @CurrentUser() claims: JwtClaims,
    @Query(new ZodValidationPipe(suggestPriceQuerySchema))
    query: SuggestPriceQueryInput,
  ): Promise<ApiResponse<SuggestPriceView>> {
    return ok(
      await this.costing.suggestPrice(
        claims.tenant_id,
        query.menuItemId,
        query.targetMarginPct,
        query.period,
      ),
    );
  }

  // HU-06-06 · Cierre de período mensual: fija cifras finales y guarda el snapshot
  // del reporte (un cierre por mes; recerrar → 409). Escritura = manage Report.
  @Post('close')
  @RequireAbility('manage', 'Report')
  @Audited('costing.close')
  async close(
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(closePeriodSchema))
    dto: ClosePeriodInput,
  ): Promise<ApiResponse<CostingCloseView>> {
    return ok(
      await this.costing.closePeriod(claims.tenant_id, dto.period, claims.sub),
    );
  }

  // HU-06-06 · Lista de cierres del tenant.
  @Get('closes')
  @RequireAbility('read', 'Report')
  async closes(
    @CurrentUser() claims: JwtClaims,
  ): Promise<ApiResponse<CostingCloseView[]>> {
    return ok(await this.costing.listCloses(claims.tenant_id));
  }

  // HU-06-06 · Cierre de un período concreto (404 si no existe).
  @Get('closes/:period')
  @RequireAbility('read', 'Report')
  async closeByPeriod(
    @CurrentUser() claims: JwtClaims,
    @Param('period') period: string,
  ): Promise<ApiResponse<CostingCloseView>> {
    return ok(await this.costing.getClose(claims.tenant_id, period));
  }

  // HU-06-07 · Comparativo costo real (salida de inventario) vs teórico (BOM).
  @Get('cost-variance')
  @RequireAbility('read', 'Report')
  async costVariance(
    @CurrentUser() claims: JwtClaims,
    @Query(new ZodValidationPipe(costVarianceQuerySchema))
    query: CostVarianceQueryInput,
  ): Promise<ApiResponse<CostVarianceView>> {
    return ok(await this.costing.costVariance(claims.tenant_id, query.period));
  }
}
