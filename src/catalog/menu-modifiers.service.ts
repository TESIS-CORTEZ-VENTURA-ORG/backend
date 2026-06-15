import { Injectable, NotFoundException } from '@nestjs/common';
import { type MenuModifier, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma/prisma.service';
import {
  type CreateMenuModifierInput,
  type UpdateMenuModifierInput,
} from '../shared';

type Tx = Prisma.TransactionClient;

export interface MenuModifierView {
  id: string;
  menuItemId: string;
  name: string;
  priceDelta: string;
  required: boolean;
  position: number;
}

function toView(m: MenuModifier): MenuModifierView {
  return {
    id: m.id,
    menuItemId: m.menuItemId,
    name: m.name,
    priceDelta: m.priceDelta.toFixed(2),
    required: m.required,
    position: m.position,
  };
}

@Injectable()
export class MenuModifiersService {
  constructor(private readonly prisma: PrismaService) {}

  async listForItem(
    tenantId: string,
    menuItemId: string,
  ): Promise<MenuModifierView[]> {
    return this.prisma.runInTenant(tenantId, async (tx) => {
      await this.assertItem(tx, menuItemId);
      const rows = await tx.menuModifier.findMany({
        where: { menuItemId, deletedAt: null },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
      });
      return rows.map(toView);
    });
  }

  async create(
    tenantId: string,
    menuItemId: string,
    dto: CreateMenuModifierInput,
  ): Promise<MenuModifierView> {
    const row = await this.prisma.runInTenant(tenantId, async (tx) => {
      await this.assertItem(tx, menuItemId);
      return tx.menuModifier.create({
        data: {
          tenantId,
          menuItemId,
          name: dto.name,
          priceDelta: dto.priceDelta ?? 0,
          required: dto.required ?? false,
          position: dto.position ?? 0,
        },
      });
    });
    return toView(row);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateMenuModifierInput,
  ): Promise<MenuModifierView> {
    const row = await this.prisma.runInTenant(tenantId, async (tx) => {
      await this.find(tx, id);
      const data: Prisma.MenuModifierUncheckedUpdateInput = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.priceDelta !== undefined) data.priceDelta = dto.priceDelta;
      if (dto.required !== undefined) data.required = dto.required;
      if (dto.position !== undefined) data.position = dto.position;
      return tx.menuModifier.update({ where: { id }, data });
    });
    return toView(row);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.prisma.runInTenant(tenantId, async (tx) => {
      await this.find(tx, id);
      await tx.menuModifier.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    });
  }

  private async assertItem(tx: Tx, menuItemId: string): Promise<void> {
    const item = await tx.menuItem.findFirst({
      where: { id: menuItemId, deletedAt: null },
    });
    if (!item) {
      throw new NotFoundException('Plato no encontrado');
    }
  }

  private async find(tx: Tx, id: string): Promise<MenuModifier> {
    const row = await tx.menuModifier.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) {
      throw new NotFoundException('Modificador no encontrado');
    }
    return row;
  }
}
