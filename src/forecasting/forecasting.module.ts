import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { PlatformModule } from '../platform/platform.module';
import { FORECAST_QUEUE } from '../platform/queue/redis-connection';
import { CoreAiClient } from './core-ai.client';
import { ForecastProcessor } from './forecast.processor';
import { ForecastScheduler } from './forecast.scheduler';
import { ForecastingController } from './forecasting.controller';
import { ForecastingService } from './forecasting.service';

/**
 * E08 — Motor de Forecasting con IA (lado orquestador NestJS). NestJS orquesta,
 * core-ai infiere (`backend.md` §3). El POST encola un job en BullMQ; el worker
 * (`ForecastProcessor`) llama a core-ai y persiste la corrida (`ForecastRun`).
 * Expone también la serie de demanda (seam), el polling de la corrida y las
 * últimas predicciones por ámbito (HU-08-04).
 */
@Module({
  imports: [
    PlatformModule,
    AuthModule,
    AuthzModule,
    BullModule.registerQueue({ name: FORECAST_QUEUE }),
  ],
  controllers: [ForecastingController],
  providers: [
    ForecastingService,
    CoreAiClient,
    ForecastProcessor,
    ForecastScheduler,
  ],
})
export class ForecastingModule {}
