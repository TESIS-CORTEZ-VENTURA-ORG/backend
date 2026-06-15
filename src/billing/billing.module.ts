import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { CatalogModule } from '../catalog/catalog.module';
import { PlatformModule } from '../platform/platform.module';
import { PosModule } from '../pos/pos.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

/**
 * E04 — Cobros y comprobantes: pre-cuenta, cuenta final (ticket boleta/factura
 * con correlativo + IGV), pagos (efectivo/electrónico/mixto) y anulación.
 * Importa POS para reutilizar `OrdersService` (vista de la orden al cobrar) y
 * CATALOG para reutilizar `RecipesService` (explosión del BOM → auto-consumo de
 * stock al vender, E05).
 */
@Module({
  imports: [PlatformModule, AuthModule, AuthzModule, PosModule, CatalogModule],
  controllers: [BillingController],
  providers: [BillingService],
})
export class BillingModule {}
