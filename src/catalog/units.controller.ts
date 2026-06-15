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
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PoliciesGuard } from '../authz/policies.guard';
import { RequireAbility } from '../authz/require-ability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  convertUnitSchema,
  createUnitSchema,
  ok,
  updateUnitSchema,
  type ApiResponse,
  type ConvertUnitInput,
  type CreateUnitInput,
  type JwtClaims,
  type UpdateUnitInput,
} from '../shared';
import {
  UnitsService,
  type ConvertResult,
  type UnitView,
} from './units.service';

@Controller('units')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class UnitsController {
  constructor(private readonly units: UnitsService) {}

  @Get()
  @RequireAbility('read', 'Catalog')
  async list(
    @CurrentUser() claims: JwtClaims,
  ): Promise<ApiResponse<UnitView[]>> {
    return ok(await this.units.list(claims.tenant_id));
  }

  @Get('convert')
  @RequireAbility('read', 'Catalog')
  async convert(
    @CurrentUser() claims: JwtClaims,
    @Query(new ZodValidationPipe(convertUnitSchema)) q: ConvertUnitInput,
  ): Promise<ApiResponse<ConvertResult>> {
    return ok(await this.units.convert(claims.tenant_id, q.qty, q.from, q.to));
  }

  @Post()
  @RequireAbility('create', 'Catalog')
  async create(
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(createUnitSchema)) dto: CreateUnitInput,
  ): Promise<ApiResponse<UnitView>> {
    return ok(await this.units.create(claims.tenant_id, dto));
  }

  @Patch(':id')
  @RequireAbility('update', 'Catalog')
  async update(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateUnitSchema)) dto: UpdateUnitInput,
  ): Promise<ApiResponse<UnitView>> {
    return ok(await this.units.update(claims.tenant_id, id, dto));
  }

  @Delete(':id')
  @RequireAbility('delete', 'Catalog')
  async remove(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
  ): Promise<ApiResponse<{ deleted: true }>> {
    await this.units.remove(claims.tenant_id, id);
    return ok({ deleted: true });
  }
}
