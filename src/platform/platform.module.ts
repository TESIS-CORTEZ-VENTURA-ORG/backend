import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { PrismaService } from './prisma/prisma.service';
import { SystemDbClient } from './prisma/system-db.client';

/**
 * E12 Platform — plataforma, DevOps, observabilidad, audit (backend.md §5).
 * Provee `PrismaService` (DB con RLS por tenant) y `SystemDbClient` (lecturas
 * cross-tenant de sistema, BYPASSRLS) + el health check. Ambos se exportan para
 * que los módulos los inyecten.
 */
@Module({
  controllers: [HealthController],
  providers: [PrismaService, SystemDbClient],
  exports: [PrismaService, SystemDbClient],
})
export class PlatformModule {}
