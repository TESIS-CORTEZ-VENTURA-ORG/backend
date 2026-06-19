import type { ConnectionOptions } from 'bullmq';

/** Nombre de la cola de forecasting (BullMQ). */
export const FORECAST_QUEUE = 'forecast';

/**
 * Opciones de conexión a Redis para BullMQ, derivadas de `REDIS_URL`
 * (default `redis://localhost:6379`, igual patrón de env directo que el resto).
 * `maxRetriesPerRequest: null` es REQUERIDO por los workers de BullMQ (usan
 * comandos bloqueantes). Se pasan opciones (no una instancia) para que BullMQ
 * cree y administre sus propias conexiones.
 */
export function redisConnection(): ConnectionOptions {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    ...(url.password ? { password: url.password } : {}),
    maxRetriesPerRequest: null,
  };
}
