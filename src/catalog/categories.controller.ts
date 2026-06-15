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
  createCategorySchema,
  ok,
  updateCategorySchema,
  type ApiResponse,
  type CreateCategoryInput,
  type JwtClaims,
  type UpdateCategoryInput,
} from '../shared';
import { CategoriesService, type CategoryView } from './categories.service';

@Controller('categories')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequireAbility('read', 'Catalog')
  async list(
    @CurrentUser() claims: JwtClaims,
  ): Promise<ApiResponse<CategoryView[]>> {
    return ok(await this.categories.list(claims.tenant_id));
  }

  @Post()
  @RequireAbility('create', 'Catalog')
  async create(
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(createCategorySchema)) dto: CreateCategoryInput,
  ): Promise<ApiResponse<CategoryView>> {
    return ok(await this.categories.create(claims.tenant_id, dto));
  }

  @Patch(':id')
  @RequireAbility('update', 'Catalog')
  async update(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCategorySchema)) dto: UpdateCategoryInput,
  ): Promise<ApiResponse<CategoryView>> {
    return ok(await this.categories.update(claims.tenant_id, id, dto));
  }

  @Delete(':id')
  @RequireAbility('delete', 'Catalog')
  async remove(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
  ): Promise<ApiResponse<{ deleted: true }>> {
    await this.categories.remove(claims.tenant_id, id);
    return ok({ deleted: true });
  }
}
