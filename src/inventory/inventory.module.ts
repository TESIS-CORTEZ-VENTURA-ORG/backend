import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlatformModule } from '../platform/platform.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';

/**
 * E05 — Inventario: stock/kardex, movimientos (entrada/salida), mermas y alertas
 * (Inc 1) + órdenes de compra (crear/enviar/recepcionar/cancelar, Inc 2). Importa
 * NotificationsModule para emitir la notificación `low_stock` (E10/HU-10-01)
 * cuando un movimiento cruza el stock mínimo.
 */
@Module({
  imports: [PlatformModule, AuthModule, AuthzModule, NotificationsModule],
  controllers: [InventoryController, PurchaseOrdersController],
  providers: [InventoryService, PurchaseOrdersService],
})
export class InventoryModule {}
