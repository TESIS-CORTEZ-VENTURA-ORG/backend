/**
 * E2e spec — HU-08-08: `GET /forecasting/accuracy` ("el sistema se
 * autoevalúa"). Combina TODAS las corridas `completed` del ámbito (no solo la
 * última) y compara predicho vs. real día a día para las fechas YA
 * transcurridas.
 *
 * Cubre:
 *  1. Merge multi-corrida: si dos corridas predijeron el mismo día, gana la
 *     predicción de la corrida MÁS RECIENTE; `runsEvaluated` cuenta ambas.
 *  2. Métricas: smapeRealized/mapeRealized/coveragePct/points coherentes.
 *  3. staff NO puede leer accuracy → 403 (read Report).
 *  4. Sin corridas → 200 con `needsMoreData: true` (nunca 404).
 *  5. Pocos días transcurridos → 200 con `needsMoreData: true` + serie parcial.
 *
 * Corridas insertadas directamente (mismo patrón que
 * `forecast-validation.e2e-spec.ts`) — no depende de que el motor real infiera
 * nada, solo de la comparación predicho/real ya persistida.
 */
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { PrismaClient, Prisma } from '@prisma/client';
import { hash } from 'bcryptjs';
import request from 'supertest';
import type { App } from 'supertest/types';
import { z } from 'zod';
import { AppModule } from '../src/app.module';
import { apiResponseSchema, authTokensSchema } from '../src/shared';

const adminUrl = process.env.DATABASE_URL_ADMIN;
if (!adminUrl)
  throw new Error('DATABASE_URL_ADMIN no está definido (ver .env)');

const TRUNCATE =
  'TRUNCATE TABLE "forecast_runs","sales_history","audit_logs",' +
  '"refresh_tokens","users","tenants" CASCADE';

const at = (day: string): Date => new Date(`${day}T12:00:00-05:00`);

describe('Forecasting accuracy — HU-08-08 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);

  const accuracySchema = apiResponseSchema(
    z.object({
      series: z.array(
        z.object({
          date: z.string(),
          predicted: z.number(),
          actual: z.number(),
          yhatLo: z.number(),
          yhatHi: z.number(),
        }),
      ),
      metrics: z.object({
        smapeRealized: z.number().nullable(),
        mapeRealized: z.number().nullable(),
        coveragePct: z.number().nullable(),
        points: z.number().int(),
      }),
      runsEvaluated: z.number().int(),
      needsMoreData: z.boolean(),
      message: z.string().optional(),
    }),
  );

  let ownerToken = '';
  let staffToken = '';
  let ownerFewToken = '';
  let ownerEmptyToken = '';

  const login = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    return tokensSchema.parse(res.body).data.accessToken;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe(TRUNCATE);
    const ph = await hash(password, 4);

    // --- Tenant principal: 2 corridas (merge multi-corrida) ---
    const tenant = await admin.tenant.create({ data: { name: 'Motif ACC' } });
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'owner@acc.pe',
        name: 'O',
        passwordHash: ph,
        roles: ['owner'],
      },
    });
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'staff@acc.pe',
        name: 'S',
        passwordHash: ph,
        roles: ['staff'],
      },
    });

    // Real: 11 (01-08), 25 (01-09), 30 (01-10). Último día con ventas = 01-10.
    await admin.salesHistory.createMany({
      data: [
        {
          tenantId: tenant.id,
          soldOn: at('2024-01-08'),
          dishName: 'D',
          menuItemId: null,
          qty: 11,
          unitPrice: 10,
          total: 110,
        },
        {
          tenantId: tenant.id,
          soldOn: at('2024-01-09'),
          dishName: 'D',
          menuItemId: null,
          qty: 25,
          unitPrice: 10,
          total: 250,
        },
        {
          tenantId: tenant.id,
          soldOn: at('2024-01-10'),
          dishName: 'D',
          menuItemId: null,
          qty: 30,
          unitPrice: 10,
          total: 300,
        },
      ],
    });

    // Corrida A (más vieja): predice 01-08/01-09/01-10 + un día futuro (2099).
    await admin.forecastRun.create({
      data: {
        tenantId: tenant.id,
        scope: 'total',
        menuItemId: null,
        horizon: 3,
        status: 'completed',
        model: 'AutoETS',
        baseline: 'SeasonalNaive',
        completedAt: new Date(Date.now() - 60_000),
        points: [
          { target_date: '2024-01-08', yhat: 10, yhat_lo: 8, yhat_hi: 12 },
          { target_date: '2024-01-09', yhat: 19, yhat_lo: 17, yhat_hi: 21 },
          { target_date: '2024-01-10', yhat: 28, yhat_lo: 26, yhat_hi: 30 },
          { target_date: '2099-01-01', yhat: 99, yhat_lo: 90, yhat_hi: 110 },
        ] as Prisma.InputJsonValue,
      },
    });
    // Corrida B (más reciente): re-predice 01-09/01-10 (gana sobre A).
    await admin.forecastRun.create({
      data: {
        tenantId: tenant.id,
        scope: 'total',
        menuItemId: null,
        horizon: 2,
        status: 'completed',
        model: 'AutoETS',
        baseline: 'SeasonalNaive',
        completedAt: new Date(),
        points: [
          { target_date: '2024-01-09', yhat: 24, yhat_lo: 22, yhat_hi: 26 },
          { target_date: '2024-01-10', yhat: 29, yhat_lo: 27, yhat_hi: 28 },
        ] as Prisma.InputJsonValue,
      },
    });

    // --- Tenant con pocos días transcurridos (needsMoreData) ---
    const tenantFew = await admin.tenant.create({
      data: { name: 'Motif Few' },
    });
    await admin.user.create({
      data: {
        tenantId: tenantFew.id,
        email: 'owner@few.pe',
        name: 'O',
        passwordHash: ph,
        roles: ['owner'],
      },
    });
    await admin.salesHistory.create({
      data: {
        tenantId: tenantFew.id,
        soldOn: at('2024-01-08'),
        dishName: 'D',
        menuItemId: null,
        qty: 5,
        unitPrice: 10,
        total: 50,
      },
    });
    await admin.forecastRun.create({
      data: {
        tenantId: tenantFew.id,
        scope: 'total',
        menuItemId: null,
        horizon: 1,
        status: 'completed',
        model: 'AutoETS',
        baseline: 'SeasonalNaive',
        completedAt: new Date(),
        points: [
          { target_date: '2024-01-08', yhat: 4, yhat_lo: 2, yhat_hi: 6 },
        ] as Prisma.InputJsonValue,
      },
    });

    // --- Tenant vacío: sin corridas ---
    const tenantEmpty = await admin.tenant.create({
      data: { name: 'Motif Empty' },
    });
    await admin.user.create({
      data: {
        tenantId: tenantEmpty.id,
        email: 'owner@empty-acc.pe',
        name: 'O',
        passwordHash: ph,
        roles: ['owner'],
      },
    });

    const mf = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mf.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    ownerToken = await login('owner@acc.pe');
    staffToken = await login('staff@acc.pe');
    ownerFewToken = await login('owner@few.pe');
    ownerEmptyToken = await login('owner@empty-acc.pe');
  }, 30_000);

  afterAll(async () => {
    await admin.$executeRawUnsafe(TRUNCATE);
    await admin.$disconnect();
    await app.close();
  });

  it('combina 2 corridas: la más reciente gana el día repetido; métricas coherentes', async () => {
    const data = accuracySchema.parse(
      (
        await request(app.getHttpServer())
          .get('/api/forecasting/accuracy?scope=total')
          .set(bearer(ownerToken))
          .expect(200)
      ).body,
    ).data;

    expect(data.series).toHaveLength(3); // 01-08, 01-09, 01-10 (2099 excluido: futuro)
    const byDate = Object.fromEntries(data.series.map((r) => [r.date, r]));

    // 01-08 solo lo predijo la corrida A.
    expect(byDate['2024-01-08']).toMatchObject({ predicted: 10, actual: 11 });
    // 01-09/01-10: la corrida B (más reciente) gana sobre A.
    expect(byDate['2024-01-09']).toMatchObject({ predicted: 24, actual: 25 });
    expect(byDate['2024-01-10']).toMatchObject({ predicted: 29, actual: 30 });

    expect(data.runsEvaluated).toBe(2);
    expect(data.needsMoreData).toBe(false);
    expect(data.metrics.points).toBe(3);
    // MAPE = mean(9.09, 4, 3.33) = 5.47
    expect(data.metrics.mapeRealized).toBe(5.47);
    // SMAPE = mean(9.52, 4.08, 3.39) = 5.66
    expect(data.metrics.smapeRealized).toBe(5.66);
    // Cobertura: 01-08 (11∈[8,12] ✓), 01-09 (25∈[22,26] ✓), 01-10 (30∉[27,28] ✗) → 2/3
    expect(data.metrics.coveragePct).toBe(66.67);
  });

  it('staff NO puede leer accuracy → 403 (read Report)', async () => {
    await request(app.getHttpServer())
      .get('/api/forecasting/accuracy?scope=total')
      .set(bearer(staffToken))
      .expect(403);
  });

  it('pocos días transcurridos → 200 con needsMoreData:true (nunca error)', async () => {
    const data = accuracySchema.parse(
      (
        await request(app.getHttpServer())
          .get('/api/forecasting/accuracy?scope=total')
          .set(bearer(ownerFewToken))
          .expect(200)
      ).body,
    ).data;

    expect(data.series).toHaveLength(1);
    expect(data.runsEvaluated).toBe(1);
    expect(data.needsMoreData).toBe(true);
    expect(data.message).toBeTruthy();
  });

  it('sin corridas → 200 con needsMoreData:true, serie vacía (nunca 404)', async () => {
    const data = accuracySchema.parse(
      (
        await request(app.getHttpServer())
          .get('/api/forecasting/accuracy?scope=total')
          .set(bearer(ownerEmptyToken))
          .expect(200)
      ).body,
    ).data;

    expect(data.series).toEqual([]);
    expect(data.runsEvaluated).toBe(0);
    expect(data.needsMoreData).toBe(true);
    expect(data.metrics).toEqual({
      smapeRealized: null,
      mapeRealized: null,
      coveragePct: null,
      points: 0,
    });
    expect(data.message).toBeTruthy();
  });
});
