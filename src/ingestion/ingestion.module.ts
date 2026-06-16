import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { PlatformModule } from '../platform/platform.module';
import { SalesHistoryController } from './sales-history.controller';
import { SalesHistoryImportService } from './sales-history-import.service';
import { SalesHistoryService } from './sales-history.service';

/**
 * E11 — Migración desde ERPs legacy. Incremento construible: importación de
 * histórico de ventas por CSV (HU-11-03), idempotente (HU-11-04) y con dry-run de
 * validación (HU-11-05). Reutiliza `report-window.util` (ventana de fechas, zona
 * del tenant) de E07 sin importar su módulo. El magic-upload (R2 + IA) del wizard
 * (HU-11-01) queda diferido; HU-11-02 (importar productos) = HU-02-02 (hecho).
 */
@Module({
  imports: [PlatformModule, AuthModule, AuthzModule],
  controllers: [SalesHistoryController],
  providers: [SalesHistoryImportService, SalesHistoryService],
})
export class IngestionModule {}
