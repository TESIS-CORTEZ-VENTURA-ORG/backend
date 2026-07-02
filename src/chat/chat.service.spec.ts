/**
 * Unit tests for ChatService — E09 bugfix (2026-07-02).
 *
 * Root cause under test: a raw-query execution failure (e.g. the LLM
 * referencing a column that does not exist in the real schema, or a query
 * that legitimately times out) used to propagate as an UNHANDLED exception,
 * which NestJS turned into a bare `500 Internal server error`. This suite
 * asserts the failure is now always mapped to a controlled HttpException
 * (502/504), never left unhandled — this reproduces the exact production
 * incident for "¿Qué insumos están por agotarse?"
 * (`column i.current_cost does not exist`, Postgres code 42703).
 */

import { BadGatewayException, GatewayTimeoutException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

function buildCoreAiChat(sql: string): CoreAiChatClient {
  return {
    nl2sql: vi.fn().mockResolvedValue({
      sql,
      provider: 'mock',
      model: 'mock-v1',
      notes: 'test stub',
    }),
    answerFromRows: vi.fn().mockResolvedValue({
      answer: 'Respuesta de prueba.',
      provider: 'mock',
    }),
  } as unknown as CoreAiChatClient;
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
      buildCoreAiChat('SELECT i.current_cost FROM ingredients i LIMIT 200'),
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
      buildCoreAiChat('SELECT 1 FROM ingredients LIMIT 200'),
    );

    await expect(
      service.query('tenant-1', 'pregunta cualquiera'),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('statement_timeout (57014) → 504 GatewayTimeoutException', async () => {
    mockTx.$queryRawUnsafe.mockRejectedValue(
      pgError('57014', 'canceling statement due to statement timeout'),
    );
    const service = new ChatService(
      mockPrisma as never,
      buildCoreAiChat('SELECT * FROM sales_history LIMIT 200'),
    );

    await expect(
      service.query('tenant-1', 'pregunta cara'),
    ).rejects.toBeInstanceOf(GatewayTimeoutException);
  });

  it('non-Prisma error (unexpected shape) still degrades to 502, never rethrown raw', async () => {
    mockTx.$queryRawUnsafe.mockRejectedValue(new Error('boom'));
    const service = new ChatService(
      mockPrisma as never,
      buildCoreAiChat('SELECT 1 FROM sales_history LIMIT 200'),
    );

    await expect(service.query('tenant-1', 'pregunta')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('happy path still resolves normally when execution succeeds', async () => {
    mockTx.$queryRawUnsafe.mockResolvedValue([
      { name: 'Pulpo', stock: '2.000' },
    ]);
    const service = new ChatService(
      mockPrisma as never,
      buildCoreAiChat(
        'SELECT name, stock FROM ingredients WHERE stock <= min_stock LIMIT 200',
      ),
    );

    const result = await service.query('tenant-1', '¿stock bajo?');
    expect(result.columns).toEqual(['name', 'stock']);
    expect(result.rows).toEqual([['Pulpo', '2.000']]);
    expect(result.answer).toBe('Respuesta de prueba.');
  });
});
