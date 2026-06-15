import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type Category, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma/prisma.service';
import { type CreateCategoryInput, type UpdateCategoryInput } from '../shared';

export interface CategoryView {
  id: string;
  name: string;
  parentId: string | null;
}

function toView(c: Category): CategoryView {
  return { id: c.id, name: c.name, parentId: c.parentId };
}

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string): Promise<CategoryView[]> {
    const rows = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.category.findMany({
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
      }),
    );
    return rows.map(toView);
  }

  async create(
    tenantId: string,
    dto: CreateCategoryInput,
  ): Promise<CategoryView> {
    if (dto.parentId) {
      await this.find(tenantId, dto.parentId); // el padre debe existir
    }
    const row = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.category.create({
        data: { tenantId, name: dto.name, parentId: dto.parentId ?? null },
      }),
    );
    return toView(row);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateCategoryInput,
  ): Promise<CategoryView> {
    await this.find(tenantId, id);
    const data: Prisma.CategoryUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.parentId !== undefined) {
      if (dto.parentId !== null) {
        if (dto.parentId === id) {
          throw new BadRequestException(
            'Una categoría no puede ser su propia padre',
          );
        }
        await this.find(tenantId, dto.parentId);
        if (await this.wouldCycle(tenantId, id, dto.parentId)) {
          throw new BadRequestException(
            'La jerarquía resultante crearía un ciclo',
          );
        }
      }
      data.parentId = dto.parentId;
    }
    const row = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.category.update({ where: { id }, data }),
    );
    return toView(row);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.find(tenantId, id);
    const children = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.category.count({ where: { parentId: id, deletedAt: null } }),
    );
    if (children > 0) {
      throw new ConflictException('No se puede eliminar: tiene subcategorías');
    }
    await this.prisma.runInTenant(tenantId, (tx) =>
      tx.category.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
  }

  private async find(tenantId: string, id: string): Promise<Category> {
    const row = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.category.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!row) {
      throw new NotFoundException('Categoría no encontrada');
    }
    return row;
  }

  /** ¿Poner `newParentId` como padre de `categoryId` crearía un ciclo? */
  private async wouldCycle(
    tenantId: string,
    categoryId: string,
    newParentId: string,
  ): Promise<boolean> {
    const all = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.category.findMany({
        where: { deletedAt: null },
        select: { id: true, parentId: true },
      }),
    );
    const parentOf = new Map(all.map((c) => [c.id, c.parentId]));
    let current: string | null = newParentId;
    let hops = 0;
    while (current && hops < 1000) {
      if (current === categoryId) {
        return true;
      }
      current = parentOf.get(current) ?? null;
      hops += 1;
    }
    return false;
  }
}
