import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SystemDbClient } from '../platform/prisma/system-db.client';
import { ForecastingService } from './forecasting.service';

// Horizonte por defecto del forecast semanal automático (2 semanas).
const WEEKLY_HORIZON = 14;

/**
 * HU-08-03 · Forecast automático semanal. Cada lunes 03:00 (America/Lima) encola
 * un pronóstico `total` por cada tenant activo, reutilizando el flujo async (el
 * worker computa y persiste, con reintentos del job). Enumerar tenants es una
 * operación de sistema cross-tenant → `SystemDbClient` (BYPASSRLS, read-only); el
 * encolado por tenant sí queda scoped vía `runInTenant` dentro de `enqueueForecast`.
 *
 * Resiliente: el fallo de un tenant se loguea y no corta a los demás.
 */
@Injectable()
export class ForecastScheduler {
  private readonly logger = new Logger(ForecastScheduler.name);

  constructor(
    private readonly system: SystemDbClient,
    private readonly forecasting: ForecastingService,
  ) {}

  @Cron('0 3 * * 1', { name: 'weekly-forecast', timeZone: 'America/Lima' })
  async runWeeklyForecasts(): Promise<{ tenants: number; enqueued: number }> {
    const tenantIds = await this.system.findActiveTenantIds();
    let enqueued = 0;

    for (const tenantId of tenantIds) {
      try {
        await this.forecasting.enqueueForecast(tenantId, {
          scope: 'total',
          horizon: WEEKLY_HORIZON,
        });
        enqueued += 1;
      } catch (err) {
        this.logger.error(
          `Forecast semanal falló al encolar para el tenant ${tenantId}: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.log(
      `Forecast semanal: ${enqueued}/${tenantIds.length} tenants encolados`,
    );
    return { tenants: tenantIds.length, enqueued };
  }
}
