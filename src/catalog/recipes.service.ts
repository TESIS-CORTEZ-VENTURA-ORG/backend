import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma/prisma.service';
import { type CreateRecipeInput, type UpdateRecipeInput } from '../shared';

type Tx = Prisma.TransactionClient;
type RecipeRow = Prisma.RecipeGetPayload<object>;
type ItemRow = Prisma.RecipeItemGetPayload<{ include: { ingredient: true } }>;

const MAX_DEPTH = 5;

export interface RecipeSummary {
  id: string;
  name: string;
  kind: string;
  yield: string;
  version: number;
}
export interface RecipeItemView {
  id: string;
  ingredientId: string | null;
  subRecipeId: string | null;
  qty: string;
  wasteFactor: string;
  lineCost: string;
}
export interface RecipeView extends RecipeSummary {
  totalCost: string;
  costPerYield: string;
  items: RecipeItemView[];
}

@Injectable()
export class RecipesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string): Promise<RecipeSummary[]> {
    const rows = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.recipe.findMany({
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
      }),
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      yield: r.yield.toString(),
      version: r.version,
    }));
  }

  async get(tenantId: string, id: string): Promise<RecipeView> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const recipe = await this.findRecipe(tx, id);
      return this.buildView(tx, recipe);
    });
  }

  /**
   * Costo unitario (por rendimiento) de una receta, reusando el motor recursivo.
   * Pensado para que otros servicios del catálogo (p. ej. menú) calculen márgenes
   * dentro de su propia transacción `runInTenant`.
   */
  async costPerYieldTx(tx: Tx, recipeId: string): Promise<Prisma.Decimal> {
    const recipe = await tx.recipe.findFirst({
      where: { id: recipeId, deletedAt: null },
    });
    if (!recipe) {
      throw new NotFoundException('Receta no encontrada');
    }
    const total = await this.recipeCost(tx, recipeId, new Set<string>(), 0);
    return recipe.yield.isZero()
      ? new Prisma.Decimal(0)
      : total.div(recipe.yield);
  }

  async create(tenantId: string, dto: CreateRecipeInput): Promise<RecipeView> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      await this.validateRefs(tx, dto.items);
      const recipe = await tx.recipe.create({
        data: {
          tenantId,
          name: dto.name,
          kind: dto.kind ?? 'dish',
          yield: dto.yield ?? 1,
        },
      });
      await this.createItems(tx, tenantId, recipe.id, dto.items);
      const view = await this.buildView(tx, recipe); // valida ciclo/profundidad
      await this.snapshot(tx, tenantId, recipe.id, view);
      return view;
    });
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateRecipeInput,
  ): Promise<RecipeView> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      await this.findRecipe(tx, id);
      const data: Prisma.RecipeUpdateInput = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.kind !== undefined) data.kind = dto.kind;
      if (dto.yield !== undefined) data.yield = dto.yield;
      if (dto.items !== undefined) {
        await this.validateRefs(tx, dto.items);
        await tx.recipeItem.deleteMany({ where: { recipeId: id } });
        await this.createItems(tx, tenantId, id, dto.items);
        data.version = { increment: 1 };
      }
      const recipe = await tx.recipe.update({ where: { id }, data });
      const view = await this.buildView(tx, recipe); // valida ciclo/profundidad
      if (dto.items !== undefined) {
        await this.snapshot(tx, tenantId, id, view);
      }
      return view;
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.prisma.runInTenant(tenantId, async (tx) => {
      await this.findRecipe(tx, id);
      const usedIn = await tx.recipeItem.count({
        where: { subRecipeId: id, recipe: { deletedAt: null } },
      });
      if (usedIn > 0) {
        throw new ConflictException(
          'La receta se usa como sub-receta en otra receta',
        );
      }
      const usedInMenu = await tx.menuItem.count({
        where: { recipeId: id, deletedAt: null },
      });
      if (usedInMenu > 0) {
        throw new ConflictException('La receta se usa en un plato del menú');
      }
      await tx.recipe.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    });
  }

  private async findRecipe(tx: Tx, id: string): Promise<RecipeRow> {
    const recipe = await tx.recipe.findFirst({
      where: { id, deletedAt: null },
    });
    if (!recipe) {
      throw new NotFoundException('Receta no encontrada');
    }
    return recipe;
  }

  private async validateRefs(
    tx: Tx,
    items: CreateRecipeInput['items'],
  ): Promise<void> {
    for (const item of items) {
      if (item.ingredientId) {
        const ing = await tx.ingredient.findFirst({
          where: { id: item.ingredientId, deletedAt: null },
        });
        if (!ing) {
          throw new BadRequestException(
            `El ingrediente ${item.ingredientId} no existe`,
          );
        }
      } else if (item.subRecipeId) {
        const sub = await tx.recipe.findFirst({
          where: { id: item.subRecipeId, deletedAt: null },
        });
        if (!sub) {
          throw new BadRequestException(
            `La sub-receta ${item.subRecipeId} no existe`,
          );
        }
      }
    }
  }

  private async createItems(
    tx: Tx,
    tenantId: string,
    recipeId: string,
    items: CreateRecipeInput['items'],
  ): Promise<void> {
    await tx.recipeItem.createMany({
      data: items.map((item) => ({
        tenantId,
        recipeId,
        ingredientId: item.ingredientId ?? null,
        subRecipeId: item.subRecipeId ?? null,
        qty: item.qty,
        wasteFactor: item.wasteFactor ?? 0,
      })),
    });
  }

  private async buildView(tx: Tx, recipe: RecipeRow): Promise<RecipeView> {
    const items = await tx.recipeItem.findMany({
      where: { recipeId: recipe.id },
      include: { ingredient: true },
    });
    const itemViews: RecipeItemView[] = [];
    let total = new Prisma.Decimal(0);
    for (const item of items) {
      const line = await this.itemCost(tx, item, new Set([recipe.id]), 0);
      total = total.add(line);
      itemViews.push({
        id: item.id,
        ingredientId: item.ingredientId,
        subRecipeId: item.subRecipeId,
        qty: item.qty.toString(),
        wasteFactor: item.wasteFactor.toString(),
        lineCost: line.toFixed(2),
      });
    }
    const perYield = recipe.yield.isZero()
      ? new Prisma.Decimal(0)
      : total.div(recipe.yield);
    return {
      id: recipe.id,
      name: recipe.name,
      kind: recipe.kind,
      yield: recipe.yield.toString(),
      version: recipe.version,
      totalCost: total.toFixed(2),
      costPerYield: perYield.toFixed(2),
      items: itemViews,
    };
  }

  // Costo total de una receta (recursivo sobre sub-recetas, con ciclo + profundidad).
  private async recipeCost(
    tx: Tx,
    recipeId: string,
    visiting: Set<string>,
    depth: number,
  ): Promise<Prisma.Decimal> {
    if (depth > MAX_DEPTH) {
      throw new BadRequestException(
        `Profundidad máxima de sub-recetas (${MAX_DEPTH}) excedida`,
      );
    }
    if (visiting.has(recipeId)) {
      throw new BadRequestException('Ciclo de sub-recetas detectado');
    }
    visiting.add(recipeId);
    const items = await tx.recipeItem.findMany({
      where: { recipeId },
      include: { ingredient: true },
    });
    let total = new Prisma.Decimal(0);
    for (const item of items) {
      total = total.add(await this.itemCost(tx, item, visiting, depth));
    }
    visiting.delete(recipeId);
    return total;
  }

  private async itemCost(
    tx: Tx,
    item: ItemRow,
    visiting: Set<string>,
    depth: number,
  ): Promise<Prisma.Decimal> {
    const effQty = item.qty.mul(new Prisma.Decimal(1).add(item.wasteFactor));
    if (item.ingredientId && item.ingredient) {
      return item.ingredient.unitCost.mul(effQty);
    }
    if (item.subRecipeId) {
      const sub = await tx.recipe.findFirst({
        where: { id: item.subRecipeId },
      });
      if (!sub) {
        return new Prisma.Decimal(0);
      }
      const subTotal = await this.recipeCost(
        tx,
        item.subRecipeId,
        visiting,
        depth + 1,
      );
      const perUnit = sub.yield.isZero()
        ? new Prisma.Decimal(0)
        : subTotal.div(sub.yield);
      return perUnit.mul(effQty);
    }
    return new Prisma.Decimal(0);
  }

  private async snapshot(
    tx: Tx,
    tenantId: string,
    recipeId: string,
    view: RecipeView,
  ): Promise<void> {
    await tx.recipeVersion.create({
      data: {
        tenantId,
        recipeId,
        version: view.version,
        snapshot: view as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
