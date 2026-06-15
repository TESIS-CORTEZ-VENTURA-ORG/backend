import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
  createKitchenStationSchema,
  kitchenQueueQuerySchema,
  ok,
  updateKitchenItemSchema,
  updateKitchenStationSchema,
  type ApiResponse,
  type CreateKitchenStationInput,
  type JwtClaims,
  type KitchenQueueQueryInput,
  type UpdateKitchenItemInput,
  type UpdateKitchenStationInput,
} from '../shared';
import {
  KitchenService,
  type KitchenItemView,
  type KitchenStationView,
} from './kitchen.service';

@Controller('kitchen')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class KitchenController {
  constructor(private readonly kitchen: KitchenService) {}

  // ── HU-03-07 · Estaciones ──────────────────────────────────────────────────
  // Lectura = staff (read Kitchen). Configurar (crear/editar/eliminar) = manager.

  @Get('stations')
  @RequireAbility('read', 'Kitchen')
  async listStations(
    @CurrentUser() claims: JwtClaims,
  ): Promise<ApiResponse<KitchenStationView[]>> {
    return ok(await this.kitchen.listStations(claims.tenant_id));
  }

  @Post('stations')
  @RequireAbility('create', 'Kitchen')
  @Audited('kitchen.station.create')
  async createStation(
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(createKitchenStationSchema))
    dto: CreateKitchenStationInput,
  ): Promise<ApiResponse<KitchenStationView>> {
    return ok(await this.kitchen.createStation(claims.tenant_id, dto));
  }

  @Patch('stations/:id')
  @RequireAbility('update', 'Kitchen')
  @Audited('kitchen.station.update')
  async updateStation(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateKitchenStationSchema))
    dto: UpdateKitchenStationInput,
  ): Promise<ApiResponse<KitchenStationView>> {
    return ok(await this.kitchen.updateStation(claims.tenant_id, id, dto));
  }

  @Delete('stations/:id')
  @RequireAbility('delete', 'Kitchen')
  @Audited('kitchen.station.delete')
  async removeStation(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
  ): Promise<ApiResponse<{ deleted: true }>> {
    await this.kitchen.removeStation(claims.tenant_id, id);
    return ok({ deleted: true });
  }

  // ── HU-03-07 · Cola del KDS ─────────────────────────────────────────────────

  @Get('queue')
  @RequireAbility('read', 'Kitchen')
  async queue(
    @CurrentUser() claims: JwtClaims,
    @Query(new ZodValidationPipe(kitchenQueueQuerySchema))
    query: KitchenQueueQueryInput,
  ): Promise<ApiResponse<KitchenItemView[]>> {
    return ok(await this.kitchen.queue(claims.tenant_id, query));
  }

  // ── HU-03-08/09 · Marcar ítem en preparación / listo ────────────────────────

  @Patch('items/:itemId')
  @RequireAbility('update', 'Kitchen')
  @Audited('kitchen.item.update')
  async updateItem(
    @CurrentUser() claims: JwtClaims,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(updateKitchenItemSchema))
    dto: UpdateKitchenItemInput,
  ): Promise<ApiResponse<KitchenItemView>> {
    return ok(await this.kitchen.updateItem(claims.tenant_id, itemId, dto));
  }
}
