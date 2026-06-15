import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma/prisma.service';
import { type TenantSettingsInput } from '../shared';

export interface TenantSettingsView {
  ruc: string | null;
  legalName: string | null;
  fiscalAddress: string | null;
  currency: string;
  igvRate: number;
  capacity: number | null;
  businessHours: unknown;
}

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(tenantId: string): Promise<TenantSettingsView> {
    const tenant = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
    );
    return this.toView(tenant);
  }

  async updateSettings(
    tenantId: string,
    dto: TenantSettingsInput,
  ): Promise<TenantSettingsView> {
    const data: Prisma.TenantUpdateInput = {};
    if (dto.ruc !== undefined) data.ruc = dto.ruc;
    if (dto.legalName !== undefined) data.legalName = dto.legalName;
    if (dto.fiscalAddress !== undefined) data.fiscalAddress = dto.fiscalAddress;
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.igvRate !== undefined) data.igvRate = dto.igvRate;
    if (dto.capacity !== undefined) data.capacity = dto.capacity;
    if (dto.businessHours !== undefined) {
      data.businessHours = dto.businessHours as Prisma.InputJsonValue;
    }
    const tenant = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.tenant.update({ where: { id: tenantId }, data }),
    );
    return this.toView(tenant);
  }

  private toView(tenant: {
    ruc: string | null;
    legalName: string | null;
    fiscalAddress: string | null;
    currency: string;
    igvRate: number;
    capacity: number | null;
    businessHours: Prisma.JsonValue | null;
  }): TenantSettingsView {
    return {
      ruc: tenant.ruc,
      legalName: tenant.legalName,
      fiscalAddress: tenant.fiscalAddress,
      currency: tenant.currency,
      igvRate: tenant.igvRate,
      capacity: tenant.capacity,
      businessHours: tenant.businessHours,
    };
  }
}
