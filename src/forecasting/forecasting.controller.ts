import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PoliciesGuard } from '../authz/policies.guard';
import { RequireAbility } from '../authz/require-ability.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  demandSeriesQuerySchema,
  ok,
  predictionsQuerySchema,
  runForecastSchema,
  shoppingSuggestionsQuerySchema,
  type ApiResponse,
  type DemandSeriesQueryInput,
  type JwtClaims,
  type PredictionsQueryInput,
  type RunForecastInput,
  type ShoppingSuggestionsQuery,
  type ShoppingSuggestionsResponse,
} from '../shared';
import {
  ForecastingService,
  type DemandSeriesResponse,
  type ForecastRunView,
  type ForecastValidationView,
} from './forecasting.service';

/**
 * E08 · Orquestador de forecasting (lado NestJS). NestJS orquesta, core-ai infiere.
 * El `POST /run` ENCOLA (async, BullMQ → `ForecastRun`); el resultado se consulta
 * por `GET /runs/:id` (polling) y las últimas predicciones por `GET /predictions`.
 *
 * Información de gestión/análisis → CASL `Report`: `read` para consultar series,
 * corridas y predicciones; lanzar una corrida es `manage Report` (acción de
 * gestión que consume cómputo). `staff` → 403. `tenant_id` SIEMPRE del JWT.
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

  // HU-08-02 · Encola un forecast (async). Devuelve la corrida en `running` (202).
  @Post('run')
  @HttpCode(202)
  @RequireAbility('manage', 'Report')
  async run(
    @CurrentUser() claims: JwtClaims,
    @Body(new ZodValidationPipe(runForecastSchema))
    dto: RunForecastInput,
  ): Promise<ApiResponse<ForecastRunView>> {
    return ok(await this.forecasting.enqueueForecast(claims.tenant_id, dto));
  }

  // HU-08-02 · Estado/resultado de una corrida (polling). read Report.
  @Get('runs/:id')
  @RequireAbility('read', 'Report')
  async getRun(
    @CurrentUser() claims: JwtClaims,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<ForecastRunView>> {
    return ok(await this.forecasting.getRun(claims.tenant_id, id));
  }

  // HU-08-04 · Últimas predicciones por ámbito (corrida completada más reciente). read Report.
  @Get('predictions')
  @RequireAbility('read', 'Report')
  async predictions(
    @CurrentUser() claims: JwtClaims,
    @Query(new ZodValidationPipe(predictionsQuerySchema))
    query: PredictionsQueryInput,
  ): Promise<ApiResponse<ForecastRunView>> {
    return ok(
      await this.forecasting.getLatestPredictions(
        claims.tenant_id,
        query.scope,
        query.menuItemId,
      ),
    );
  }

  // HU-08-05 · Validación del último pronóstico vs real (predicho/real, error %,
  // MAPE acumulado, cobertura del intervalo q10–q90). read Report.
  @Get('validation')
  @RequireAbility('read', 'Report')
  async validation(
    @CurrentUser() claims: JwtClaims,
    @Query(new ZodValidationPipe(predictionsQuerySchema))
    query: PredictionsQueryInput,
  ): Promise<ApiResponse<ForecastValidationView>> {
    return ok(
      await this.forecasting.validateLatest(
        claims.tenant_id,
        query.scope,
        query.menuItemId,
      ),
    );
  }

  /**
   * HU-08-06 · Sugerencias de compra basadas en el último pronóstico completado.
   * Explota el BOM de todos los platos activos, compara consumo proyectado vs stock
   * actual y devuelve los insumos con shortfall. `needsForecast: true` si no hay
   * corrida completada. `tenant_id` SIEMPRE del JWT. CASL `read Report`.
   */
  @Get('shopping-suggestions')
  @RequireAbility('read', 'Report')
  async shoppingSuggestions(
    @CurrentUser() claims: JwtClaims,
    @Query(new ZodValidationPipe(shoppingSuggestionsQuerySchema))
    query: ShoppingSuggestionsQuery,
  ): Promise<ApiResponse<ShoppingSuggestionsResponse>> {
    return ok(
      await this.forecasting.shoppingSuggestions(
        claims.tenant_id,
        query.horizon,
      ),
    );
  }
}
