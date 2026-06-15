import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { CatalogModule } from '../catalog/catalog.module';
import { PlatformModule } from '../platform/platform.module';
import { CostingController } from './costing.controller';
import { CostingService } from './costing.service';
import { OverheadController } from './overhead.controller';
import { OverheadService } from './overhead.service';

/**
 * E06 — Costeo dinámico y márgenes: costos indirectos (CIF) mensuales (HU-06-02),
 * prorrateo del CIF (HU-06-03), costo total + margen por plato (HU-06-01/04),
 * sugerencia de precio por margen objetivo (HU-06-05), cierre de período mensual
 * (HU-06-06) y comparativo costo real vs teórico (HU-06-07). Importa CatalogModule
 * para reutilizar `RecipesService` (costo de ingredientes por BOM recursivo).
 */
@Module({
  imports: [PlatformModule, AuthModule, AuthzModule, CatalogModule],
  controllers: [OverheadController, CostingController],
  providers: [OverheadService, CostingService],
})
export class CostingModule {}
