import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { PlatformModule } from '../platform/platform.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

/** E05 — Inventario: stock/kardex, movimientos (entrada/salida), mermas y alertas. */
@Module({
  imports: [PlatformModule, AuthModule, AuthzModule],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule {}
