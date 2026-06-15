import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { PlatformModule } from '../platform/platform.module';
import { KitchenController } from './kitchen.controller';
import { KitchenService } from './kitchen.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { TablesController } from './tables.controller';
import { TablesService } from './tables.service';
import { ZonesController } from './zones.controller';
import { ZonesService } from './zones.service';

/** E03 — POS, Salón y Cocina (KDS): zonas, mesas, órdenes, comandas, estaciones. */
@Module({
  imports: [PlatformModule, AuthModule, AuthzModule],
  controllers: [
    ZonesController,
    TablesController,
    OrdersController,
    KitchenController,
  ],
  providers: [ZonesService, TablesService, OrdersService, KitchenService],
  // E04 (billing) reutiliza OrdersService para la vista de la orden al cobrar.
  exports: [OrdersService],
})
export class PosModule {}
