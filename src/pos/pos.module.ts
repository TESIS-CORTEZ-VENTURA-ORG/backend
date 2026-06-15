import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { PlatformModule } from '../platform/platform.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { TablesController } from './tables.controller';
import { TablesService } from './tables.service';
import { ZonesController } from './zones.controller';
import { ZonesService } from './zones.service';

/** E03 — POS, Salón y Cocina (KDS): zonas, mesas, órdenes, comandas. */
@Module({
  imports: [PlatformModule, AuthModule, AuthzModule],
  controllers: [ZonesController, TablesController, OrdersController],
  providers: [ZonesService, TablesService, OrdersService],
})
export class PosModule {}
