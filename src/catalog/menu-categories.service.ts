import { Injectable, NotFoundException } from '@nestjs/common';
import { type MenuCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma/prisma.service';
import {
  type CreateMenuCategoryInput,
  type ReorderMenuCategoriesInput,
  type UpdateMenuCategoryInput,
} from '../shared';

type Tx = Prisma.TransactionClient;

export interface MenuCategoryView {
  id: string;
  name: string;
  position: number;
  isActive: boolean;
}

function toView(c: MenuCategory): MenuCategoryView {
  return { id: c.id, name: c.name, position: c.position, isActive: c.isActive };
}

@Injectable()
export class MenuCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string): Promise<MenuCategoryView[]> {
    const rows = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.menuCategory.findMany({
        where: { deletedAt: null },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
      }),
    );
    return rows.map(toView);
  }

  async create(
    tenantId: string,
    dto: CreateMenuCategoryInput,
  ): Promise<MenuCategoryView> {
    const row = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.menuCategory.create({
        data: {
          tenantId,
          name: dto.name,
          position: dto.position ?? 0,
          isActive: dto.isActive ?? true,
        },
      }),
    );
    return toView(row);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateMenuCategoryInput,
  ): Promise<MenuCategoryView> {
    const row = await this.prisma.runInTenant(tenantId, async (tx) => {
      await this.find(tx, id);
      const data: Prisma.MenuCategoryUncheckedUpdateInput = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.position !== undefined) data.position = dto.position;
      if (dto.isActive !== undefined) data.isActive = dto.isActive;
      return tx.menuCategory.update({ where: { id }, data });
    });
    return toView(row);
  }

  /** HU-02-12 · Reordenar (drag-and-drop). Aplica todas las posiciones en una transacción. */
  async reorder(
    tenantId: string,
    dto: ReorderMenuCategoriesInput,
  ): Promise<MenuCategoryView[]> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      for (const { id, position } of dto.order) {
        await tx.menuCategory.updateMany({
          where: { id, deletedAt: null },
          data: { position },
        });
      }
      const rows = await tx.menuCategory.findMany({
        where: { deletedAt: null },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
      });
      return rows.map(toView);
    });
  }

  /** Soft-delete; desvincula sus platos (menuCategoryId → null) para no dejar referencias colgantes. */
  async remove(tenantId: string, id: string): Promise<void> {
    await this.prisma.runInTenant(tenantId, async (tx) => {
      await this.find(tx, id);
      await tx.menuItem.updateMany({
        where: { menuCategoryId: id },
        data: { menuCategoryId: null },
      });
      await tx.menuCategory.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    });
  }

  private async find(tx: Tx, id: string): Promise<MenuCategory> {
    const row = await tx.menuCategory.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) {
      throw new NotFoundException('Categoría de menú no encontrada');
    }
    return row;
  }
}
