import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PoliciesGuard } from '../authz/policies.guard';
import { RequireAbility } from '../authz/require-ability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  linkSupplierSchema,
  ok,
  type ApiResponse,
  type JwtClaims,
  type LinkSupplierInput,
} from '../shared';
import {
  ProductSuppliersService,
  type ProductSupplierView,
} from './product-suppliers.service';

@Controller('ingredients/:ingredientId/suppliers')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class ProductSuppliersController {
  constructor(private readonly productSuppliers: ProductSuppliersService) {}

  @Get()
  @RequireAbility('read', 'Catalog')
  async list(
    @CurrentUser() claims: JwtClaims,
    @Param('ingredientId') ingredientId: string,
  ): Promise<ApiResponse<ProductSupplierView[]>> {
    return ok(await this.productSuppliers.list(claims.tenant_id, ingredientId));
  }

  @Post()
  @RequireAbility('create', 'Catalog')
  async link(
    @CurrentUser() claims: JwtClaims,
    @Param('ingredientId') ingredientId: string,
    @Body(new ZodValidationPipe(linkSupplierSchema)) dto: LinkSupplierInput,
  ): Promise<ApiResponse<ProductSupplierView>> {
    return ok(
      await this.productSuppliers.link(claims.tenant_id, ingredientId, dto),
    );
  }

  @Delete(':supplierId')
  @RequireAbility('delete', 'Catalog')
  async unlink(
    @CurrentUser() claims: JwtClaims,
    @Param('ingredientId') ingredientId: string,
    @Param('supplierId') supplierId: string,
  ): Promise<ApiResponse<{ unlinked: true }>> {
    await this.productSuppliers.unlink(
      claims.tenant_id,
      ingredientId,
      supplierId,
    );
    return ok({ unlinked: true });
  }
}
