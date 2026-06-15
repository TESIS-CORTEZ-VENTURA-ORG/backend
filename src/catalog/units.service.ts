import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type UnitOfMeasure } from '@prisma/client';
import { PrismaService } from '../platform/prisma/prisma.service';
import { type CreateUnitInput, type UpdateUnitInput } from '../shared';

export interface UnitView {
  id: string;
  code: string;
  name: string;
  family: string;
  factorToBase: number;
}
export interface ConvertResult {
  from: string;
  to: string;
  qty: number;
  result: number;
}

function toView(u: UnitOfMeasure): UnitView {
  return {
    id: u.id,
    code: u.code,
    name: u.name,
    family: u.family,
    factorToBase: u.factorToBase.toNumber(),
  };
}

@Injectable()
export class UnitsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string): Promise<UnitView[]> {
    const rows = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.unitOfMeasure.findMany({
        where: { deletedAt: null },
        orderBy: { code: 'asc' },
      }),
    );
    return rows.map(toView);
  }

  async create(tenantId: string, dto: CreateUnitInput): Promise<UnitView> {
    try {
      const row = await this.prisma.runInTenant(tenantId, (tx) =>
        tx.unitOfMeasure.create({
          data: {
            tenantId,
            code: dto.code,
            name: dto.name,
            family: dto.family,
            factorToBase: dto.factorToBase,
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
    dto: UpdateUnitInput,
  ): Promise<UnitView> {
    await this.find(tenantId, id);
    const data: Prisma.UnitOfMeasureUpdateInput = {};
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.family !== undefined) data.family = dto.family;
    if (dto.factorToBase !== undefined) data.factorToBase = dto.factorToBase;
    try {
      const row = await this.prisma.runInTenant(tenantId, (tx) =>
        tx.unitOfMeasure.update({ where: { id }, data }),
      );
      return toView(row);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.find(tenantId, id);
    await this.prisma.runInTenant(tenantId, (tx) =>
      tx.unitOfMeasure.update({
        where: { id },
        data: { deletedAt: new Date() },
      }),
    );
  }

  /** Convierte qty entre unidades de la MISMA familia (rechaza familias distintas). */
  async convert(
    tenantId: string,
    qty: number,
    fromCode: string,
    toCode: string,
  ): Promise<ConvertResult> {
    const units = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.unitOfMeasure.findMany({
        where: { code: { in: [fromCode, toCode] }, deletedAt: null },
      }),
    );
    const from = units.find((u) => u.code === fromCode);
    const to = units.find((u) => u.code === toCode);
    if (!from || !to) {
      throw new NotFoundException('Unidad no encontrada');
    }
    if (from.family !== to.family) {
      throw new BadRequestException(
        'No se puede convertir entre familias distintas',
      );
    }
    const result =
      (qty * from.factorToBase.toNumber()) / to.factorToBase.toNumber();
    return { from: fromCode, to: toCode, qty, result };
  }

  private async find(tenantId: string, id: string): Promise<UnitOfMeasure> {
    const row = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.unitOfMeasure.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!row) {
      throw new NotFoundException('Unidad no encontrada');
    }
    return row;
  }

  private mapError(error: unknown): Error {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return new ConflictException('El código de unidad ya existe');
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
