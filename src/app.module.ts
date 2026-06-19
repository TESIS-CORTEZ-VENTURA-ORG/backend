import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { CatalogModule } from './catalog/catalog.module';
import { CostingModule } from './costing/costing.module';
import { ForecastingModule } from './forecasting/forecasting.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { InventoryModule } from './inventory/inventory.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PlatformModule } from './platform/platform.module';
import { PosModule } from './pos/pos.module';
import { ReportsModule } from './reports/reports.module';
import { redisConnection } from './platform/queue/redis-connection';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';

/** Raíz de composición: importa los módulos por bounded context (backend.md §3). */
@Module({
  imports: [
    // Config global de BullMQ (colas de IA: forecasting E08, chat E09). Conexión
    // Redis desde REDIS_URL. Las colas concretas se registran en cada módulo.
    BullModule.forRoot({ connection: redisConnection() }),
    // Cron jobs (E08: forecast semanal). Cada @Cron declara su propia zona horaria.
    ScheduleModule.forRoot(),
    PlatformModule,
    AuthModule,
    UsersModule,
    TenantsModule,
    AuditModule,
    CatalogModule,
    PosModule,
    InventoryModule,
    BillingModule,
    CostingModule,
    ReportsModule,
    NotificationsModule,
    IngestionModule,
    ForecastingModule,
  ],
})
export class AppModule {}
