import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
  createMovementSchema,
  ok,
  priceTrendQuerySchema,
  updateInventoryLevelSchema,
  type ApiResponse,
  type CreateMovementInput,
  type IngredientCoverageResponse,
  type JwtClaims,
  type PriceTrendQuery,
  type PriceTrendResponse,
  type UpdateInventoryLevelInput,
} from '../shared';
import {
  InventoryService,
  type AlertView,
  type MovementView,
  type StockView,
  type WasteHistoryView,
} from './inventory.service';

@Controller('inventory')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  // HU-05-01 · Stock actual (kardex) con estado de alerta por insumo.
  @Get('stock')
  @RequireAbility('read', 'Inventory')
  async stock(
    @CurrentUser() claims: JwtClaims,
  ): Promise<ApiResponse<StockView[]>> {
    return ok(await this.inventory.listStock(claims.tenant_id));
  }

  // HU-05-01 · Kardex de movimientos (filtrable por insumo).
  @Get('movements')
  @RequireAbility('read', 'Inventory')
  async movements(
    @CurrentUser() claims: JwtClaims,
    @Query('ingredientId') ingredientId?: string,
  ): Promise<ApiResponse<MovementView[]>> {
    return ok(
      await this.inventory.listMovements(claims.tenant_id, ingredientId),
    );
  }

  // HU-05-02/03/08 · Registrar entrada/salida/merma (qty con signo).
  @Post('movements')
  @RequireAbility('create', 'Inventory')
  @Audited('inventory.movement')
  async createMovement(
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(createMovementSchema)) dto: CreateMovementInput,
  ): Promise<ApiResponse<MovementView>> {
    return ok(
      await this.inventory.createMovement(claims.tenant_id, claims.sub, dto),
    );
  }

  // HU-05-10 · Configurar el mínimo de reorden de un insumo.
  @Patch('levels/:ingredientId')
  @RequireAbility('update', 'Inventory')
  @Audited('inventory.level')
  async updateLevel(
    @CurrentUser() claims: JwtClaims,
    @Param('ingredientId') ingredientId: string,
    @Body(new ZodValidationPipe(updateInventoryLevelSchema))
    dto: UpdateInventoryLevelInput,
  ): Promise<ApiResponse<StockView>> {
    return ok(
      await this.inventory.updateLevel(claims.tenant_id, ingredientId, dto),
    );
  }

  // HU-05-10 · Alertas de stock bajo (más críticas primero).
  @Get('alerts')
  @RequireAbility('read', 'Inventory')
  async alerts(
    @CurrentUser() claims: JwtClaims,
  ): Promise<ApiResponse<AlertView[]>> {
    return ok(await this.inventory.listAlerts(claims.tenant_id));
  }

  // HU-05-09 · Histórico de mermas + costo total perdido.
  @Get('waste')
  @RequireAbility('read', 'Inventory')
  async waste(
    @CurrentUser() claims: JwtClaims,
  ): Promise<ApiResponse<WasteHistoryView>> {
    return ok(await this.inventory.listWaste(claims.tenant_id));
  }

  /**
   * HU-05-11 · Cobertura de stock de un insumo, basada en el consumo real promedio
   * de los últimos 30 días (movimientos type='sale'). `daysLeft` es null cuando el
   * consumo es 0 (cobertura indefinida). `tenant_id` SIEMPRE del JWT; `id` del path.
   */
  @Get('ingredients/:id/coverage')
  @RequireAbility('read', 'Inventory')
  async coverage(
    @CurrentUser() claims: JwtClaims,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<IngredientCoverageResponse>> {
    return ok(await this.inventory.ingredientCoverage(claims.tenant_id, id));
  }

  /**
   * HU-05-12 · Tendencia de precio de un insumo: historial descendente de precios
   * de compra (OC recepcionadas). `limit` (default 12, max 50) controla cuántos
   * puntos devolver. Alimentado automáticamente al recepcionar cada OC.
   */
  @Get('ingredients/:id/price-trend')
  @RequireAbility('read', 'Inventory')
  async priceTrend(
    @CurrentUser() claims: JwtClaims,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(priceTrendQuerySchema)) query: PriceTrendQuery,
  ): Promise<ApiResponse<PriceTrendResponse>> {
    return ok(
      await this.inventory.priceTrend(claims.tenant_id, id, query.limit),
    );
  }
}
