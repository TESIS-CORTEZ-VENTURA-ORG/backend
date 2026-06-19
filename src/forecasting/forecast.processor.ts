import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { FORECAST_QUEUE } from '../platform/queue/redis-connection';
import {
  ForecastingService,
  type ForecastJobData,
} from './forecasting.service';

/**
 * E08 · Worker de la cola de forecasting. Toma cada job encolado por
 * `enqueueForecast`, computa el pronóstico (agrega + llama a core-ai) y persiste
 * el resultado en la corrida. La lógica vive en el servicio; el processor solo
 * orquesta el job. `processRun` no relanza (el fallo queda en la corrida), así que
 * el job no reintenta en bucle por errores de negocio (p. ej. histórico insuficiente).
 */
@Processor(FORECAST_QUEUE)
export class ForecastProcessor extends WorkerHost {
  constructor(private readonly forecasting: ForecastingService) {
    super();
  }

  async process(job: Job<ForecastJobData>): Promise<void> {
    const { runId, tenantId, input } = job.data;
    await this.forecasting.processRun(runId, tenantId, input);
  }
}
