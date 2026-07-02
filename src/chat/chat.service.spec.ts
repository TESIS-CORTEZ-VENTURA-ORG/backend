/**
 * Unit tests for ChatService — E09 bugfix (2026-07-02) + LOTE B3 refinement
 * (preguntas sobre el futuro + rechazo elegante fuera de dominio).
 *
 * Root cause under test (original suite): a raw-query execution failure
 * (e.g. the LLM referencing a column that does not exist in the real schema,
 * or a query that legitimately times out) used to propagate as an UNHANDLED
 * exception, which NestJS turned into a bare `500 Internal server error`.
 * This suite asserts the failure is now always mapped to a controlled
 * HttpException (502/504), never left unhandled — this reproduces the exact
 * production incident for "¿Qué insumos están por agotarse?"
 * (`column i.current_cost does not exist`, Postgres code 42703).
 *
 * LOTE B3 additions: `classifyIntent` branches (future/out_of_domain/
 * ambiguous) must NEVER reach `CoreAiChatClient.nl2sql` — the security
 * invariant this suite proves is that the intent gate runs BEFORE the LLM
 * call, not as an afterthought filter on its output.
 */

import { BadGatewayException, GatewayTimeoutException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ForecastRangeAnswer } from '../forecasting/forecasting.service';
import { ChatService } from './chat.service';
import { type CoreAiChatClient } from './core-ai-chat.client';

// ---- helpers ---------------------------------------------------------------

/** Build a PrismaClientKnownRequestError shaped like a real raw-query failure. */
function pgError(
  pgCode: string,
  message: string,
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    `Raw query failed. Code: \`${pgCode}\`. Message: \`${message}\``,
    { code: 'P2010', clientVersion: '6.19.3', meta: { code: pgCode, message } },
  );
}

const mockTx = {
  $executeRaw: vi.fn().mockResolvedValue(undefined),
  $queryRawUnsafe: vi.fn(),
};

const mockPrisma = {
  runInTenant: vi.fn(
    (_tenantId: string, fn: (tx: typeof mockTx) => Promise<unknown>) =>
      fn(mockTx),
  ),
};

/**
 * Returns the mock instance PLUS the raw `nl2sql` mock function separately.
 * Asserting on `client.nl2sql` directly (a typed `CoreAiChatClient` method)
 * trips `@typescript-eslint/unbound-method` — returning the underlying
 * `vi.fn()` as a plain value sidesteps that without weakening the assertion.
 */
function buildCoreAiChat(sql: string) {
  const nl2sql = vi.fn().mockResolvedValue({
    sql,
    provider: 'mock',
    model: 'mock-v1',
    notes: 'test stub',
  });
  const answerFromRows = vi.fn().mockResolvedValue({
    answer: 'Respuesta de prueba.',
    provider: 'mock',
  });
  const client = { nl2sql, answerFromRows } as unknown as CoreAiChatClient;
  return { client, nl2sql, answerFromRows };
}

/** ForecastingService stub — only `getForecastForRange` is exercised by ChatService. */
function buildForecasting(result?: Partial<ForecastRangeAnswer>) {
  const defaultResult: ForecastRangeAnswer = {
    needsForecast: true,
    runId: null,
    outOfHorizon: false,
    horizonEnd: null,
    generatedAt: null,
    points: [],
    totalYhat: null,
    totalLo: null,
    totalHi: null,
    drivers: [],
    avgUnitPrice: null,
  };
  return {
    getForecastForRange: vi
      .fn()
      .mockResolvedValue({ ...defaultResult, ...result }),
  };
}

describe('ChatService — execution error mapping (never an unhandled 500)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.runInTenant.mockImplementation(
      (_tenantId: string, fn: (tx: typeof mockTx) => Promise<unknown>) =>
        fn(mockTx),
    );
  });

  it('undefined column (42703) → 502 BadGatewayException, not a raw 500', async () => {
    // Reproduces the exact production bug: schema_context described
    // `ingredients.current_cost`, which does not exist — Postgres rejects
    // the query with SQLSTATE 42703.
    mockTx.$queryRawUnsafe.mockRejectedValue(
      pgError('42703', 'column i.current_cost does not exist'),
    );
    const service = new ChatService(
      mockPrisma as never,
      buildCoreAiChat('SELECT i.current_cost FROM ingredients i LIMIT 200')
        .client,
      buildForecasting() as never,
    );

    await expect(
      service.query('tenant-1', '¿Qué insumos están por agotarse?'),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('undefined table (42P01) → 502 BadGatewayException', async () => {
    mockTx.$queryRawUnsafe.mockRejectedValue(
      pgError('42P01', 'relation "does_not_exist" does not exist'),
    );
    const service = new ChatService(
      mockPrisma as never,
      buildCoreAiChat('SELECT 1 FROM ingredients LIMIT 200').client,
      buildForecasting() as never,
    );

    await expect(
      service.query('tenant-1', 'pregunta cualquiera sobre ingredientes'),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('statement_timeout (57014) → 504 GatewayTimeoutException', async () => {
    mockTx.$queryRawUnsafe.mockRejectedValue(
      pgError('57014', 'canceling statement due to statement timeout'),
    );
    const service = new ChatService(
      mockPrisma as never,
      buildCoreAiChat('SELECT * FROM sales_history LIMIT 200').client,
      buildForecasting() as never,
    );

    await expect(
      service.query('tenant-1', 'pregunta cara sobre ventas'),
    ).rejects.toBeInstanceOf(GatewayTimeoutException);
  });

  it('non-Prisma error (unexpected shape) still degrades to 502, never rethrown raw', async () => {
    mockTx.$queryRawUnsafe.mockRejectedValue(new Error('boom'));
    const service = new ChatService(
      mockPrisma as never,
      buildCoreAiChat('SELECT 1 FROM sales_history LIMIT 200').client,
      buildForecasting() as never,
    );

    await expect(
      service.query('tenant-1', 'pregunta sobre ventas'),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('happy path still resolves normally when execution succeeds', async () => {
    mockTx.$queryRawUnsafe.mockResolvedValue([
      { name: 'Pulpo', stock: '2.000' },
    ]);
    const service = new ChatService(
      mockPrisma as never,
      buildCoreAiChat(
        'SELECT name, stock FROM ingredients WHERE stock <= min_stock LIMIT 200',
      ).client,
      buildForecasting() as never,
    );

    const result = await service.query('tenant-1', '¿stock bajo de insumos?');
    expect(result.columns).toEqual(['name', 'stock']);
    expect(result.rows).toEqual([['Pulpo', '2.000']]);
    expect(result.answer).toBe('Respuesta de prueba.');
    expect(result.kind).toBe('historical');
  });
});

describe('ChatService — LOTE B3: clasificación de intención', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.runInTenant.mockImplementation(
      (_tenantId: string, fn: (tx: typeof mockTx) => Promise<unknown>) =>
        fn(mockTx),
    );
  });

  it('out_of_domain: never calls core-ai nl2sql (nunca llega al executor)', async () => {
    const { client, nl2sql } = buildCoreAiChat(
      'SELECT 1 FROM sales_history LIMIT 200',
    );
    const service = new ChatService(
      mockPrisma as never,
      client,
      buildForecasting() as never,
    );

    const result = await service.query('tenant-1', '¿quién ganó el mundial?');

    expect(nl2sql).not.toHaveBeenCalled();
    expect(mockTx.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(result.kind).toBe('out_of_domain');
    expect(result.sql).toBe('');
    expect(result.rows).toEqual([]);
    expect(result.answer).toContain('Solo puedo responder');
  });

  it('ambiguous: never calls core-ai nl2sql, suggests concrete example questions', async () => {
    const { client, nl2sql } = buildCoreAiChat(
      'SELECT 1 FROM sales_history LIMIT 200',
    );
    const service = new ChatService(
      mockPrisma as never,
      client,
      buildForecasting() as never,
    );

    const result = await service.query('tenant-1', '¿cómo va todo?');

    expect(nl2sql).not.toHaveBeenCalled();
    expect(mockTx.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(result.kind).toBe('ambiguous');
    expect(result.sql).toBe('');
    // Offers concrete example questions, not a vague apology.
    expect(result.answer).toContain('ventas');
  });

  it('future WITHOUT a completed run: never calls core-ai nl2sql, explains and does not auto-trigger a run', async () => {
    const { client, nl2sql } = buildCoreAiChat(
      'SELECT 1 FROM sales_history LIMIT 200',
    );
    const forecasting = buildForecasting({ needsForecast: true });
    const service = new ChatService(
      mockPrisma as never,
      client,
      forecasting as never,
    );

    const result = await service.query(
      'tenant-1',
      '¿cuánto voy a vender este fin de semana?',
    );

    expect(nl2sql).not.toHaveBeenCalled();
    expect(forecasting.getForecastForRange).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('future');
    expect(result.forecast).toBeUndefined();
    expect(result.answer).toContain('Todavía no hay ningún pronóstico');
  });

  it('future with a run but the range is OUTSIDE the forecasted horizon', async () => {
    const forecasting = buildForecasting({
      needsForecast: false,
      runId: 'run-1',
      outOfHorizon: true,
      horizonEnd: '2026-07-09',
    });
    const service = new ChatService(
      mockPrisma as never,
      buildCoreAiChat('SELECT 1 FROM sales_history LIMIT 200').client,
      forecasting as never,
    );

    const result = await service.query(
      'tenant-1',
      '¿cuánto voy a vender el próximo mes?',
    );

    expect(result.kind).toBe('future');
    expect(result.forecast).toBeUndefined();
    expect(result.answer).toContain('fuera del rango');
    expect(result.answer).toContain('2026-07-09');
  });

  it('future WITH points in range: returns the real projection in UNITS (platos), no SQL — QA-23', async () => {
    const forecasting = buildForecasting({
      needsForecast: false,
      outOfHorizon: false,
      runId: '11111111-1111-1111-1111-111111111111',
      generatedAt: '2026-07-01T12:00:00.000Z',
      points: [
        { target_date: '2026-07-04', yhat: 100, yhat_lo: 80, yhat_hi: 120 },
        { target_date: '2026-07-05', yhat: 90, yhat_lo: 70, yhat_hi: 110 },
      ],
      totalYhat: 190,
      totalLo: 150,
      totalHi: 230,
      drivers: [
        {
          date: '2026-07-05',
          kind: 'payday',
          label: 'Quincena del 15',
          impact_pct: 12,
        },
      ],
      // No sales in the reference window for this stub tenant — the answer
      // must degrade to units-only, NEVER fabricate a S/ figure.
      avgUnitPrice: null,
    });
    const { client, nl2sql } = buildCoreAiChat(
      'SELECT 1 FROM sales_history LIMIT 200',
    );
    const service = new ChatService(
      mockPrisma as never,
      client,
      forecasting as never,
    );

    const result = await service.query(
      'tenant-1',
      '¿cuánto voy a vender este fin de semana?',
    );

    expect(nl2sql).not.toHaveBeenCalled();
    expect(result.kind).toBe('future');
    expect(result.sql).toBe('');
    // QA-23 root cause under test: the old code formatted 190 (UNITS, sum of
    // `qty`) as "S/ 190.00" — a fabricated currency figure ~1% of the real
    // daily sales. The fix reports the real unit ("platos") and never prints
    // "S/" unless a derived estimate is actually available.
    expect(result.answer).toContain('190 platos');
    expect(result.answer).not.toContain('S/');
    expect(result.answer).toContain('Quincena del 15');
    expect(result.answer).toContain('proyección del modelo');
    expect(result.forecast).toMatchObject({
      runId: '11111111-1111-1111-1111-111111111111',
      totalYhat: 190,
      totalLo: 150,
      totalHi: 230,
      unitLabel: 'platos',
      estimatedRevenue: null,
    });
    expect(result.forecast?.points).toHaveLength(2);
    expect(result.forecast?.drivers).toHaveLength(1);
  });

  it('future WITH avgUnitPrice available: derives + labels an estimated S/ figure — QA-23', async () => {
    const forecasting = buildForecasting({
      needsForecast: false,
      outOfHorizon: false,
      runId: '11111111-1111-1111-1111-111111111111',
      generatedAt: '2026-07-01T12:00:00.000Z',
      points: [
        { target_date: '2026-07-04', yhat: 45, yhat_lo: 38, yhat_hi: 54 },
        { target_date: '2026-07-05', yhat: 46, yhat_lo: 38, yhat_hi: 55 },
      ],
      totalYhat: 91,
      totalLo: 76,
      totalHi: 109,
      drivers: [],
      avgUnitPrice: 46.55,
    });
    const service = new ChatService(
      mockPrisma as never,
      buildCoreAiChat('SELECT 1 FROM sales_history LIMIT 200').client,
      forecasting as never,
    );

    const result = await service.query(
      'tenant-1',
      '¿cuánto voy a vender este fin de semana?',
    );

    expect(result.answer).toContain('91 platos');
    expect(result.answer).toContain('S/ 4236.05');
    expect(result.answer).toContain('ticket promedio por plato');
    expect(result.answer).toContain('S/ 46.55/plato');
    expect(result.forecast?.estimatedRevenue).toEqual({
      total: 4236.05,
      lo: 3537.8,
      hi: 5073.95,
      avgUnitPrice: 46.55,
      basisDays: 30,
    });
  });

  it('QA-22: two drivers sharing the same label are narrated ONCE, not duplicated', async () => {
    const forecasting = buildForecasting({
      needsForecast: false,
      outOfHorizon: false,
      runId: '11111111-1111-1111-1111-111111111111',
      points: [
        { target_date: '2026-07-04', yhat: 45, yhat_lo: 38, yhat_hi: 54 },
        { target_date: '2026-07-05', yhat: 46, yhat_lo: 38, yhat_hi: 55 },
      ],
      totalYhat: 91,
      totalLo: 76,
      totalHi: 109,
      drivers: [
        {
          date: '2026-07-04',
          kind: 'weekend',
          label: 'Fin de semana',
          impact_pct: 54,
        },
        {
          date: '2026-07-05',
          kind: 'weekend',
          label: 'Fin de semana',
          impact_pct: 54,
        },
      ],
      avgUnitPrice: null,
    });
    const service = new ChatService(
      mockPrisma as never,
      buildCoreAiChat('SELECT 1 FROM sales_history LIMIT 200').client,
      forecasting as never,
    );

    const result = await service.query(
      'tenant-1',
      '¿cuánto voy a vender este fin de semana?',
    );

    expect(result.answer).toContain('Incluye el efecto de Fin de semana.');
    expect(result.answer).not.toContain('Fin de semana, Fin de semana');
  });

  it('historical regression: still calls core-ai nl2sql like before', async () => {
    mockTx.$queryRawUnsafe.mockResolvedValue([]);
    const { client, nl2sql } = buildCoreAiChat(
      'SELECT name, stock, min_stock FROM ingredients WHERE stock <= min_stock LIMIT 200',
    );
    const service = new ChatService(
      mockPrisma as never,
      client,
      buildForecasting() as never,
    );

    const result = await service.query(
      'tenant-1',
      '¿qué insumos están por agotarse?',
    );

    expect(nl2sql).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('historical');
  });
});
