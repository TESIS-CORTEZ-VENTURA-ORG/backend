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
  'TRUNCATE TABLE "overhead_costs","cash_closes","payments","sales","order_items","orders","dining_tables","zones","menu_modifiers","menu_availability","menu_items","menu_categories","recipe_versions","recipe_items","recipes","product_suppliers","suppliers","ingredients","categories","units_of_measure","audit_logs","refresh_tokens","users","tenants" CASCADE';

// Período = mes actual (las ventas se emiten con issuedAt = now()). YYYY-MM.
const now = new Date();
const PERIOD = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

describe('Costing — costeo HU-06-01/02/03/04/05 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);
  const idSchema = apiResponseSchema(z.object({ id: z.uuid() }));
  const orderSchema = apiResponseSchema(
    z.object({ id: z.uuid(), status: z.string(), subtotal: z.string() }),
  );

  const dishSchema = z.object({
    menuItemId: z.uuid(),
    name: z.string(),
    sellPrice: z.string(),
    ingredientCost: z.string(),
    unitsSold: z.number(),
    cifPerUnit: z.string(),
    fullCost: z.string(),
    foodCostPct: z.string(),
    marginPct: z.string(),
    contributionMargin: z.string(),
  });
  const dishesSchema = apiResponseSchema(
    z.object({
      period: z.string(),
      totalCIF: z.string(),
      totalUnits: z.number(),
      cifPerUnit: z.string(),
      allocationBase: z.literal('units'),
      dishes: z.array(dishSchema),
    }),
  );
  const suggestSchema = apiResponseSchema(
    z.object({
      menuItemId: z.uuid(),
      period: z.string(),
      fullCost: z.string(),
      targetMarginPct: z.string(),
      suggestedPrice: z.string(),
    }),
  );
  const overheadSchema = apiResponseSchema(
    z.object({
      id: z.uuid(),
      period: z.string(),
      concept: z.string(),
      amount: z.string(),
    }),
  );
  const overheadListSchema = apiResponseSchema(
    z.array(
      z.object({
        id: z.uuid(),
        period: z.string(),
        concept: z.string(),
        amount: z.string(),
      }),
    ),
  );

  let ownerToken = '';
  let staffToken = '';
  let menuItemId = '';
  let zoneId = '';

  const login = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    return tokensSchema.parse(res.body).data.accessToken;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (path: string, token: string) =>
    request(app.getHttpServer()).get(path).set(bearer(token));
  const post = (path: string, token: string, body: unknown) =>
    request(app.getHttpServer()).post(path).set(bearer(token)).send(body);

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe(TRUNCATE);
    const tenant = await admin.tenant.create({
      data: { name: 'Motif', igvRate: 0.18 },
    });
    const passwordHash = await hash(password, 4);
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'owner@costing.pe',
        name: 'O',
        passwordHash,
        roles: ['owner'],
      },
    });
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'staff@costing.pe',
        name: 'S',
        passwordHash,
        roles: ['staff'],
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
    ownerToken = await login('owner@costing.pe');
    staffToken = await login('staff@costing.pe');

    // Carta: insumo (costo 10) → receta (cost 10) → plato (precio 40).
    zoneId = idSchema.parse(
      (await post('/api/zones', ownerToken, { name: 'Salón' }).expect(201))
        .body,
    ).data.id;
    const ingId = idSchema.parse(
      (
        await post('/api/ingredients', ownerToken, {
          sku: 'QUE',
          name: 'Queso',
          type: 'raw',
          unit: 'kg',
          unitCost: 10,
        }).expect(201)
      ).body,
    ).data.id;
    const recipeId = idSchema.parse(
      (
        await post('/api/recipes', ownerToken, {
          name: 'Pizza',
          kind: 'dish',
          yield: 1,
          items: [{ ingredientId: ingId, qty: 1 }],
        }).expect(201)
      ).body,
    ).data.id;
    menuItemId = idSchema.parse(
      (
        await post('/api/menu/items', ownerToken, {
          recipeId,
          name: 'Pizza Margarita',
          price: 40,
        }).expect(201)
      ).body,
    ).data.id;

    // Venta: abrir mesa → 5 unidades del plato → cobrar (emite ticket issued, now).
    const tableId = idSchema.parse(
      (
        await post('/api/tables', ownerToken, {
          zoneId,
          code: 'M1',
          capacity: 8,
        }).expect(201)
      ).body,
    ).data.id;
    const orderId = orderSchema.parse(
      (
        await post('/api/orders', staffToken, { tableId, guests: 4 }).expect(
          201,
        )
      ).body,
    ).data.id;
    await post(`/api/orders/${orderId}/items`, staffToken, {
      items: [{ menuItemId, qty: 5 }],
    }).expect(201);
    await post(`/api/orders/${orderId}/pay`, staffToken, {
      payments: [{ method: 'cash', amount: 200 }], // 40 · 5 = 200
      docType: 'boleta',
    }).expect(201);

    // CIF del período: 60 + 40 = 100.
    await post('/api/overhead-costs', ownerToken, {
      period: PERIOD,
      concept: 'Alquiler',
      amount: 60,
    }).expect(201);
    await post('/api/overhead-costs', ownerToken, {
      period: PERIOD,
      concept: 'Servicios',
      amount: 40,
    }).expect(201);
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(TRUNCATE);
    await admin.$disconnect();
    await app.close();
  });

  it('HU-06-02: el período sembrado lista 2 CIF (filtro ?period=) que suman 100', async () => {
    const list = overheadListSchema.parse(
      (
        await get(`/api/overhead-costs?period=${PERIOD}`, ownerToken).expect(
          200,
        )
      ).body,
    ).data;
    expect(list).toHaveLength(2);
    expect(list.every((c) => typeof c.amount === 'string')).toBe(true);
    const total = list.reduce((s, c) => s + Number(c.amount), 0);
    expect(total).toBe(100);
  });

  it('HU-06-02: CRUD de CIF — crear, editar y eliminar (período aislado)', async () => {
    const crudPeriod = '2030-03'; // período propio: no afecta los asserts de costeo
    const created = overheadSchema.parse(
      (
        await post('/api/overhead-costs', ownerToken, {
          period: crudPeriod,
          concept: 'Marketing',
          amount: 50,
        }).expect(201)
      ).body,
    ).data;
    expect(created.amount).toBe('50.00');
    expect(created.period).toBe(crudPeriod);

    // editar
    const updated = overheadSchema.parse(
      (
        await request(app.getHttpServer())
          .patch(`/api/overhead-costs/${created.id}`)
          .set(bearer(ownerToken))
          .send({ amount: 70 })
          .expect(200)
      ).body,
    ).data;
    expect(updated.amount).toBe('70.00');

    // eliminar (soft) → el listado del período queda vacío
    await request(app.getHttpServer())
      .delete(`/api/overhead-costs/${created.id}`)
      .set(bearer(ownerToken))
      .expect(200);
    const afterDelete = overheadListSchema.parse(
      (
        await get(
          `/api/overhead-costs?period=${crudPeriod}`,
          ownerToken,
        ).expect(200)
      ).body,
    ).data;
    expect(afterDelete).toHaveLength(0);
  });

  it('HU-06-01/03/04: costo, prorrateo de CIF y margen por plato', async () => {
    const view = dishesSchema.parse(
      (
        await get(`/api/costing/dishes?period=${PERIOD}`, ownerToken).expect(
          200,
        )
      ).body,
    ).data;
    expect(view.period).toBe(PERIOD);
    expect(view.totalCIF).toBe('100.00');
    expect(view.totalUnits).toBe(5);
    expect(view.cifPerUnit).toBe('20.00'); // 100 / 5
    expect(view.allocationBase).toBe('units');

    const dish = view.dishes.find((d) => d.menuItemId === menuItemId);
    expect(dish).toBeDefined();
    expect(dish?.sellPrice).toBe('40.00');
    expect(dish?.ingredientCost).toBe('10.00'); // receta (BOM)
    expect(dish?.unitsSold).toBe(5);
    expect(dish?.cifPerUnit).toBe('20.00');
    expect(dish?.fullCost).toBe('30.00'); // 10 + 20
    expect(dish?.foodCostPct).toBe('25.00'); // 10 / 40 · 100
    expect(dish?.marginPct).toBe('25.00'); // (40 − 30) / 40 · 100
    expect(dish?.contributionMargin).toBe('10.00'); // 40 − 30
  });

  it('HU-06-05: sugerencia de precio por margen objetivo (fórmula)', async () => {
    const view = suggestSchema.parse(
      (
        await get(
          `/api/costing/suggest-price?menuItemId=${menuItemId}&targetMarginPct=50&period=${PERIOD}`,
          ownerToken,
        ).expect(200)
      ).body,
    ).data;
    expect(view.menuItemId).toBe(menuItemId);
    expect(view.fullCost).toBe('30.00');
    expect(view.targetMarginPct).toBe('50.00');
    expect(view.suggestedPrice).toBe('60.00'); // 30 / (1 − 0.5)
  });

  it('HU-06-05: margen objetivo fuera de rango (≥ 100) → 400', async () => {
    await get(
      `/api/costing/suggest-price?menuItemId=${menuItemId}&targetMarginPct=100&period=${PERIOD}`,
      ownerToken,
    ).expect(400);
  });

  it('staff NO accede al costeo (info de gestión) → 403', async () => {
    await get(`/api/costing/dishes?period=${PERIOD}`, staffToken).expect(403);
    await get(
      `/api/costing/suggest-price?menuItemId=${menuItemId}&targetMarginPct=35&period=${PERIOD}`,
      staffToken,
    ).expect(403);
    await get('/api/overhead-costs', staffToken).expect(403);
    await post('/api/overhead-costs', staffToken, {
      period: PERIOD,
      concept: 'X',
      amount: 10,
    }).expect(403);
  });

  it('costeo de un período sin ventas → cifPerUnit 0.00 (sin unidades que prorratear)', async () => {
    const empty = '2099-01';
    await post('/api/overhead-costs', ownerToken, {
      period: empty,
      concept: 'Alquiler',
      amount: 500,
    }).expect(201);
    const view = dishesSchema.parse(
      (await get(`/api/costing/dishes?period=${empty}`, ownerToken).expect(200))
        .body,
    ).data;
    expect(view.totalCIF).toBe('500.00');
    expect(view.totalUnits).toBe(0);
    expect(view.cifPerUnit).toBe('0.00');
    const dish = view.dishes.find((d) => d.menuItemId === menuItemId);
    expect(dish?.unitsSold).toBe(0);
    expect(dish?.fullCost).toBe('10.00'); // solo ingredientes (CIF 0)
  });
});
