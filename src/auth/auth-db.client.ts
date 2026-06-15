import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Cliente Prisma como `gastronomia_auth` (NOSUPERUSER, BYPASSRLS, solo SELECT).
 * ÚNICO uso: lookup de credenciales en login, donde aún no hay contexto de tenant.
 * Nunca para escrituras ni en requests de negocio.
 */
@Injectable()
export class AuthDbClient
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
}
