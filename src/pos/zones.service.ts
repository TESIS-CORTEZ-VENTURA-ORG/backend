import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type Zone, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma/prisma.service';
import { type CreateZoneInput, type UpdateZoneInput } from '../shared';

type Tx = Prisma.TransactionClient;

export interface ZoneView {
  id: string;
  name: string;
  position: number;
}

function toView(z: Zone): ZoneView {
  return { id: z.id, name: z.name, position: z.position };
}

@Injectable()
export class ZonesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string): Promise<ZoneView[]> {
    const rows = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.zone.findMany({
        where: { deletedAt: null },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
      }),
    );
    return rows.map(toView);
  }

  async create(tenantId: string, dto: CreateZoneInput): Promise<ZoneView> {
    const row = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.zone.create({
        data: { tenantId, name: dto.name, position: dto.position ?? 0 },
      }),
    );
    return toView(row);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateZoneInput,
  ): Promise<ZoneView> {
    const row = await this.prisma.runInTenant(tenantId, async (tx) => {
      await this.find(tx, id);
      const data: Prisma.ZoneUncheckedUpdateInput = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.position !== undefined) data.position = dto.position;
      return tx.zone.update({ where: { id }, data });
    });
    return toView(row);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.prisma.runInTenant(tenantId, async (tx) => {
      await this.find(tx, id);
      const tables = await tx.diningTable.count({
        where: { zoneId: id, deletedAt: null },
      });
      if (tables > 0) {
        throw new ConflictException(
          'No se puede eliminar: la zona tiene mesas',
        );
      }
      await tx.zone.update({ where: { id }, data: { deletedAt: new Date() } });
    });
  }

  private async find(tx: Tx, id: string): Promise<Zone> {
    const row = await tx.zone.findFirst({ where: { id, deletedAt: null } });
    if (!row) {
      throw new NotFoundException('Zona no encontrada');
    }
    return row;
  }
}
