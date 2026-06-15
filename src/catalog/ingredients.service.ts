import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type Ingredient, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma/prisma.service';
import {
  type CreateIngredientInput,
  type UpdateIngredientInput,
} from '../shared';

export interface IngredientView {
  id: string;
  sku: string;
  name: string;
  type: string;
  unit: string;
  category: string | null;
  unitCost: string; // S/ como string para no perder precisión (Decimal)
  updatedAt: string;
}

function toView(i: Ingredient): IngredientView {
  return {
    id: i.id,
    sku: i.sku,
    name: i.name,
    type: i.type,
    unit: i.unit,
    category: i.category,
    unitCost: i.unitCost.toFixed(2),
    updatedAt: i.updatedAt.toISOString(),
  };
}

@Injectable()
export class IngredientsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string): Promise<IngredientView[]> {
    const rows = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.ingredient.findMany({
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
      }),
    );
    return rows.map(toView);
  }

  async get(tenantId: string, id: string): Promise<IngredientView> {
    return toView(await this.find(tenantId, id));
  }

  async create(
    tenantId: string,
    dto: CreateIngredientInput,
  ): Promise<IngredientView> {
    try {
      const row = await this.prisma.runInTenant(tenantId, (tx) =>
        tx.ingredient.create({
          data: {
            tenantId,
            sku: dto.sku,
            name: dto.name,
            type: dto.type,
            unit: dto.unit,
            category: dto.category ?? null,
            unitCost: dto.unitCost ?? 0,
          },
        }),
      );
      return toView(row);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateIngredientInput,
  ): Promise<IngredientView> {
    await this.find(tenantId, id);
    const data: Prisma.IngredientUpdateInput = {};
    if (dto.sku !== undefined) data.sku = dto.sku;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.unit !== undefined) data.unit = dto.unit;
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.unitCost !== undefined) data.unitCost = dto.unitCost;
    try {
      const row = await this.prisma.runInTenant(tenantId, (tx) =>
        tx.ingredient.update({ where: { id }, data }),
      );
      return toView(row);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.find(tenantId, id);
    await this.prisma.runInTenant(tenantId, (tx) =>
      tx.ingredient.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
  }

  private async find(tenantId: string, id: string): Promise<Ingredient> {
    const row = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.ingredient.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!row) {
      throw new NotFoundException('Insumo no encontrado');
    }
    return row;
  }

  private mapError(error: unknown): Error {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return new ConflictException('El SKU ya existe en este tenant');
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
