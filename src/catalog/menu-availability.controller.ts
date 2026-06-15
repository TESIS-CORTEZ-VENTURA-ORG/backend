import {
  Body,
  Controller,
  Delete,
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
  availabilityCheckSchema,
  createMenuAvailabilitySchema,
  ok,
  type ApiResponse,
  type AvailabilityCheckInput,
  type CreateMenuAvailabilityInput,
  type JwtClaims,
} from '../shared';
import {
  MenuAvailabilityService,
  type AvailabilityResult,
  type MenuAvailabilityView,
} from './menu-availability.service';

// HU-02-13 · Ventanas de disponibilidad horaria de un plato.
@Controller('menu')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class MenuAvailabilityController {
  constructor(private readonly availability: MenuAvailabilityService) {}

  // Ruta estática más profunda que la lista; declarada primero por claridad.
  @Get('items/:itemId/availability/check')
  @RequireAbility('read', 'Catalog')
  async check(
    @CurrentUser() claims: JwtClaims,
    @Param('itemId') itemId: string,
    @Query(new ZodValidationPipe(availabilityCheckSchema))
    q: AvailabilityCheckInput,
  ): Promise<ApiResponse<AvailabilityResult>> {
    const at = q.at ? new Date(q.at) : new Date();
    return ok(await this.availability.check(claims.tenant_id, itemId, at));
  }

  @Get('items/:itemId/availability')
  @RequireAbility('read', 'Catalog')
  async list(
    @CurrentUser() claims: JwtClaims,
    @Param('itemId') itemId: string,
  ): Promise<ApiResponse<MenuAvailabilityView[]>> {
    return ok(await this.availability.listForItem(claims.tenant_id, itemId));
  }

  @Post('items/:itemId/availability')
  @RequireAbility('create', 'Catalog')
  @Audited('menu.availability.create')
  async add(
    @CurrentUser() claims: JwtClaims,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(createMenuAvailabilitySchema))
    dto: CreateMenuAvailabilityInput,
  ): Promise<ApiResponse<MenuAvailabilityView>> {
    return ok(await this.availability.addWindow(claims.tenant_id, itemId, dto));
  }

  @Delete('availability/:id')
  @RequireAbility('delete', 'Catalog')
  @Audited('menu.availability.delete')
  async remove(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
  ): Promise<ApiResponse<{ deleted: true }>> {
    await this.availability.removeWindow(claims.tenant_id, id);
    return ok({ deleted: true });
  }
}
