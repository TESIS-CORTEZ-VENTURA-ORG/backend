import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { PrismaService } from './prisma/prisma.service';

/**
 * E12 Platform — plataforma, DevOps, observabilidad, audit (backend.md §5).
 * Provee `PrismaService` (infra de DB con RLS) y el health check. `PrismaService`
 * se exporta para que los módulos de negocio lo inyecten.
 */
@Module({
  controllers: [HealthController],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PlatformModule {}
