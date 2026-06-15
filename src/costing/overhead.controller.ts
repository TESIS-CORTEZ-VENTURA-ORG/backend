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
  createOverheadCostSchema,
  ok,
  overheadCostQuerySchema,
  updateOverheadCostSchema,
  type ApiResponse,
  type CreateOverheadCostInput,
  type JwtClaims,
  type OverheadCostQueryInput,
  type UpdateOverheadCostInput,
} from '../shared';
import { OverheadService, type OverheadCostView } from './overhead.service';

/**
 * HU-06-02 · CRUD de costos indirectos (CIF) mensuales. Información de gestión:
 * lectura y escritura = owner/manager (`Report`). El staff no accede (403).
 */
@Controller('overhead-costs')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class OverheadController {
  constructor(private readonly overhead: OverheadService) {}

  // Lectura de CIF = info de gestión (read Report; staff → 403).
  @Get()
  @RequireAbility('read', 'Report')
  async list(
    @CurrentUser() claims: JwtClaims,
    @Query(new ZodValidationPipe(overheadCostQuerySchema))
    query: OverheadCostQueryInput,
  ): Promise<ApiResponse<OverheadCostView[]>> {
    return ok(await this.overhead.list(claims.tenant_id, query.period));
  }

  // Escritura de CIF = configuración de costeo (manage Report; owner/manager).
  @Post()
  @RequireAbility('manage', 'Report')
  @Audited('overhead.create')
  async create(
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(createOverheadCostSchema))
    dto: CreateOverheadCostInput,
  ): Promise<ApiResponse<OverheadCostView>> {
    return ok(await this.overhead.create(claims.tenant_id, dto));
  }

  @Patch(':id')
  @RequireAbility('manage', 'Report')
  @Audited('overhead.update')
  async update(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateOverheadCostSchema))
    dto: UpdateOverheadCostInput,
  ): Promise<ApiResponse<OverheadCostView>> {
    return ok(await this.overhead.update(claims.tenant_id, id, dto));
  }

  @Delete(':id')
  @RequireAbility('manage', 'Report')
  @Audited('overhead.delete')
  async remove(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
  ): Promise<ApiResponse<{ deleted: true }>> {
    await this.overhead.remove(claims.tenant_id, id);
    return ok({ deleted: true });
  }
}
