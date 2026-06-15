import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Audited } from '../audit/audited.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PoliciesGuard } from '../authz/policies.guard';
import { RequireAbility } from '../authz/require-ability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  createZoneSchema,
  ok,
  updateZoneSchema,
  type ApiResponse,
  type CreateZoneInput,
  type JwtClaims,
  type UpdateZoneInput,
} from '../shared';
import { ZonesService, type ZoneView } from './zones.service';

@Controller('zones')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class ZonesController {
  constructor(private readonly zones: ZonesService) {}

  @Get()
  @RequireAbility('read', 'Zone')
  async list(
    @CurrentUser() claims: JwtClaims,
  ): Promise<ApiResponse<ZoneView[]>> {
    return ok(await this.zones.list(claims.tenant_id));
  }

  @Post()
  @RequireAbility('create', 'Zone')
  @Audited('zone.create')
  async create(
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(createZoneSchema)) dto: CreateZoneInput,
  ): Promise<ApiResponse<ZoneView>> {
    return ok(await this.zones.create(claims.tenant_id, dto));
  }

  @Patch(':id')
  @RequireAbility('update', 'Zone')
  @Audited('zone.update')
  async update(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateZoneSchema)) dto: UpdateZoneInput,
  ): Promise<ApiResponse<ZoneView>> {
    return ok(await this.zones.update(claims.tenant_id, id, dto));
  }

  @Delete(':id')
  @RequireAbility('delete', 'Zone')
  @Audited('zone.delete')
  async remove(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
  ): Promise<ApiResponse<{ deleted: true }>> {
    await this.zones.remove(claims.tenant_id, id);
    return ok({ deleted: true });
  }
}
