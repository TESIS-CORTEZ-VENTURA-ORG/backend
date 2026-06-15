import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { CatalogModule } from './catalog/catalog.module';
import { InventoryModule } from './inventory/inventory.module';
import { PlatformModule } from './platform/platform.module';
import { PosModule } from './pos/pos.module';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';

/** Raíz de composición: importa los módulos por bounded context (backend.md §3). */
@Module({
  imports: [
    PlatformModule,
    AuthModule,
    UsersModule,
    TenantsModule,
    AuditModule,
    CatalogModule,
    PosModule,
    InventoryModule,
    BillingModule,
  ],
})
export class AppModule {}
