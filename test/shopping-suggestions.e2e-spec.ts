/**
 * E2e spec — HU-08-06: Sugerencias de compra basadas en pronóstico.
 * Cubre: happy path (shortfalls reales), needsForecast sin corrida completada,
 * CASL 403 para staff.
 */
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient, Prisma } from '@prisma/client';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { AppModule } from './../src/app.module';
import { apiResponseSchema, authTokensSchema } from './../src/shared';

const adminUrl = process.env.DATABASE_URL_ADMIN;
if (!adminUrl) {
  throw new Error('DATABASE_URL_ADMIN no está definido (ver .env)');
}

const TRUNCATE =
  'TRUNCATE TABLE "forecast_runs","sales_history","recipe_items","recipes","menu_items","menu_categories","ingredients","audit_logs","refresh_tokens","users","tenants" CASCADE';

describe('Shopping Suggestions — HU-08-06 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);

  const suggestionsSchema = apiResponseSchema(
    z.object({
      horizon: z.number(),
      source: z.literal('forecast'),
      runId: z.string().uuid().nullable(),
      needsForecast: z.boolean(),
      suggestions: z.array(
        z.object({
          ingredientId: z.uuid(),
          name: z.string(),
          unit: z.string(),
          currentStock: z.string(),
          forecastConsumption: z.string(),
          shortfall: z.string(),
          suggestedQty: z.string(),
        }),
      ),
    }),
  );

  let ownerToken = '';
  let staffToken = '';
  let tenantId = '';

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

    const tenant = await admin.tenant.create({ data: { name: 'Motif' } });
    tenantId = tenant.id;
    const ph = await hash(password, 4);

    await admin.user.create({
      data: {
        tenantId,
        email: 'owner@sug.pe',
        name: 'O',
        passwordHash: ph,
        roles: ['owner'],
      },
    });
    await admin.user.create({
      data: {
        tenantId,
        email: 'staff@sug.pe',
        name: 'S',
        passwordHash: ph,
        roles: ['staff'],
      },
    });

    // Insumo A: stock pequeño (se agotará en el horizonte).
    const ingA = await admin.ingredient.create({
      data: {
        tenantId,
        sku: 'A-001',
        name: 'Pescado',
        type: 'raw',
        unit: 'kg',
        unitCost: 38,
        stock: 1, // stock bajo
      },
    });

    // Insumo B: stock abundante (NO debe aparecer en shortfalls).
    const ingB = await admin.ingredient.create({
      data: {
        tenantId,
        sku: 'B-001',
        name: 'Arroz',
        type: 'raw',
        unit: 'kg',
        unitCost: 4,
        stock: 1000,
      },
    });

    // Receta con BOM: ingA (0.2 kg x waste 0.1) + ingB (0.15 kg sin waste).
    const recipe = await admin.recipe.create({
      data: { tenantId, name: 'Ceviche', kind: 'dish' },
    });
    await admin.recipeItem.create({
      data: {
        tenantId,
        recipeId: recipe.id,
        ingredientId: ingA.id,
        qty: new Prisma.Decimal('0.2'),
        wasteFactor: new Prisma.Decimal('0.1'),
      },
    });
    await admin.recipeItem.create({
      data: {
        tenantId,
        recipeId: recipe.id,
        ingredientId: ingB.id,
        qty: new Prisma.Decimal('0.15'),
        wasteFactor: new Prisma.Decimal('0'),
      },
    });

    const menuItem = await admin.menuItem.create({
      data: {
        tenantId,
        recipeId: recipe.id,
        name: 'Ceviche Clásico',
        price: 42,
        isActive: true,
      },
    });

    // Histórico de ventas de los últimos 30 días para calcular participación.
    const now = new Date();
    for (let d = 1; d <= 5; d++) {
      const soldOn = new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
      await admin.salesHistory.create({
        data: {
          tenantId,
          soldOn,
          dishName: 'Ceviche Clásico',
          menuItemId: menuItem.id,
          qty: 10,
          unitPrice: 42,
          total: 420,
        },
      });
    }

    // ForecastRun completada: yhat=20 platos/día durante 14 días en el futuro.
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const points = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(tomorrow.getTime() + i * 24 * 60 * 60 * 1000);
      const ds = d.toISOString().slice(0, 10);
      return { target_date: ds, yhat: 20, yhat_lo: 15, yhat_hi: 25 };
    });

    await admin.forecastRun.create({
      data: {
        tenantId,
        scope: 'total',
        horizon: 14,
        status: 'completed',
        points: points as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });

    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication(new FastifyAdapter());
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    ownerToken = await login('owner@sug.pe');
    staffToken = await login('staff@sug.pe');
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(TRUNCATE);
    await admin.$disconnect();
    await app.close();
  });

  it('owner: devuelve shortfalls reales cuando hay corrida completada', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/forecasting/shopping-suggestions?horizon=14')
      .set(bearer(ownerToken))
      .expect(200);

    const body = suggestionsSchema.parse(res.body);
    expect(body.data.needsForecast).toBe(false);
    expect(body.data.runId).toBeTruthy();
    // Pescado: consumo = 20 platos/día × 14d × 100% participación × 0.2kg × 1.1 = 61.6 kg
    // stock = 1 kg → shortfall ~ 60.6 kg > 0 → debe aparecer.
    const pescado = body.data.suggestions.find((s) => s.name === 'Pescado');
    expect(pescado).toBeDefined();
    expect(Number(pescado!.shortfall)).toBeGreaterThan(0);
    // Arroz: stock=1000 → no hay shortfall → NO debe aparecer.
    const arroz = body.data.suggestions.find((s) => s.name === 'Arroz');
    expect(arroz).toBeUndefined();
  });

  it('owner: devuelve needsForecast cuando no hay corrida completada', async () => {
    // Eliminar la corrida completada temporalmente para este test.
    await admin.forecastRun.deleteMany({ where: { tenantId } });

    const res = await request(app.getHttpServer())
      .get('/api/forecasting/shopping-suggestions?horizon=14')
      .set(bearer(ownerToken))
      .expect(200);

    const body = suggestionsSchema.parse(res.body);
    expect(body.data.needsForecast).toBe(true);
    expect(body.data.runId).toBeNull();
    expect(body.data.suggestions).toHaveLength(0);
  });

  it('staff: recibe 403 (CASL read Report)', async () => {
    await request(app.getHttpServer())
      .get('/api/forecasting/shopping-suggestions?horizon=14')
      .set(bearer(staffToken))
      .expect(403);
  });

  it('sin token: recibe 401', async () => {
    await request(app.getHttpServer())
      .get('/api/forecasting/shopping-suggestions?horizon=14')
      .expect(401);
  });
});
