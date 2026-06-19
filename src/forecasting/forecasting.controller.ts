import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PoliciesGuard } from '../authz/policies.guard';
import { RequireAbility } from '../authz/require-ability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  demandSeriesQuerySchema,
  ok,
  type ApiResponse,
  type DemandSeriesQueryInput,
  type JwtClaims,
} from '../shared';
import {
  ForecastingService,
  type DemandSeriesResponse,
} from './forecasting.service';

/**
 * E08 · Orquestador de forecasting (lado NestJS). Este incremento expone el
 * *seam de datos*: la serie de demanda diaria agregada desde `sales_history`, que
 * es la entrada del microservicio `core-ai`. Generar el pronóstico (llamar a
 * `core-ai` vía BullMQ, persistir `ForecastRun`) es el siguiente incremento.
 *
 * Es información de gestión/análisis → sujeto CASL `Report` (`read`): owner y
 * manager pueden leer la serie; `staff` → 403 (misma matriz que dashboards E07).
 * `tenant_id` SIEMPRE del JWT; acceso vía `runInTenant`.
 */
@Controller('forecasting')
@UseGuards(JwtAuthGuard, PoliciesGuard)
export class ForecastingController {
  constructor(private readonly forecasting: ForecastingService) {}

  // E08 · Serie de demanda diaria (zero-filled) lista para core-ai. read Report.
  @Get('series')
  @RequireAbility('read', 'Report')
  async series(
    @CurrentUser() claims: JwtClaims,
    @Query(new ZodValidationPipe(demandSeriesQuerySchema))
    query: DemandSeriesQueryInput,
  ): Promise<ApiResponse<DemandSeriesResponse>> {
    return ok(
      await this.forecasting.demandSeries(
        claims.tenant_id,
        query.scope,
        query.menuItemId,
        query.from,
        query.to,
      ),
    );
  }
}
