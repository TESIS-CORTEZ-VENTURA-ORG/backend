import { Controller, Get, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import Redis, { type RedisOptions } from 'ioredis';
import { ok, type ApiResponse } from '../../shared';
import { PrismaService } from '../prisma/prisma.service';
import { redisConnection } from '../queue/redis-connection';

/**
 * Estado de liveness del servicio.
 * No toca DB ni Redis — responde siempre que el proceso esté vivo.
 */
export interface HealthStatus {
  status: 'ok';
  uptime: number;
  timestamp: string;
}

/**
 * Estado de readiness — refleja conectividad real con Postgres y Redis.
 * `ready` únicamente cuando AMBAS dependencias responden; `degraded` en cualquier
 * otro caso. Cada campo reporta el estado individual para facilitar el diagnóstico.
 */
export interface ReadinessStatus {
  status: 'ready' | 'degraded';
  db: 'ok' | 'error';
  redis: 'ok' | 'error';
}

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liveness probe (HU-12-02).
   *
   * Responde 200 siempre que el proceso NestJS esté activo. Intencionalmente no
   * toca DB ni Redis para que sea ultra-rápido y no genere cascadas de fallos
   * cuando el orchestrador (Kubernetes/ECS) lo llama cada pocos segundos.
   */
  @Get()
  check(): ApiResponse<HealthStatus> {
    return ok({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Readiness probe (HU-12-02, defecto E12-1).
   *
   * Verifica conectividad real con Postgres y Redis. Retorna:
   * - HTTP 200 `{ status: 'ready' }` cuando ambas responden.
   * - HTTP 503 `{ status: 'degraded' }` cuando alguna falla.
   *
   * El envelope `ApiResponse<T>` siempre lleva `success: true` porque la
   * operación HTTP completó correctamente; la semántica "no listo" la expresa
   * `data.status = 'degraded'` y el código HTTP 503 — no un error 5xx de
   * infraestructura.
   */
  @Get('ready')
  async readiness(
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<ApiResponse<ReadinessStatus>> {
    // Run checks in parallel: neither depends on the other.
    const [db, redis] = await Promise.all([this.checkDb(), this.checkRedis()]);

    const status: ReadinessStatus['status'] =
      db === 'ok' && redis === 'ok' ? 'ready' : 'degraded';

    if (status === 'degraded') {
      // Set 503 without throwing — the body still carries the envelope so the
      // client can distinguish "service degraded" from an unexpected 5xx crash.
      res.code(503);
    }

    return ok({ status, db, redis });
  }

  /**
   * Comprueba conectividad con PostgreSQL ejecutando `SELECT 1`, la consulta
   * más ligera posible. Corre fuera del contexto de tenant (sin RLS) porque el
   * health check no pertenece a ningún tenant.
   */
  private async checkDb(): Promise<'ok' | 'error'> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'ok';
    } catch {
      return 'error';
    }
  }

  /**
   * Comprueba conectividad con Redis creando un cliente ioredis transitorio,
   * haciendo ping y cerrando la conexión en el bloque `finally`.
   *
   * Opciones elegidas para fallo rápido (no bloquear el health check):
   * - `lazyConnect: true` → la conexión no se intenta hasta llamar a `connect()`,
   *   por lo que el error es una Promise rechazada capturable aquí.
   * - `maxRetriesPerRequest: 0` → ningún reintento: primer fallo = error inmediato.
   * - `enableOfflineQueue: false` → rechaza comandos si no hay conexión activa.
   * - `connectTimeout: 3_000` → máximo 3 s para establecer la conexión.
   *
   * Type assertion `as RedisOptions`: `redisConnection()` retorna `ConnectionOptions`
   * (union bullmq). La implementación siempre devuelve un plain-options object —
   * nunca una instancia Redis/Cluster — así que el cast es seguro. Ver redis-connection.ts.
   */
  private async checkRedis(): Promise<'ok' | 'error'> {
    const conn = redisConnection() as RedisOptions;
    const client = new Redis({
      ...conn,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      connectTimeout: 3_000,
      lazyConnect: true,
    });
    try {
      await client.connect();
      await client.ping();
      return 'ok';
    } catch {
      return 'error';
    } finally {
      // disconnect() is synchronous and idempotent — always runs even if
      // connect() or ping() threw, preventing connection leaks.
      client.disconnect();
    }
  }
}
