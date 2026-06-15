import { Injectable, NotFoundException } from '@nestjs/common';
import { type MenuAvailability, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma/prisma.service';
import { type CreateMenuAvailabilityInput } from '../shared';
import { isAvailable, localDayAndMinute } from './menu-availability.util';

type Tx = Prisma.TransactionClient;

export interface MenuAvailabilityView {
  id: string;
  menuItemId: string;
  dayOfWeek: number | null;
  startMinute: number;
  endMinute: number;
}

export interface AvailabilityResult {
  available: boolean;
  dayOfWeek: number;
  minuteOfDay: number;
}

function toView(w: MenuAvailability): MenuAvailabilityView {
  return {
    id: w.id,
    menuItemId: w.menuItemId,
    dayOfWeek: w.dayOfWeek,
    startMinute: w.startMinute,
    endMinute: w.endMinute,
  };
}

@Injectable()
export class MenuAvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async listForItem(
    tenantId: string,
    menuItemId: string,
  ): Promise<MenuAvailabilityView[]> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      await this.assertItem(tx, menuItemId);
      const rows = await tx.menuAvailability.findMany({
        where: { menuItemId },
        orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
      });
      return rows.map(toView);
    });
  }

  async addWindow(
    tenantId: string,
    menuItemId: string,
    dto: CreateMenuAvailabilityInput,
  ): Promise<MenuAvailabilityView> {
    const row = await this.prisma.runInTenant(tenantId, async (tx) => {
      await this.assertItem(tx, menuItemId);
      return tx.menuAvailability.create({
        data: {
          tenantId,
          menuItemId,
          dayOfWeek: dto.dayOfWeek ?? null,
          startMinute: dto.startMinute,
          endMinute: dto.endMinute,
        },
      });
    });
    return toView(row);
  }

  async removeWindow(tenantId: string, id: string): Promise<void> {
    await this.prisma.runInTenant(tenantId, async (tx) => {
      const row = await tx.menuAvailability.findFirst({ where: { id } });
      if (!row) {
        throw new NotFoundException('Ventana de disponibilidad no encontrada');
      }
      await tx.menuAvailability.delete({ where: { id } });
    });
  }

  /** HU-02-13 · ¿El plato está disponible en `at` (zona del tenant)? */
  async check(
    tenantId: string,
    menuItemId: string,
    at: Date,
  ): Promise<AvailabilityResult> {
    const windows = await this.prisma.runInTenant(tenantId, async (tx) => {
      await this.assertItem(tx, menuItemId);
      return tx.menuAvailability.findMany({ where: { menuItemId } });
    });
    const { dayOfWeek, minuteOfDay } = localDayAndMinute(at);
    return {
      available: isAvailable(windows.map(toView), dayOfWeek, minuteOfDay),
      dayOfWeek,
      minuteOfDay,
    };
  }

  private async assertItem(tx: Tx, menuItemId: string): Promise<void> {
    const item = await tx.menuItem.findFirst({
      where: { id: menuItemId, deletedAt: null },
    });
    if (!item) {
      throw new NotFoundException('Plato no encontrado');
    }
  }
}
