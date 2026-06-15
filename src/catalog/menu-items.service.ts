import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type MenuItem, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma/prisma.service';
import { type CreateMenuItemInput, type UpdateMenuItemInput } from '../shared';
import { RecipesService } from './recipes.service';

type Tx = Prisma.TransactionClient;

// HU-02-10: margen mínimo aceptable; por debajo se marca alerta (`lowMargin`).
const LOW_MARGIN_THRESHOLD = new Prisma.Decimal(25);

export interface MenuItemView {
  id: string;
  name: string;
  recipeId: string;
  menuCategoryId: string | null;
  price: string;
  imageUrl: string | null;
  isActive: boolean;
  unitCost: string;
  marginPct: string;
  lowMargin: boolean;
}

@Injectable()
export class MenuItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recipes: RecipesService,
  ) {}

  async list(tenantId: string): Promise<MenuItemView[]> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const rows = await tx.menuItem.findMany({
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
      });
      const views: MenuItemView[] = [];
      for (const row of rows) {
        views.push(await this.toView(tx, row));
      }
      return views;
    });
  }

  async get(tenantId: string, id: string): Promise<MenuItemView> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      const row = await this.find(tx, id);
      return this.toView(tx, row);
    });
  }

  async create(
    tenantId: string,
    dto: CreateMenuItemInput,
  ): Promise<MenuItemView> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      await this.assertRecipe(tx, dto.recipeId);
      if (dto.menuCategoryId) {
        await this.assertCategory(tx, dto.menuCategoryId);
      }
      const row = await tx.menuItem.create({
        data: {
          tenantId,
          recipeId: dto.recipeId,
          menuCategoryId: dto.menuCategoryId ?? null,
          name: dto.name,
          price: dto.price,
          imageUrl: dto.imageUrl ?? null,
          isActive: dto.isActive ?? true,
        },
      });
      return this.toView(tx, row);
    });
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateMenuItemInput,
  ): Promise<MenuItemView> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      await this.find(tx, id);
      const data: Prisma.MenuItemUncheckedUpdateInput = {};
      if (dto.recipeId !== undefined) {
        await this.assertRecipe(tx, dto.recipeId);
        data.recipeId = dto.recipeId;
      }
      if (dto.menuCategoryId !== undefined) {
        if (dto.menuCategoryId !== null) {
          await this.assertCategory(tx, dto.menuCategoryId);
        }
        data.menuCategoryId = dto.menuCategoryId;
      }
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.price !== undefined) data.price = dto.price;
      if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl;
      if (dto.isActive !== undefined) data.isActive = dto.isActive;
      const row = await tx.menuItem.update({ where: { id }, data });
      return this.toView(tx, row);
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.prisma.runInTenant(tenantId, async (tx) => {
      await this.find(tx, id);
      await tx.menuItem.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    });
  }

  // Costo unitario = costo por rendimiento de la receta (recalculado en vivo).
  // margen% = (precio − costo) / precio · 100; alerta si < 25% (HU-02-10).
  private async toView(tx: Tx, row: MenuItem): Promise<MenuItemView> {
    const cost = await this.recipes.costPerYieldTx(tx, row.recipeId);
    const price = row.price;
    const margin = price.isZero()
      ? new Prisma.Decimal(0)
      : price.sub(cost).div(price).mul(100);
    return {
      id: row.id,
      name: row.name,
      recipeId: row.recipeId,
      menuCategoryId: row.menuCategoryId,
      price: price.toFixed(2),
      imageUrl: row.imageUrl,
      isActive: row.isActive,
      unitCost: cost.toFixed(2),
      marginPct: margin.toFixed(2),
      lowMargin: margin.lt(LOW_MARGIN_THRESHOLD),
    };
  }

  private async find(tx: Tx, id: string): Promise<MenuItem> {
    const row = await tx.menuItem.findFirst({ where: { id, deletedAt: null } });
    if (!row) {
      throw new NotFoundException('Plato no encontrado');
    }
    return row;
  }

  private async assertRecipe(tx: Tx, recipeId: string): Promise<void> {
    const recipe = await tx.recipe.findFirst({
      where: { id: recipeId, deletedAt: null },
    });
    if (!recipe) {
      throw new BadRequestException('La receta no existe');
    }
  }

  private async assertCategory(tx: Tx, categoryId: string): Promise<void> {
    const category = await tx.menuCategory.findFirst({
      where: { id: categoryId, deletedAt: null },
    });
    if (!category) {
      throw new BadRequestException('La categoría de menú no existe');
    }
  }
}
