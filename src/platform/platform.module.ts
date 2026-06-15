import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';

/**
 * E12 Platform — plataforma, DevOps, observabilidad, audit (backend.md §5).
 * Por ahora solo el health check; PrismaService, audit_log y observabilidad
 * llegan en incrementos posteriores (E01 y siguientes).
 */
@Module({
  controllers: [HealthController],
})
export class PlatformModule {}
