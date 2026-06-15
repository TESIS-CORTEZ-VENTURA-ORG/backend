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
  createIngredientSchema,
  importIngredientsSchema,
  ok,
  updateIngredientSchema,
  type ApiResponse,
  type CreateIngredientInput,
  type ImportIngredientsInput,
  type JwtClaims,
  type UpdateIngredientInput,
} from '../shared';
import { IngredientsService, type IngredientView } from './ingredients.service';
import {
  IngredientsImportService,
  type ImportReport,
} from './ingredients-import.service';

@Controller('ingredients')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class IngredientsController {
  constructor(
    private readonly ingredients: IngredientsService,
    private readonly importer: IngredientsImportService,
  ) {}

  @Get()
  @RequireAbility('read', 'Catalog')
  async list(
    @CurrentUser() claims: JwtClaims,
  ): Promise<ApiResponse<IngredientView[]>> {
    return ok(await this.ingredients.list(claims.tenant_id));
  }

  @Get(':id')
  @RequireAbility('read', 'Catalog')
  async get(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
  ): Promise<ApiResponse<IngredientView>> {
    return ok(await this.ingredients.get(claims.tenant_id, id));
  }

  @Post()
  @RequireAbility('create', 'Catalog')
  @Audited('ingredient.create')
  async create(
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(createIngredientSchema))
    dto: CreateIngredientInput,
  ): Promise<ApiResponse<IngredientView>> {
    return ok(await this.ingredients.create(claims.tenant_id, dto));
  }

  // HU-02-02 · Carga masiva desde CSV (declarada antes de las rutas :id).
  @Post('import')
  @RequireAbility('create', 'Catalog')
  @Audited('ingredient.import')
  async import(
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(importIngredientsSchema))
    dto: ImportIngredientsInput,
  ): Promise<ApiResponse<ImportReport>> {
    return ok(await this.importer.importCsv(claims.tenant_id, dto.content));
  }

  @Patch(':id')
  @RequireAbility('update', 'Catalog')
  async update(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateIngredientSchema))
    dto: UpdateIngredientInput,
  ): Promise<ApiResponse<IngredientView>> {
    return ok(await this.ingredients.update(claims.tenant_id, id, dto));
  }

  @Delete(':id')
  @RequireAbility('delete', 'Catalog')
  async remove(
    @CurrentUser() claims: JwtClaims,
    @Param('id') id: string,
  ): Promise<ApiResponse<{ deleted: true }>> {
    await this.ingredients.remove(claims.tenant_id, id);
    return ok({ deleted: true });
  }
}
