/**
 * E2e spec — Notificaciones proactivas del forecast (E10×E08): al completar
 * una corrida `scope=total`, si `shoppingSuggestions` detecta insumos que no
 * cubren la demanda proyectada, se crea una notificación `forecast_shortfall`
 * para owner/manager (staff NO gestiona compras, no la recibe).
 *
 * Cubre:
 *  1. Corrida completada con shortfall → notificación `forecast_shortfall`
 *     para owner y manager, mencionando el driver más relevante de la ventana.
 *  2. staff NO la recibe (bandeja personal — dirigida por rol).
 *  3. Antispam: una segunda corrida con el MISMO shortfall no duplica la
 *     notificación mientras la anterior siga sin leer (dedup por `dedupKey`).
 *
 * `CoreAiClient` stubeado (mismo patrón que `forecast-context.e2e-spec.ts`)
 * para un resultado determinista. BullMQ + Redis + Postgres (RLS FORCE) reales.
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
  'TRUNCATE TABLE "notifications","notification_preferences","forecast_runs",' +
  '"sales_history","recipe_items","recipes","menu_items","menu_categories",' +
  '"ingredients","audit_logs","refresh_tokens","users","tenants" CASCADE';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

let capturedRequests: CoreAiForecastRequest[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nextResponse: () => any = () => ({
  series_id: 'total',
  engine: 'ml',
  model: 'LightGBM',
  baseline: 'SeasonalNaive',
  frequency: 'D',
  points: forecastPoints(7),
  backtest: null,
  drivers: [
    {
      date: limaDate(3),
      kind: 'holiday',
      label: 'Fiestas Patrias',
      impact_pct: 35,
    },
  ],
  context_status: 'full',
});

const coreAiStub: Pick<CoreAiClient, 'runForecast'> = {
  runForecast: (req: CoreAiForecastRequest) => {
    capturedRequests.push(req);
    return Promise.resolve(nextResponse());
  },
};

describe('Notificaciones proactivas del forecast — forecast_shortfall (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);

  const runSchema = apiResponseSchema(
    z.object({
      id: z.string(),
      status: z.enum(['running', 'completed', 'failed']),
    }),
  );

  const notificationListSchema = apiResponseSchema(
    z.object({
      items: z.array(
        z.object({
          id: z.uuid(),
          type: z.string(),
          title: z.string(),
          body: z.string(),
          data: z.unknown().nullable(),
          readAt: z.string().nullable(),
        }),
      ),
      unreadCount: z.number().int().nonnegative(),
    }),
  );

  let ownerToken = '';
  let managerToken = '';
  let staffToken = '';
  let ingredientId = '';

  const login = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    return tokensSchema.parse(res.body).data.accessToken;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  const triggerRun = async (horizon = 7): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/forecasting/run')
      .set(bearer(ownerToken))
      .send({ scope: 'total', horizon })
      .expect(202);
    return runSchema.parse(res.body).data.id;
  };

  const waitForRun = async (id: string) => {
    for (let i = 0; i < 40; i++) {
      const res = await request(app.getHttpServer())
        .get(`/api/forecasting/runs/${id}`)
        .set(bearer(ownerToken))
        .expect(200);
      const run = runSchema.parse(res.body).data;
      if (run.status !== 'running') return run;
      await sleep(250);
    }
    throw new Error(`La corrida ${id} no terminó a tiempo`);
  };

  const shortfallNotifications = async (token: string) => {
    const res = await request(app.getHttpServer())
      .get('/api/notifications')
      .set(bearer(token))
      .expect(200);
    return notificationListSchema
      .parse(res.body)
      .data.items.filter((n) => n.type === 'forecast_shortfall');
  };

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe(TRUNCATE);
    const ph = await hash(password, 4);

    const tenant = await admin.tenant.create({ data: { name: 'Motif SF' } });
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'owner@sf.pe',
        name: 'O',
        passwordHash: ph,
        roles: ['owner'],
      },
    });
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'manager@sf.pe',
        name: 'M',
        passwordHash: ph,
        roles: ['manager'],
      },
    });
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'staff@sf.pe',
        name: 'S',
        passwordHash: ph,
        roles: ['staff'],
      },
    });

    // Historia diaria (para que computeForecast tenga puntos) — el motor está
    // stubeado, así que el volumen exacto no importa, solo que haya >= 2 días.
    const base = new Date('2024-01-01T12:00:00-05:00');
    await admin.salesHistory.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        tenantId: tenant.id,
        soldOn: new Date(base.getTime() + i * 24 * 60 * 60_000),
        dishName: 'Demanda',
        menuItemId: null,
        qty: 10,
        unitPrice: 10,
        total: 100,
      })),
    });

    // BOM con un insumo de stock crítico → shortfall garantizado (mismo patrón
    // que `forecast-context.e2e-spec.ts`: stock=1, receta 0.2/plato, plato
    // vendido 10/día los últimos 5 días).
    const ingredient = await admin.ingredient.create({
      data: {
        tenantId: tenant.id,
        sku: 'SF-001',
        name: 'Pulpo',
        type: 'raw',
        unit: 'kg',
        unitCost: 45,
        stock: 1,
      },
    });
    ingredientId = ingredient.id;
    const recipe = await admin.recipe.create({
      data: { tenantId: tenant.id, name: 'Pulpo al Olivo', kind: 'dish' },
    });
    await admin.recipeItem.create({
      data: {
        tenantId: tenant.id,
        recipeId: recipe.id,
        ingredientId: ingredient.id,
        qty: new Prisma.Decimal('0.2'),
        wasteFactor: new Prisma.Decimal('0'),
      },
    });
    const menuItem = await admin.menuItem.create({
      data: {
        tenantId: tenant.id,
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
          tenantId: tenant.id,
          soldOn: new Date(now.getTime() - d * 24 * 60 * 60 * 1000),
          dishName: 'Pulpo al Olivo',
          menuItemId: menuItem.id,
          qty: 10,
          unitPrice: 45,
          total: 450,
        },
      });
    }

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

    ownerToken = await login('owner@sf.pe');
    managerToken = await login('manager@sf.pe');
    staffToken = await login('staff@sf.pe');
  }, 30_000);

  afterAll(async () => {
    await admin.$executeRawUnsafe(TRUNCATE);
    await admin.$disconnect();
    await app.close();
  });

  it('corrida completada con shortfall → notifica a owner y manager (no a staff)', async () => {
    capturedRequests = [];
    const id = await triggerRun(7);
    const run = await waitForRun(id);
    expect(run.status).toBe('completed');

    const ownerNotifs = await shortfallNotifications(ownerToken);
    expect(ownerNotifs).toHaveLength(1);
    expect(ownerNotifs[0].title).toContain('Pulpo');
    expect(ownerNotifs[0].body).toContain('Fiestas Patrias'); // driver más relevante
    expect(ownerNotifs[0].data).toMatchObject({ ingredientId });

    const managerNotifs = await shortfallNotifications(managerToken);
    expect(managerNotifs).toHaveLength(1);

    const staffNotifs = await shortfallNotifications(staffToken);
    expect(staffNotifs).toHaveLength(0);
  }, 15_000);

  it('antispam: una segunda corrida con el MISMO shortfall no duplica la notificación', async () => {
    const before = await shortfallNotifications(ownerToken);
    expect(before).toHaveLength(1);

    const id = await triggerRun(7);
    await waitForRun(id);

    const after = await shortfallNotifications(ownerToken);
    expect(after).toHaveLength(1); // sigue habiendo UNA sola (dedup vigente)
    expect(after[0].id).toBe(before[0].id);
  }, 15_000);
});
