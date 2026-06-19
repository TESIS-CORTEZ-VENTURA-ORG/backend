import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { AppModule } from './../src/app.module';
import { apiResponseSchema, authTokensSchema } from './../src/shared';

const adminUrl = process.env.DATABASE_URL_ADMIN;
if (!adminUrl) {
  throw new Error('DATABASE_URL_ADMIN no está definido (ver .env)');
}

const TRUNCATE =
  'TRUNCATE TABLE "forecast_runs","sales_history","menu_items","recipes","audit_logs","refresh_tokens","users","tenants" CASCADE';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Requiere el stack dockerizado: Redis (cola) y core-ai (inferencia) corriendo.
describe('Forecasting async — HU-08-02/04 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);

  const runSchema = apiResponseSchema(
    z.object({
      id: z.string(),
      scope: z.string(),
      status: z.enum(['running', 'completed', 'failed']),
      horizon: z.number(),
      model: z.string().nullable(),
      points: z
        .array(
          z.object({
            target_date: z.string(),
            yhat: z.number(),
            yhat_lo: z.number(),
            yhat_hi: z.number(),
          }),
        )
        .nullable(),
      error: z.string().nullable(),
    }),
  );

  let ownerToken = '';
  let staffToken = '';

  const login = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    return tokensSchema.parse(res.body).data.accessToken;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  // Polling del estado de la corrida hasta que deje de estar 'running' (o timeout).
  const waitForRun = async (id: string, token: string) => {
    for (let i = 0; i < 40; i++) {
      const res = await request(app.getHttpServer())
        .get(`/api/forecasting/runs/${id}`)
        .set(bearer(token))
        .expect(200);
      const run = runSchema.parse(res.body).data;
      if (run.status !== 'running') return run;
      await sleep(250);
    }
    throw new Error(`La corrida ${id} no terminó a tiempo`);
  };

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe(TRUNCATE);
    const tenant = await admin.tenant.create({ data: { name: 'Motif' } });
    const passwordHash = await hash(password, 4);
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'owner@fa.pe',
        name: 'O',
        passwordHash,
        roles: ['owner'],
      },
    });
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'staff@fa.pe',
        name: 'S',
        passwordHash,
        roles: ['staff'],
      },
    });

    // 60 días de demanda diaria con estacionalidad semanal → suficiente para inferir.
    const season = [10, 12, 15, 20, 25, 22, 8];
    const base = new Date('2024-01-01T12:00:00-05:00');
    const rows = Array.from({ length: 60 }, (_, i) => {
      const d = new Date(base.getTime() + i * 24 * 60 * 60_000);
      const qty = season[i % 7] + (i % 3);
      return {
        tenantId: tenant.id,
        soldOn: d,
        dishName: 'Demanda',
        menuItemId: null,
        qty,
        unitPrice: 10,
        total: 10 * qty,
      };
    });
    await admin.salesHistory.createMany({ data: rows });

    const mf = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mf.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    ownerToken = await login('owner@fa.pe');
    staffToken = await login('staff@fa.pe');
  }, 30_000);

  afterAll(async () => {
    await admin.$executeRawUnsafe(TRUNCATE);
    await admin.$disconnect();
    await app.close();
  });

  it('encola (202, running), procesa y completa con predicciones', async () => {
    const enq = runSchema.parse(
      (
        await request(app.getHttpServer())
          .post('/api/forecasting/run')
          .set(bearer(ownerToken))
          .send({ scope: 'total', horizon: 7 })
          .expect(202)
      ).body,
    ).data;
    expect(enq.status).toBe('running');
    expect(enq.points).toBeNull();

    const done = await waitForRun(enq.id, ownerToken);
    expect(done.status).toBe('completed');
    expect(done.model).toBeTruthy();
    expect(done.points).toHaveLength(7);
  }, 30_000);

  it('GET /predictions devuelve la última corrida completada (HU-08-04)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/forecasting/predictions?scope=total')
      .set(bearer(ownerToken))
      .expect(200);
    const run = runSchema.parse(res.body).data;
    expect(run.status).toBe('completed');
    expect(run.points).toHaveLength(7);
  });

  it('histórico insuficiente → la corrida termina en failed (no rompe el worker)', async () => {
    // scope=menuItem para un plato sin ventas → serie vacía → 422 interno → failed.
    const enq = runSchema.parse(
      (
        await request(app.getHttpServer())
          .post('/api/forecasting/run')
          .set(bearer(ownerToken))
          .send({
            scope: 'menuItem',
            menuItemId: '22222222-2222-4222-8222-222222222222',
            horizon: 7,
          })
          .expect(202)
      ).body,
    ).data;

    const done = await waitForRun(enq.id, ownerToken);
    expect(done.status).toBe('failed');
    expect(done.error).toBeTruthy();
    expect(done.points).toBeNull();
  }, 30_000);

  it('staff NO puede lanzar una corrida → 403 (manage Report)', async () => {
    await request(app.getHttpServer())
      .post('/api/forecasting/run')
      .set(bearer(staffToken))
      .send({ scope: 'total', horizon: 7 })
      .expect(403);
  });

  it('corrida inexistente → 404', async () => {
    await request(app.getHttpServer())
      .get('/api/forecasting/runs/00000000-0000-0000-0000-000000000000')
      .set(bearer(ownerToken))
      .expect(404);
  });

  it('predicciones sin corrida para el ámbito → 404', async () => {
    // UUID v4 válido pero sin corrida asociada → 404 (no 400 de validación).
    await request(app.getHttpServer())
      .get(
        '/api/forecasting/predictions?scope=menuItem&menuItemId=11111111-1111-4111-8111-111111111111',
      )
      .set(bearer(ownerToken))
      .expect(404);
  });
});
