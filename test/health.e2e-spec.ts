import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { App } from 'supertest/types';
import { z } from 'zod';
import { AppModule } from './../src/app.module';
import { apiResponseSchema } from './../src/shared';

describe('Platform health (e2e)', () => {
  let app: NestFastifyApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    // Mismo prefijo global que main.ts → rutas reales bajo /api (R7).
    app.setGlobalPrefix('api');
    await app.init();
    // Fastify necesita estar listo antes de que Supertest pegue al server.
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/health → 200 con envelope ApiResponse (R6, R7)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);

    const healthSchema = z.object({
      status: z.literal('ok'),
      uptime: z.number(),
      timestamp: z.string(),
    });
    const parsed = apiResponseSchema(healthSchema).parse(res.body);

    expect(parsed.success).toBe(true);
    expect(parsed.data.status).toBe('ok');
  });
});
