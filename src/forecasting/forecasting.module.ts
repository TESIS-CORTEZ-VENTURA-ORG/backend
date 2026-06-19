import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthzModule } from '../authz/authz.module';
import { PlatformModule } from '../platform/platform.module';
import { ForecastingController } from './forecasting.controller';
import { ForecastingService } from './forecasting.service';

/**
 * E08 — Motor de Forecasting con IA (lado orquestador NestJS). Incremento
 * construible: el *seam de datos* — agregar `sales_history` en una serie de
 * demanda diaria zero-filled lista para `core-ai`. La inferencia vive en el
 * microservicio FastAPI (`core-ai`); este módulo orquesta. La llamada HTTP a
 * core-ai vía BullMQ y la persistencia de `ForecastRun` quedan para el siguiente
 * incremento (HU-08-02 async).
 */
@Module({
  imports: [PlatformModule, AuthModule, AuthzModule],
  controllers: [ForecastingController],
  providers: [ForecastingService],
})
export class ForecastingModule {}
