import { describe, expect, it, vi } from 'vitest';
import type { SystemDbClient } from '../platform/prisma/system-db.client';
import { ForecastScheduler } from './forecast.scheduler';
import type { ForecastingService } from './forecasting.service';

function makeScheduler(
  tenantIds: string[],
  enqueue: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({}),
) {
  const system = {
    findActiveTenantIds: vi.fn().mockResolvedValue(tenantIds),
  } as unknown as SystemDbClient;
  const forecasting = {
    enqueueForecast: enqueue,
  } as unknown as ForecastingService;
  return { scheduler: new ForecastScheduler(system, forecasting), enqueue };
}

describe('ForecastScheduler.runWeeklyForecasts', () => {
  it('encola un forecast total por cada tenant activo', async () => {
    const { scheduler, enqueue } = makeScheduler(['t-a', 't-b']);

    const result = await scheduler.runWeeklyForecasts();

    expect(result).toEqual({ tenants: 2, enqueued: 2 });
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledWith('t-a', {
      scope: 'total',
      horizon: 14,
    });
    expect(enqueue).toHaveBeenCalledWith('t-b', {
      scope: 'total',
      horizon: 14,
    });
  });

  it('el fallo de un tenant no corta a los demás (resiliencia)', async () => {
    const enqueue = vi
      .fn()
      .mockImplementation((tenantId: string) =>
        tenantId === 't-b'
          ? Promise.reject(new Error('boom'))
          : Promise.resolve({}),
      );
    const { scheduler } = makeScheduler(['t-a', 't-b', 't-c'], enqueue);

    const result = await scheduler.runWeeklyForecasts();

    expect(result).toEqual({ tenants: 3, enqueued: 2 }); // a y c sí; b falló
    expect(enqueue).toHaveBeenCalledTimes(3);
  });

  it('sin tenants activos no encola nada', async () => {
    const { scheduler, enqueue } = makeScheduler([]);

    const result = await scheduler.runWeeklyForecasts();

    expect(result).toEqual({ tenants: 0, enqueued: 0 });
    expect(enqueue).not.toHaveBeenCalled();
  });
});
