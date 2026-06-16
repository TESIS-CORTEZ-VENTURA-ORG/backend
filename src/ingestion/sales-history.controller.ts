import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Audited } from '../audit/audited.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PoliciesGuard } from '../authz/policies.guard';
import { RequireAbility } from '../authz/require-ability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  importSalesHistorySchema,
  ok,
  salesHistoryQuerySchema,
  type ApiResponse,
  type ImportSalesHistoryInput,
  type JwtClaims,
  type SalesHistoryQueryInput,
} from '../shared';
import {
  SalesHistoryImportService,
  type SalesImportReport,
} from './sales-history-import.service';
import {
  SalesHistoryService,
  type SalesHistoryList,
} from './sales-history.service';

/**
 * E11 · HU-11-03/04/05 — Importación de histórico de ventas (CSV) con dry-run e
 * idempotencia. Es una tarea de **migración/gestión**, no operativa: se reutiliza
 * el sujeto CASL `Report` → owner/manager (`manage Report`) importan; `staff` NO
 * (recibe 403). La lectura/verificación del histórico es `read Report` (misma
 * matriz; no se modifica). `tenant_id` SIEMPRE del JWT; acceso vía `runInTenant`.
 */
@Controller('sales-history')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class SalesHistoryController {
  constructor(
    private readonly importer: SalesHistoryImportService,
    private readonly history: SalesHistoryService,
  ) {}

  // HU-11-03 · Lista/agrega el histórico importado en una ventana (verificación
  // + futuro forecasting). read Report (owner/manager; staff → 403).
  @Get()
  @RequireAbility('read', 'Report')
  async list(
    @CurrentUser() claims: JwtClaims,
    @Query(new ZodValidationPipe(salesHistoryQuerySchema))
    query: SalesHistoryQueryInput,
  ): Promise<ApiResponse<SalesHistoryList>> {
    return ok(await this.history.list(claims.tenant_id, query.from, query.to));
  }

  // HU-11-03/04/05 · Importa el histórico desde CSV. dryRun=true → valida sin
  // escribir (HU-11-05). manage Report (owner/manager; staff → 403).
  @Post('import')
  @RequireAbility('manage', 'Report')
  @Audited('sales_history.import')
  async import(
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(importSalesHistorySchema))
    dto: ImportSalesHistoryInput,
  ): Promise<ApiResponse<SalesImportReport>> {
    return ok(
      await this.importer.importCsv(
        claims.tenant_id,
        dto.content,
        dto.dryRun ?? false,
      ),
    );
  }
}
