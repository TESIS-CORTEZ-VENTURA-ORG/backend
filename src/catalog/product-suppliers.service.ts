import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma/prisma.service';
import { type LinkSupplierInput } from '../shared';

export interface ProductSupplierView {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierSku: string | null;
  lastPrice: string | null;
  preferred: boolean;
}

function toView(row: {
  id: string;
  supplierId: string;
  supplierSku: string | null;
  lastPrice: Prisma.Decimal | null;
  preferred: boolean;
  supplier: { name: string };
}): ProductSupplierView {
  return {
    id: row.id,
    supplierId: row.supplierId,
    supplierName: row.supplier.name,
    supplierSku: row.supplierSku,
    lastPrice: row.lastPrice ? row.lastPrice.toFixed(2) : null,
    preferred: row.preferred,
  };
}

@Injectable()
export class ProductSuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    tenantId: string,
    ingredientId: string,
  ): Promise<ProductSupplierView[]> {
    await this.ensureIngredient(tenantId, ingredientId);
    const rows = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.productSupplier.findMany({
        where: { ingredientId },
        include: { supplier: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return rows.map(toView);
  }

  async link(
    tenantId: string,
    ingredientId: string,
    dto: LinkSupplierInput,
  ): Promise<ProductSupplierView> {
    await this.ensureIngredient(tenantId, ingredientId);
    await this.ensureSupplier(tenantId, dto.supplierId);
    try {
      const row = await this.prisma.runInTenant(tenantId, (tx) =>
        tx.productSupplier.create({
          data: {
            tenantId,
            ingredientId,
            supplierId: dto.supplierId,
            supplierSku: dto.supplierSku ?? null,
            lastPrice: dto.lastPrice ?? null,
            preferred: dto.preferred ?? false,
          },
          include: { supplier: true },
        }),
      );
      return toView(row);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'El proveedor ya está asociado a este insumo',
        );
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async unlink(
    tenantId: string,
    ingredientId: string,
    supplierId: string,
  ): Promise<void> {
    const result = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.productSupplier.deleteMany({ where: { ingredientId, supplierId } }),
    );
    if (result.count === 0) {
      throw new NotFoundException('Asociación no encontrada');
    }
  }

  private async ensureIngredient(
    tenantId: string,
    ingredientId: string,
  ): Promise<void> {
    const row = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.ingredient.findFirst({ where: { id: ingredientId, deletedAt: null } }),
    );
    if (!row) {
      throw new NotFoundException('Insumo no encontrado');
    }
  }

  private async ensureSupplier(
    tenantId: string,
    supplierId: string,
  ): Promise<void> {
    const row = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.supplier.findFirst({ where: { id: supplierId, deletedAt: null } }),
    );
    if (!row) {
      throw new NotFoundException('Proveedor no encontrado');
    }
  }
}
