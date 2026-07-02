/**
 * E2e spec — HU-08-07 (fase 2/3, backend): forecast contextual (calendario
 * peruano + clima) consumido y expuesto por NestJS.
 *
 * Cubre:
 *  1. Toda corrida de negocio pide use_context=true + engine="auto" a core-ai.
 *  2. location viaja con las coordenadas del tenant si existen; se omite si no.
 *  3. drivers/contextStatus se persisten con la corrida y sobreviven al polling.
 *  4. Degradación elegante: context_status="calendar_only" no falla la corrida.
 *  5. shopping-suggestions expone drivers/contextStatus de la corrida usada.
 *  6. GET /forecasting/insights: resumen narrable + needsForecast + CASL 403.
 *
 * `CoreAiClient` se reemplaza por un stub controlable vía DI override (mismo
 * patrón que `chat.e2e-spec.ts`/`import-document.e2e-spec.ts`) — determinista,
 * sin depender de que el core-ai real elija "ml" según la historia enviada.
 * BullMQ + Redis + Postgres (RLS FORCE) corren de verdad.
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
import {
  CoreAiClient,
  type CoreAiForecastRequest,
} from '../src/forecasting/core-ai.client';
import { apiResponseSchema, authTokensSchema } from '../src/shared';

const adminUrl = process.env.DATABASE_URL_ADMIN;
if (!adminUrl)
  throw new Error('DATABASE_URL_ADMIN no está definido (ver .env)');

const TRUNCATE =
  'TRUNCATE TABLE "forecast_runs","sales_history","recipe_items","recipes",' +
  '"menu_items","menu_categories","ingredients","audit_logs","refresh_tokens",' +
  '"users","tenants" CASCADE';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fecha local Lima 'YYYY-MM-DD' + n días — mismo criterio que
// `ForecastingService.todayLima` para que los drivers de prueba caigan
// dentro/fuera del horizonte de forma predecible.
function limaDate(offsetDays = 0): string {
  const base = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/Lima' }),
  );
  base.setDate(base.getDate() + offsetDays);
  return base.toLocaleDateString('en-CA');
}

function forecastPoints(days: number) {
  return Array.from({ length: days }, (_, i) => ({
    target_date: limaDate(i + 1),
    yhat: 20,
    yhat_lo: 15,
    yhat_hi: 25,
  }));
}

// -----------------------------------------------------------------------
// Stub CoreAiClient — controla la respuesta y captura el request enviado.
// -----------------------------------------------------------------------
let capturedRequests: CoreAiForecastRequest[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let nextResponse: () => any = () => ({
  series_id: 'total',
  engine: 'statsforecast',
  model: 'AutoETS',
  baseline: 'SeasonalNaive',
  frequency: 'D',
  points: forecastPoints(7),
  backtest: null,
  drivers: [],
  context_status: 'full',
});

const coreAiStub: Pick<CoreAiClient, 'runForecast'> = {
  runForecast: (req: CoreAiForecastRequest) => {
    capturedRequests.push(req);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return Promise.resolve(nextResponse());
  },
};

// -----------------------------------------------------------------------
// Suite
// -----------------------------------------------------------------------
describe('Forecast contextual — HU-08-07 fase 2 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);

  const driverSchema = z.object({
    date: z.string(),
    kind: z.enum(['holiday', 'gastro_event', 'weather', 'weekend']),
    label: z.string(),
    impact_pct: z.number().nullable(),
  });

  const runSchema = apiResponseSchema(
    z.object({
      id: z.string(),
      status: z.enum(['running', 'completed', 'failed']),
      points: z.array(z.unknown()).nullable(),
      drivers: z.array(driverSchema),
      contextStatus: z.enum(['full', 'calendar_only', 'off']).nullable(),
      backtest: z
        .object({
          model_smape: z.number(),
          baseline_smape: z.number(),
          improvement_pct: z.number(),
          model_smape_no_context: z.number().nullable(),
        })
        .nullable(),
    }),
  );

  const suggestionsSchema = apiResponseSchema(
    z.object({
      runId: z.string().uuid().nullable(),
      needsForecast: z.boolean(),
      suggestions: z.array(z.object({ ingredientId: z.uuid() })),
      drivers: z.array(driverSchema),
      contextStatus: z.enum(['full', 'calendar_only', 'off']).nullable(),
    }),
  );

  const insightsSchema = apiResponseSchema(
    z.object({
      runId: z.string().uuid().nullable(),
      contextStatus: z.enum(['full', 'calendar_only', 'off']).nullable(),
      upcomingDrivers: z.array(driverSchema),
      backtest: z
        .object({
          modelSmape: z.number(),
          baselineSmape: z.number(),
          improvementPct: z.number(),
          modelSmapeNoContext: z.number().nullable(),
          contextImprovementPct: z.number().nullable(),
        })
        .nullable(),
      needsForecast: z.boolean(),
    }),
  );

  // Tenant principal: historia suficiente, SIN coordenadas configuradas.
  let tenantId = '';
  let ownerToken = '';
  let staffToken = '';

  // Tenant con coordenadas propias — solo para el test de `location`.
  let tenantLocId = '';
  let ownerLocToken = '';

  // Tenant sin ninguna corrida — solo para `insights` → needsForecast.
  let ownerEmptyToken = '';

  const login = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    return tokensSchema.parse(res.body).data.accessToken;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  const triggerRun = async (token: string, horizon = 7): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/forecasting/run')
      .set(bearer(token))
      .send({ scope: 'total', horizon })
      .expect(202);
    return runSchema.parse(res.body).data.id;
  };

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

    const ph = await hash(password, 4);

    // --- Tenant principal (sin coordenadas) ---
    const tenant = await admin.tenant.create({ data: { name: 'Motif CTX' } });
    tenantId = tenant.id;
    await admin.user.create({
      data: {
        tenantId,
        email: 'owner@ctx.pe',
        name: 'O',
        passwordHash: ph,
        roles: ['owner'],
      },
    });
    await admin.user.create({
      data: {
        tenantId,
        email: 'staff@ctx.pe',
        name: 'S',
        passwordHash: ph,
        roles: ['staff'],
      },
    });

    // 60 días de demanda diaria (estacionalidad semanal) → historia suficiente.
    const season = [10, 12, 15, 20, 25, 22, 8];
    const base = new Date('2024-01-01T12:00:00-05:00');
    const rows = Array.from({ length: 60 }, (_, i) => {
      const d = new Date(base.getTime() + i * 24 * 60 * 60_000);
      return {
        tenantId,
        soldOn: d,
        dishName: 'Demanda',
        menuItemId: null,
        qty: season[i % 7] + (i % 3),
        unitPrice: 10,
        total: 10 * (season[i % 7] + (i % 3)),
      };
    });
    await admin.salesHistory.createMany({ data: rows });

    // BOM (para shopping-suggestions): insumo con stock bajo + plato vendido
    // en los últimos 30 días (participación de demanda).
    const ingredient = await admin.ingredient.create({
      data: {
        tenantId,
        sku: 'CTX-001',
        name: 'Pulpo',
        type: 'raw',
        unit: 'kg',
        unitCost: 45,
        stock: 1,
      },
    });
    const recipe = await admin.recipe.create({
      data: { tenantId, name: 'Pulpo al Olivo', kind: 'dish' },
    });
    await admin.recipeItem.create({
      data: {
        tenantId,
        recipeId: recipe.id,
        ingredientId: ingredient.id,
        qty: new Prisma.Decimal('0.2'),
        wasteFactor: new Prisma.Decimal('0'),
      },
    });
    const menuItem = await admin.menuItem.create({
      data: {
        tenantId,
        recipeId: recipe.id,
        name: 'Pulpo al Olivo',
        price: 45,
        isActive: true,
      },
    });
    const now = new Date();
    for (let d = 1; d <= 5; d++) {
      await admin.salesHistory.create({
        data: {
          tenantId,
          soldOn: new Date(now.getTime() - d * 24 * 60 * 60 * 1000),
          dishName: 'Pulpo al Olivo',
          menuItemId: menuItem.id,
          qty: 10,
          unitPrice: 45,
          total: 450,
        },
      });
    }

    // --- Tenant con coordenadas propias (Trujillo, no Lima) ---
    const tenantLoc = await admin.tenant.create({
      data: { name: 'Motif Trujillo', latitude: -8.1116, longitude: -79.0287 },
    });
    tenantLocId = tenantLoc.id;
    await admin.user.create({
      data: {
        tenantId: tenantLocId,
        email: 'owner@loc.pe',
        name: 'O',
        passwordHash: ph,
        roles: ['owner'],
      },
    });
    await admin.salesHistory.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        tenantId: tenantLocId,
        soldOn: new Date(base.getTime() + i * 24 * 60 * 60_000),
        dishName: 'Demanda',
        menuItemId: null,
        qty: 5 + i,
        unitPrice: 10,
        total: 10 * (5 + i),
      })),
    });

    // --- Tenant vacío (sin corridas) — solo para insights/needsForecast ---
    const tenantEmpty = await admin.tenant.create({ data: { name: 'Vacío' } });
    await admin.user.create({
      data: {
        tenantId: tenantEmpty.id,
        email: 'owner@empty.pe',
        name: 'O',
        passwordHash: ph,
        roles: ['owner'],
      },
    });

    const mf = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CoreAiClient)
      .useValue(coreAiStub)
      .compile();
    app = mf.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    ownerToken = await login('owner@ctx.pe');
    staffToken = await login('staff@ctx.pe');
    ownerLocToken = await login('owner@loc.pe');
    ownerEmptyToken = await login('owner@empty.pe');
  }, 30_000);

  afterAll(async () => {
    await admin.$executeRawUnsafe(TRUNCATE);
    await admin.$disconnect();
    await app.close();
  });

  it('R1/R2/R3 — pide use_context=true + engine="auto"; omite location sin coordenadas', async () => {
    capturedRequests = [];
    nextResponse = () => ({
      series_id: 'total',
      engine: 'statsforecast',
      model: 'AutoETS',
      baseline: 'SeasonalNaive',
      frequency: 'D',
      points: forecastPoints(7),
      backtest: null,
      drivers: [],
      context_status: 'full',
    });

    const id = await triggerRun(ownerToken, 7);
    const run = await waitForRun(id, ownerToken);
    expect(run.status).toBe('completed');

    expect(capturedRequests).toHaveLength(1);
    const sent = capturedRequests[0]!;
    expect(sent.use_context).toBe(true);
    expect(sent.engine).toBe('auto');
    expect(sent.location).toBeUndefined();
  }, 15_000);

  it('R3 — usa las coordenadas del tenant cuando existen', async () => {
    capturedRequests = [];
    nextResponse = () => ({
      series_id: 'total',
      engine: 'statsforecast',
      model: 'AutoETS',
      baseline: 'SeasonalNaive',
      frequency: 'D',
      points: forecastPoints(7),
      backtest: null,
      drivers: [],
      context_status: 'full',
    });

    const id = await triggerRun(ownerLocToken, 7);
    await waitForRun(id, ownerLocToken);

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]!.location).toEqual({
      latitude: -8.1116,
      longitude: -79.0287,
    });
  }, 15_000);

  it('R4 — persiste drivers y contextStatus con la corrida', async () => {
    const driverDate = limaDate(3);
    nextResponse = () => ({
      series_id: 'total',
      engine: 'ml',
      model: 'LightGBM',
      baseline: 'SeasonalNaive',
      frequency: 'D',
      points: forecastPoints(7),
      backtest: {
        holdout_size: 7,
        model_smape: 6,
        baseline_smape: 9,
        improvement_pct: 33.3,
        model_smape_no_context: 10,
      },
      drivers: [
        {
          date: driverDate,
          kind: 'holiday',
          label: 'Feriado de prueba',
          impact_pct: -12.5,
        },
      ],
      context_status: 'full',
    });

    const id = await triggerRun(ownerToken, 7);
    const run = await waitForRun(id, ownerToken);

    expect(run.status).toBe('completed');
    expect(run.contextStatus).toBe('full');
    expect(run.drivers).toHaveLength(1);
    expect(run.drivers[0]).toMatchObject({
      date: driverDate,
      kind: 'holiday',
      impact_pct: -12.5,
    });
    expect(run.backtest?.model_smape_no_context).toBe(10);

    // Sobrevive al polling por /predictions (HU-08-04) — misma corrida.
    const predictionsRes = await request(app.getHttpServer())
      .get('/api/forecasting/predictions?scope=total')
      .set(bearer(ownerToken))
      .expect(200);
    const predictions = runSchema.parse(predictionsRes.body).data;
    expect(predictions.id).toBe(id);
    expect(predictions.contextStatus).toBe('full');
    expect(predictions.drivers).toHaveLength(1);
  }, 15_000);

  it('R9 — degradación calendar_only NO falla la corrida (clima caído, calendario sigue)', async () => {
    nextResponse = () => ({
      series_id: 'total',
      engine: 'statsforecast',
      model: 'AutoETS',
      baseline: 'SeasonalNaive',
      frequency: 'D',
      points: forecastPoints(7),
      backtest: null,
      drivers: [
        {
          date: limaDate(2),
          kind: 'weekend',
          label: 'Fin de semana',
          impact_pct: null,
        },
      ],
      context_status: 'calendar_only',
    });

    const id = await triggerRun(ownerToken, 7);
    const run = await waitForRun(id, ownerToken);

    expect(run.status).toBe('completed'); // NO 'failed'
    expect(run.contextStatus).toBe('calendar_only');
    expect(run.drivers).toHaveLength(1); // el calendario no depende del clima
  }, 15_000);

  it('R6 — shopping-suggestions expone drivers/contextStatus de la corrida usada', async () => {
    const driverDate = limaDate(4);
    nextResponse = () => ({
      series_id: 'total',
      engine: 'ml',
      model: 'LightGBM',
      baseline: 'SeasonalNaive',
      frequency: 'D',
      points: forecastPoints(14),
      backtest: {
        holdout_size: 14,
        model_smape: 5,
        baseline_smape: 8,
        improvement_pct: 37.5,
        model_smape_no_context: 9,
      },
      drivers: [
        {
          date: driverDate,
          kind: 'gastro_event',
          label: 'Día del Ceviche',
          impact_pct: 22.4,
        },
      ],
      context_status: 'full',
    });

    const id = await triggerRun(ownerToken, 14);
    await waitForRun(id, ownerToken);

    const res = await request(app.getHttpServer())
      .get('/api/forecasting/shopping-suggestions?horizon=14')
      .set(bearer(ownerToken))
      .expect(200);
    const body = suggestionsSchema.parse(res.body).data;

    expect(body.needsForecast).toBe(false);
    expect(body.runId).toBe(id);
    expect(body.contextStatus).toBe('full');
    expect(body.drivers).toHaveLength(1);
    expect(body.drivers[0]!.date).toBe(driverDate);
    // El insumo Pulpo (stock=1) debe seguir apareciendo con déficit.
    expect(body.suggestions.length).toBeGreaterThan(0);
  }, 15_000);

  it('R7 — GET /insights: resumen narrable con comparativa de backtest', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/forecasting/insights')
      .set(bearer(ownerToken))
      .expect(200);
    const body = insightsSchema.parse(res.body).data;

    // Usa la última corrida completada (la de shopping-suggestions, con
    // model_smape=5 / model_smape_no_context=9 → mejora relativa 44.44%).
    expect(body.needsForecast).toBe(false);
    expect(body.contextStatus).toBe('full');
    expect(body.upcomingDrivers.length).toBeGreaterThan(0);
    expect(body.backtest).not.toBeNull();
    expect(body.backtest!.modelSmapeNoContext).toBe(9);
    expect(body.backtest!.contextImprovementPct).toBeCloseTo(44.44, 1);
  });

  it('R7 — GET /insights: needsForecast=true (200, no 404) sin corridas', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/forecasting/insights')
      .set(bearer(ownerEmptyToken))
      .expect(200);
    const body = insightsSchema.parse(res.body).data;

    expect(body.needsForecast).toBe(true);
    expect(body.runId).toBeNull();
    expect(body.upcomingDrivers).toHaveLength(0);
    expect(body.backtest).toBeNull();
  });

  it('R8 — staff NO puede leer insights → 403 (read Report)', async () => {
    await request(app.getHttpServer())
      .get('/api/forecasting/insights')
      .set(bearer(staffToken))
      .expect(403);
  });
});
