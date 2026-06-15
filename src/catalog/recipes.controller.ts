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
  createRecipeSchema,
  ok,
  updateRecipeSchema,
  type ApiResponse,
  type CreateRecipeInput,
  type JwtClaims,
  type UpdateRecipeInput,
} from '../shared';
import {
  RecipesService,
  type RecipeSummary,
  type RecipeView,
} from './recipes.service';

@Controller('recipes')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class RecipesController {
  constructor(private readonly recipes: RecipesService) {}

  @Get()
  @RequireAbility('read', 'Catalog')
  async list(
    @CurrentUser() claims: JwtClaims,
  ): Promise<ApiResponse<RecipeSummary[]>> {
    return ok(await this.recipes.list(claims.tenant_id));
  }

  @Get(':id')
  @RequireAbility('read', 'Catalog')
  async get(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
  ): Promise<ApiResponse<RecipeView>> {
    return ok(await this.recipes.get(claims.tenant_id, id));
  }

  @Post()
  @RequireAbility('create', 'Catalog')
  @Audited('recipe.create')
  async create(
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(createRecipeSchema)) dto: CreateRecipeInput,
  ): Promise<ApiResponse<RecipeView>> {
    return ok(await this.recipes.create(claims.tenant_id, dto));
  }

  @Patch(':id')
  @RequireAbility('update', 'Catalog')
  @Audited('recipe.update')
  async update(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRecipeSchema)) dto: UpdateRecipeInput,
  ): Promise<ApiResponse<RecipeView>> {
    return ok(await this.recipes.update(claims.tenant_id, id, dto));
  }

  @Delete(':id')
  @RequireAbility('delete', 'Catalog')
  async remove(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
  ): Promise<ApiResponse<{ deleted: true }>> {
    await this.recipes.remove(claims.tenant_id, id);
    return ok({ deleted: true });
  }
}
