import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';

const tenantIdSchema = z.uuid();

/**
 * Cliente Prisma (infra de plataforma, E12). Único cliente de la app.
 *
 * `runInTenant` fija `app.tenant_id` con alcance de TRANSACCIÓN (equivalente a
 * SET LOCAL), de modo que la RLS FORCE aísla toda lectura/escritura por tenant
 * (backend.md §4). El tenantId DEBE derivarse del claim del JWT — nunca del
 * path, query ni body.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async runInTenant<T>(
    tenantId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const id = tenantIdSchema.parse(tenantId);
    return this.$transaction(async (tx) => {
      // set_config(key, value, is_local=true) == SET LOCAL → scope de transacción.
      // Parametrizado ($1) → sin riesgo de inyección.
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${id}, true)`;
      return fn(tx);
    });
  }
}
