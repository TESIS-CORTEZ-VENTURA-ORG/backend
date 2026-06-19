import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Cliente Prisma de SISTEMA (plataforma): conecta como `gastronomia_auth`
 * (NOSUPERUSER, **BYPASSRLS**, solo SELECT) para lecturas **cross-tenant** que no
 * tienen contexto de tenant — p. ej. el cron semanal que debe enumerar TODOS los
 * tenants activos (HU-08-03). NUNCA para escrituras ni operaciones de negocio
 * (esas van por `PrismaService.runInTenant`, con RLS por tenant).
 *
 * Reutiliza el rol del lookup de credenciales (`DATABASE_URL_AUTH`): mismo perfil
 * de acceso (BYPASSRLS + SELECT), distinto propósito (lecturas de plataforma).
 */
@Injectable()
export class SystemDbClient
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const url = process.env.DATABASE_URL_AUTH;
    if (!url) {
      throw new Error(
        'DATABASE_URL_AUTH no está definido (ver .env / db/init/02-auth-role.sql)',
      );
    }
    super({ datasources: { db: { url } } });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Ids de los tenants activos (no borrados). Lectura cross-tenant (BYPASSRLS). */
  async findActiveTenantIds(): Promise<string[]> {
    const rows = await this.tenant.findMany({
      where: { deletedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => r.id);
  }
}
