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
  createTableSchema,
  ok,
  updateTableSchema,
  type ApiResponse,
  type CreateTableInput,
  type JwtClaims,
  type UpdateTableInput,
} from '../shared';
import {
  TablesService,
  type TableDetailView,
  type TableView,
} from './tables.service';

@Controller('tables')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Get()
  @RequireAbility('read', 'Table')
  async list(
    @CurrentUser() claims: JwtClaims,
  ): Promise<ApiResponse<TableView[]>> {
    return ok(await this.tables.list(claims.tenant_id));
  }

  // Read-model del POS: la mesa + su orden actual (HU-03-03..12 unblock frontend).
  @Get(':id')
  @RequireAbility('read', 'Table')
  async getOne(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
  ): Promise<ApiResponse<TableDetailView>> {
    return ok(await this.tables.getOne(claims.tenant_id, id));
  }

  // Configurar el salón (crear/eliminar mesas) = manager. Operar (PATCH estado) = staff.
  @Post()
  @RequireAbility('create', 'Table')
  @Audited('table.create')
  async create(
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(createTableSchema)) dto: CreateTableInput,
  ): Promise<ApiResponse<TableView>> {
    return ok(await this.tables.create(claims.tenant_id, dto));
  }

  @Patch(':id')
  @RequireAbility('update', 'Table')
  @Audited('table.update')
  async update(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTableSchema)) dto: UpdateTableInput,
  ): Promise<ApiResponse<TableView>> {
    return ok(await this.tables.update(claims.tenant_id, id, dto));
  }

  @Delete(':id')
  @RequireAbility('delete', 'Table')
  @Audited('table.delete')
  async remove(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
  ): Promise<ApiResponse<{ deleted: true }>> {
    await this.tables.remove(claims.tenant_id, id);
    return ok({ deleted: true });
  }
}
