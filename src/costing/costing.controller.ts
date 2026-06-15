import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PoliciesGuard } from '../authz/policies.guard';
import { RequireAbility } from '../authz/require-ability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  costingDishesQuerySchema,
  ok,
  suggestPriceQuerySchema,
  type ApiResponse,
  type CostingDishesQueryInput,
  type JwtClaims,
  type SuggestPriceQueryInput,
} from '../shared';
import {
  CostingService,
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
}
