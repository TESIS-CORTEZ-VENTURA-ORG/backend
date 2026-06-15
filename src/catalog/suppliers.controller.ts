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
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PoliciesGuard } from '../authz/policies.guard';
import { RequireAbility } from '../authz/require-ability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  createSupplierSchema,
  ok,
  updateSupplierSchema,
  type ApiResponse,
  type CreateSupplierInput,
  type JwtClaims,
  type UpdateSupplierInput,
} from '../shared';
import { SuppliersService, type SupplierView } from './suppliers.service';

@Controller('suppliers')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequireAbility('read', 'Catalog')
  async list(
    @CurrentUser() claims: JwtClaims,
  ): Promise<ApiResponse<SupplierView[]>> {
    return ok(await this.suppliers.list(claims.tenant_id));
  }

  @Get(':id')
  @RequireAbility('read', 'Catalog')
  async get(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
  ): Promise<ApiResponse<SupplierView>> {
    return ok(await this.suppliers.get(claims.tenant_id, id));
  }

  @Post()
  @RequireAbility('create', 'Catalog')
  async create(
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(createSupplierSchema)) dto: CreateSupplierInput,
  ): Promise<ApiResponse<SupplierView>> {
    return ok(await this.suppliers.create(claims.tenant_id, dto));
  }

  @Patch(':id')
  @RequireAbility('update', 'Catalog')
  async update(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSupplierSchema)) dto: UpdateSupplierInput,
  ): Promise<ApiResponse<SupplierView>> {
    return ok(await this.suppliers.update(claims.tenant_id, id, dto));
  }

  @Delete(':id')
  @RequireAbility('delete', 'Catalog')
  async remove(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
  ): Promise<ApiResponse<{ deleted: true }>> {
    await this.suppliers.remove(claims.tenant_id, id);
    return ok({ deleted: true });
  }
}
