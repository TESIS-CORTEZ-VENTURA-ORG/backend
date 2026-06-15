import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Supplier } from '@prisma/client';
import { PrismaService } from '../platform/prisma/prisma.service';
import { type CreateSupplierInput, type UpdateSupplierInput } from '../shared';

export interface SupplierView {
  id: string;
  ruc: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  paymentTerms: string | null;
  leadTimeDays: number | null;
  active: boolean;
}

function toView(s: Supplier): SupplierView {
  return {
    id: s.id,
    ruc: s.ruc,
    name: s.name,
    contactName: s.contactName,
    contactEmail: s.contactEmail,
    contactPhone: s.contactPhone,
    paymentTerms: s.paymentTerms,
    leadTimeDays: s.leadTimeDays,
    active: s.active,
  };
}

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string): Promise<SupplierView[]> {
    const rows = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.supplier.findMany({
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
      }),
    );
    return rows.map(toView);
  }

  async get(tenantId: string, id: string): Promise<SupplierView> {
    return toView(await this.find(tenantId, id));
  }

  async create(
    tenantId: string,
    dto: CreateSupplierInput,
  ): Promise<SupplierView> {
    try {
      const row = await this.prisma.runInTenant(tenantId, (tx) =>
        tx.supplier.create({
          data: {
            tenantId,
            ruc: dto.ruc,
            name: dto.name,
            contactName: dto.contactName ?? null,
            contactEmail: dto.contactEmail ?? null,
            contactPhone: dto.contactPhone ?? null,
            paymentTerms: dto.paymentTerms ?? null,
            leadTimeDays: dto.leadTimeDays ?? null,
            active: dto.active ?? true,
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
    dto: UpdateSupplierInput,
  ): Promise<SupplierView> {
    await this.find(tenantId, id);
    const data: Prisma.SupplierUpdateInput = {};
    if (dto.ruc !== undefined) data.ruc = dto.ruc;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.contactName !== undefined) data.contactName = dto.contactName;
    if (dto.contactEmail !== undefined) data.contactEmail = dto.contactEmail;
    if (dto.contactPhone !== undefined) data.contactPhone = dto.contactPhone;
    if (dto.paymentTerms !== undefined) data.paymentTerms = dto.paymentTerms;
    if (dto.leadTimeDays !== undefined) data.leadTimeDays = dto.leadTimeDays;
    if (dto.active !== undefined) data.active = dto.active;
    try {
      const row = await this.prisma.runInTenant(tenantId, (tx) =>
        tx.supplier.update({ where: { id }, data }),
      );
      return toView(row);
    } catch (error) {
      throw this.mapError(error);
    }
  }

  /** Soft delete (desactiva). No se elimina si tiene OCs (E05) — se chequeará allí. */
  async remove(tenantId: string, id: string): Promise<void> {
    await this.find(tenantId, id);
    await this.prisma.runInTenant(tenantId, (tx) =>
      tx.supplier.update({
        where: { id },
        data: { active: false, deletedAt: new Date() },
      }),
    );
  }

  private async find(tenantId: string, id: string): Promise<Supplier> {
    const row = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.supplier.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!row) {
      throw new NotFoundException('Proveedor no encontrado');
    }
    return row;
  }

  private mapError(error: unknown): Error {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return new ConflictException('El RUC ya está registrado en este tenant');
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
