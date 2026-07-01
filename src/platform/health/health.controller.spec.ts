/**
 * Unit tests for HealthController (HU-12-02, defecto E12-1).
 *
 * Strategy:
 * - PrismaService is provided as a minimal structural mock (only $queryRaw is
 *   needed). No NestJS testing module is used — plain instantiation keeps the
 *   test fast and free of framework bootstrap overhead.
 * - ioredis is fully mocked via vi.mock so no real Redis connection is opened.
 *   vi.hoisted is required because vi.mock is hoisted above variable declarations
 *   at compile time; without it the factory closure cannot reference the mock vars.
 */
import type { FastifyReply } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';

// ---------------------------------------------------------------------------
// ioredis mock — hoisted so the vi.mock factory below can close over these vars.
// ---------------------------------------------------------------------------
const { mockConnect, mockPing, mockDisconnect, MockRedis } = vi.hoisted(() => {
  const mockConnect = vi.fn<() => Promise<void>>();
  const mockPing = vi.fn<() => Promise<string>>();
  const mockDisconnect = vi.fn<() => void>();
  const MockRedis = vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    ping: mockPing,
    disconnect: mockDisconnect,
  }));
  return { mockConnect, mockPing, mockDisconnect, MockRedis };
});

vi.mock('ioredis', () => ({
  default: MockRedis,
  Redis: MockRedis,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal PrismaService structural mock — only $queryRaw is exercised here. */
function makePrisma(opts: { dbFail?: boolean } = {}): PrismaService {
  return {
    $queryRaw: opts.dbFail
      ? vi.fn().mockRejectedValue(new Error('connection refused'))
      : vi.fn().mockResolvedValue([{ '?column?': 1 }]),
  } as unknown as PrismaService;
}

/** Minimal FastifyReply mock — only .code() is called by the readiness handler. */
function makeReply(): FastifyReply {
  return { code: vi.fn().mockReturnThis() } as unknown as FastifyReply;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HealthController', () => {
  beforeEach(() => {
    MockRedis.mockClear();
    mockConnect.mockClear();
    mockPing.mockClear();
    mockDisconnect.mockClear();
    mockConnect.mockResolvedValue(undefined);
    mockPing.mockResolvedValue('PONG');
    mockDisconnect.mockReturnValue(undefined);
  });

  // -------------------------------------------------------------------------
  // GET /health — liveness (R6)
  // -------------------------------------------------------------------------
  describe('check() — liveness', () => {
    it('returns ApiResponse with status ok', () => {
      const ctrl = new HealthController(makePrisma());
      const result = ctrl.check();

      expect(result.success).toBe(true);
      expect(result.data.status).toBe('ok');
      expect(typeof result.data.uptime).toBe('number');
      expect(typeof result.data.timestamp).toBe('string');
    });

    it('does not touch DB or Redis', () => {
      const prisma = makePrisma();
      const ctrl = new HealthController(prisma);
      ctrl.check();

      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(MockRedis).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // GET /health/ready — readiness (E12-1)
  // -------------------------------------------------------------------------
  describe('readiness() — readiness probe', () => {
    it('returns 200 and status "ready" when both DB and Redis are OK', async () => {
      const ctrl = new HealthController(makePrisma());
      const res = makeReply();

      const result = await ctrl.readiness(res);

      expect(result.success).toBe(true);
      expect(result.data.status).toBe('ready');
      expect(result.data.db).toBe('ok');
      expect(result.data.redis).toBe('ok');
      // Must NOT set 503 when healthy
      expect(res.code).not.toHaveBeenCalled();
    });

    it('returns 503 and status "degraded" when DB is unreachable', async () => {
      const ctrl = new HealthController(makePrisma({ dbFail: true }));
      const res = makeReply();

      const result = await ctrl.readiness(res);

      expect(result.success).toBe(true);
      expect(result.data.status).toBe('degraded');
      expect(result.data.db).toBe('error');
      expect(result.data.redis).toBe('ok');
      expect(res.code).toHaveBeenCalledWith(503);
    });

    it('returns 503 and status "degraded" when Redis is unreachable', async () => {
      mockPing.mockRejectedValueOnce(new Error('connection refused'));
      const ctrl = new HealthController(makePrisma());
      const res = makeReply();

      const result = await ctrl.readiness(res);

      expect(result.success).toBe(true);
      expect(result.data.status).toBe('degraded');
      expect(result.data.db).toBe('ok');
      expect(result.data.redis).toBe('error');
      expect(res.code).toHaveBeenCalledWith(503);
    });

    it('returns 503 when both dependencies are unreachable', async () => {
      mockPing.mockRejectedValueOnce(new Error('connection refused'));
      const ctrl = new HealthController(makePrisma({ dbFail: true }));
      const res = makeReply();

      const result = await ctrl.readiness(res);

      expect(result.data.status).toBe('degraded');
      expect(result.data.db).toBe('error');
      expect(result.data.redis).toBe('error');
      expect(res.code).toHaveBeenCalledWith(503);
    });

    it('always calls disconnect() even when ping fails (finally guard)', async () => {
      mockPing.mockRejectedValueOnce(new Error('connection refused'));
      const ctrl = new HealthController(makePrisma());
      const res = makeReply();

      await ctrl.readiness(res);

      expect(mockDisconnect).toHaveBeenCalledTimes(1);
    });

    it('creates the Redis client with lazyConnect and fast-fail options', async () => {
      const ctrl = new HealthController(makePrisma());
      const res = makeReply();

      await ctrl.readiness(res);

      expect(MockRedis).toHaveBeenCalledTimes(1);
      const opts = MockRedis.mock.calls[0][0] as Record<string, unknown>;
      expect(opts.lazyConnect).toBe(true);
      expect(opts.enableOfflineQueue).toBe(false);
      expect(opts.maxRetriesPerRequest).toBe(0);
    });
  });
});
