import { Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma/prisma.service';
import { type AppRole } from '../shared';

export interface UserView {
  id: string;
  email: string;
  name: string;
  roles: string[];
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lista los usuarios del tenant (RLS aísla por contexto). */
  async listByTenant(tenantId: string): Promise<UserView[]> {
    const users = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.user.findMany({
        where: { deletedAt: null },
        orderBy: { email: 'asc' },
      }),
    );
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      roles: u.roles,
    }));
  }

  /** Asigna roles a un usuario del tenant. RLS impide tocar usuarios de otro tenant. */
  async assignRoles(
    tenantId: string,
    userId: string,
    roles: AppRole[],
  ): Promise<UserView> {
    const user = await this.prisma.runInTenant(tenantId, (tx) =>
      tx.user.update({ where: { id: userId }, data: { roles } }),
    );
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles,
    };
  }
}
