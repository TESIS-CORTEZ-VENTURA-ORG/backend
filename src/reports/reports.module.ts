import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { CatalogModule } from '../catalog/catalog.module';
import { PlatformModule } from '../platform/platform.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/**
 * E07 — Reportes y dashboards (read-only): dashboard de admin (HU-07-01), de
 * gerente (HU-07-02), de cajero (HU-07-03), reporte de ventas (HU-07-04),
 * análisis Pareto de platos (HU-07-08) y, en Inc 2, los reportes operativos —
 * inventario (HU-07-05), food cost (HU-07-06), mermas (HU-07-07) — más la
 * exportación CSV (HU-07-10, `?format=csv`, RFC-4180, sin dependencias). No añade
 * tablas ni migración: agrega ventas/órdenes/inventario existentes leyéndolos vía
 * `runInTenant`. Importa CatalogModule sólo para reutilizar `RecipesService` (costo
 * de ingredientes), igual que E06. El cierre Z (HU-07-09) ya vive en E04.
 */
@Module({
  imports: [PlatformModule, AuthModule, AuthzModule, CatalogModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
