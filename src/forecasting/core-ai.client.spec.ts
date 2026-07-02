import {
  BadGatewayException,
  GatewayTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoreAiClient, type CoreAiForecastRequest } from './core-ai.client';

const REQUEST: CoreAiForecastRequest = {
  series_id: 'total',
  frequency: 'D',
  horizon: 7,
  history: [
    { ds: '2024-01-01', y: 10 },
    { ds: '2024-01-02', y: 12 },
  ],
};

const VALID_RESPONSE = {
  series_id: 'total',
  engine: 'statsforecast',
  model: 'AutoETS',
  baseline: 'SeasonalNaive',
  frequency: 'D',
  points: [{ target_date: '2024-01-03', yhat: 11, yhat_lo: 8, yhat_hi: 14 }],
  backtest: null,
};

// HU-08-07 · Shape con contexto activado: drivers + context_status "full" +
// backtest con la comparativa model_smape_no_context (motor "ml").
const CONTEXT_RESPONSE = {
  series_id: 'total',
  engine: 'ml',
  model: 'LightGBM',
  baseline: 'SeasonalNaive',
  frequency: 'D',
  points: [{ target_date: '2024-01-03', yhat: 11, yhat_lo: 8, yhat_hi: 14 }],
  backtest: {
    holdout_size: 14,
    model_smape: 6.8,
    baseline_smape: 8.1,
    improvement_pct: 16.1,
    model_smape_no_context: 11.0,
  },
  drivers: [
    {
      date: '2024-01-03',
      kind: 'holiday',
      label: 'Año Nuevo',
      impact_pct: -5.8,
    },
  ],
  context_status: 'full',
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('CoreAiClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('POSTea a /forecast/run y devuelve la respuesta parseada', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(VALID_RESPONSE));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new CoreAiClient().runForecast(REQUEST);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/forecast\/run$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({
      series_id: 'total',
      horizon: 7,
    });
    expect(result.model).toBe('AutoETS');
    expect(result.points).toHaveLength(1);
  });

  it('propaga BadGateway cuando core-ai responde no-ok (con detail)', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ detail: 'engine timesfm no implementado' }, 501),
        ),
    );

    await expect(
      new CoreAiClient().runForecast(REQUEST),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('lanza ServiceUnavailable cuando la red falla', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    );

    await expect(
      new CoreAiClient().runForecast(REQUEST),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('lanza GatewayTimeout (504) cuando core-ai no responde a tiempo', async () => {
    // AbortSignal.timeout aborta con un error de nombre TimeoutError.
    const timeout = Object.assign(new Error('timed out'), {
      name: 'TimeoutError',
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout));

    await expect(
      new CoreAiClient().runForecast(REQUEST),
    ).rejects.toBeInstanceOf(GatewayTimeoutException);
  });

  it('lanza BadGateway si la respuesta tiene forma inesperada', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ unexpected: true })),
    );

    await expect(
      new CoreAiClient().runForecast(REQUEST),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  // HU-08-07 (fase 2) — contexto exógeno: use_context/location viajan tal cual
  // en el body, y drivers/context_status/model_smape_no_context se parsean.
  describe('HU-08-07 · contexto exógeno', () => {
    it('serializa use_context y location en el body cuando se piden', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse(CONTEXT_RESPONSE));
      vi.stubGlobal('fetch', fetchMock);

      await new CoreAiClient().runForecast({
        ...REQUEST,
        engine: 'auto',
        use_context: true,
        location: { latitude: -12.046, longitude: -77.043 },
      });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.use_context).toBe(true);
      expect(body.location).toEqual({ latitude: -12.046, longitude: -77.043 });
      expect(body.engine).toBe('auto');
    });

    it('omite location cuando no se pasa (core-ai aplica su default Lima)', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse(CONTEXT_RESPONSE));
      vi.stubGlobal('fetch', fetchMock);

      await new CoreAiClient().runForecast({ ...REQUEST, use_context: true });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.use_context).toBe(true);
      expect('location' in body).toBe(false);
    });

    it('parsea drivers, context_status y model_smape_no_context', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse(CONTEXT_RESPONSE)),
      );

      const result = await new CoreAiClient().runForecast({
        ...REQUEST,
        use_context: true,
      });

      expect(result.context_status).toBe('full');
      expect(result.drivers).toHaveLength(1);
      expect(result.drivers[0]?.kind).toBe('holiday');
      expect(result.backtest?.model_smape_no_context).toBe(11.0);
    });

    it('request legacy (sin use_context/location) sigue funcionando idéntico a antes', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse(VALID_RESPONSE)),
      );

      // VALID_RESPONSE no trae drivers/context_status/model_smape_no_context —
      // el contrato retrocompatible los defaultea a []/"off"/null.
      const result = await new CoreAiClient().runForecast(REQUEST);

      expect(result.drivers).toEqual([]);
      expect(result.context_status).toBe('off');
      expect(result.backtest).toBeNull();
    });
  });
});
