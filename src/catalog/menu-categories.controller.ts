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
  createMenuCategorySchema,
  ok,
  reorderMenuCategoriesSchema,
  updateMenuCategorySchema,
  type ApiResponse,
  type CreateMenuCategoryInput,
  type JwtClaims,
  type ReorderMenuCategoriesInput,
  type UpdateMenuCategoryInput,
} from '../shared';
import {
  MenuCategoriesService,
  type MenuCategoryView,
} from './menu-categories.service';

@Controller('menu/categories')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class MenuCategoriesController {
  constructor(private readonly categories: MenuCategoriesService) {}

  @Get()
  @RequireAbility('read', 'Catalog')
  async list(
    @CurrentUser() claims: JwtClaims,
  ): Promise<ApiResponse<MenuCategoryView[]>> {
    return ok(await this.categories.list(claims.tenant_id));
  }

  @Post()
  @RequireAbility('create', 'Catalog')
  @Audited('menu.category.create')
  async create(
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(createMenuCategorySchema))
    dto: CreateMenuCategoryInput,
  ): Promise<ApiResponse<MenuCategoryView>> {
    return ok(await this.categories.create(claims.tenant_id, dto));
  }

  // Antes de `:id` para que la ruta estática no sea capturada como parámetro.
  @Patch('reorder')
  @RequireAbility('update', 'Catalog')
  @Audited('menu.category.reorder')
  async reorder(
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(reorderMenuCategoriesSchema))
    dto: ReorderMenuCategoriesInput,
  ): Promise<ApiResponse<MenuCategoryView[]>> {
    return ok(await this.categories.reorder(claims.tenant_id, dto));
  }

  @Patch(':id')
  @RequireAbility('update', 'Catalog')
  @Audited('menu.category.update')
  async update(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateMenuCategorySchema))
    dto: UpdateMenuCategoryInput,
  ): Promise<ApiResponse<MenuCategoryView>> {
    return ok(await this.categories.update(claims.tenant_id, id, dto));
  }

  @Delete(':id')
  @RequireAbility('delete', 'Catalog')
  @Audited('menu.category.delete')
  async remove(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
  ): Promise<ApiResponse<{ deleted: true }>> {
    await this.categories.remove(claims.tenant_id, id);
    return ok({ deleted: true });
  }
}
