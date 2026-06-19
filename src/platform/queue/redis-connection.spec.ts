import { afterEach, describe, expect, it } from 'vitest';
import { FORECAST_QUEUE, redisConnection } from './redis-connection';

type Conn = {
  host: string;
  port: number;
  password?: string;
  maxRetriesPerRequest: null;
};

describe('redisConnection', () => {
  const original = process.env.REDIS_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = original;
  });

  it('usa localhost:6379 por defecto y maxRetriesPerRequest=null (req. BullMQ)', () => {
    delete process.env.REDIS_URL;
    const c = redisConnection() as Conn;
    expect(c.host).toBe('localhost');
    expect(c.port).toBe(6379);
    expect(c.maxRetriesPerRequest).toBeNull();
  });

  it('parsea host, port y password de REDIS_URL', () => {
    process.env.REDIS_URL = 'redis://:secret@my-redis:6380';
    const c = redisConnection() as Conn;
    expect(c.host).toBe('my-redis');
    expect(c.port).toBe(6380);
    expect(c.password).toBe('secret');
  });

  it('el nombre de la cola es estable', () => {
    expect(FORECAST_QUEUE).toBe('forecast');
  });
});
