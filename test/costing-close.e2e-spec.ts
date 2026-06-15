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
  'TRUNCATE TABLE "costing_closes","overhead_costs","inventory_movements","cash_closes","payments","sales","order_items","orders","dining_tables","zones","menu_modifiers","menu_availability","menu_items","menu_categories","recipe_versions","recipe_items","recipes","product_suppliers","suppliers","ingredients","categories","units_of_measure","audit_logs","refresh_tokens","users","tenants" CASCADE';

// Período AISLADO: las ventas se siembran con issuedAt fijo en este mes (el
// endpoint de cobro emite con now(), por eso se siembra por el cliente admin).
const PERIOD = '2031-05';
const IN_PERIOD = new Date(Date.UTC(2031, 4, 15, 12, 0, 0)); // 2031-05-15

describe('Costing — cierre + comparativo real vs teórico HU-06-06/07 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);
  const idSchema = apiResponseSchema(z.object({ id: z.uuid() }));

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
  const closeSchema = apiResponseSchema(
    z.object({
      id: z.uuid(),
      period: z.string(),
      totalCIF: z.string(),
      totalUnits: z.number(),
      totalIngredientCost: z.string(),
      totalRevenue: z.string(),
      totalContribution: z.string(),
      closedAt: z.string(),
      userId: z.string().nullable(),
      snapshot: z.object({
        period: z.string(),
        totalCIF: z.string(),
        totalUnits: z.number(),
        cifPerUnit: z.string(),
        allocationBase: z.literal('units'),
        dishes: z.array(dishSchema),
      }),
    }),
  );
  const closeListSchema = apiResponseSchema(
    z.array(
      z.object({
        id: z.uuid(),
        period: z.string(),
        totalCIF: z.string(),
        totalUnits: z.number(),
        totalIngredientCost: z.string(),
        totalRevenue: z.string(),
        totalContribution: z.string(),
        closedAt: z.string(),
        userId: z.string().nullable(),
        snapshot: z.unknown(),
      }),
    ),
  );
  const varianceSchema = apiResponseSchema(
    z.object({
      period: z.string(),
      theoreticalCost: z.string(),
      realCost: z.string(),
      variance: z.string(),
      variancePct: z.string(),
      byType: z.object({ waste: z.string(), sale: z.string() }),
      note: z.string(),
    }),
  );

  let ownerToken = '';
  let staffToken = '';
  let tenantId = '';
  let menuItemId = '';
  let ingredientId = '';

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
    tenantId = tenant.id;
    const passwordHash = await hash(password, 4);
    await admin.user.create({
      data: {
        tenantId,
        email: 'owner@close.pe',
        name: 'O',
        passwordHash,
        roles: ['owner'],
      },
    });
    await admin.user.create({
      data: {
        tenantId,
        email: 'staff@close.pe',
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
    ownerToken = await login('owner@close.pe');
    staffToken = await login('staff@close.pe');

    // Carta: insumo (unitCost 10) → receta (cost 10) → plato (precio 40).
    const zoneId = idSchema.parse(
      (await post('/api/zones', ownerToken, { name: 'Salón' }).expect(201))
        .body,
    ).data.id;
    ingredientId = idSchema.parse(
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
          items: [{ ingredientId, qty: 1 }],
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

    // CIF del período: 100.
    await post('/api/overhead-costs', ownerToken, {
      period: PERIOD,
      concept: 'Alquiler',
      amount: 100,
    }).expect(201);

    // Venta sembrada DIRECTAMENTE con issuedAt en 2031-05 (5 unidades · 40 = 200).
    const table = await admin.diningTable.create({
      data: { tenantId, zoneId, code: 'M1', capacity: 8 },
    });
    const order = await admin.order.create({
      data: {
        tenantId,
        tableId: table.id,
        guests: 4,
        status: 'paid',
        openedAt: IN_PERIOD,
        createdAt: IN_PERIOD,
      },
    });
    await admin.orderItem.create({
      data: {
        tenantId,
        orderId: order.id,
        menuItemId,
        name: 'Pizza Margarita',
        qty: 5,
        unitPrice: 40,
        createdAt: IN_PERIOD,
      },
    });
    await admin.sale.create({
      data: {
        tenantId,
        orderId: order.id,
        serie: 'B001',
        number: 1,
        docType: 'boleta',
        subtotal: 169.49,
        igv: 30.51,
        total: 200,
        status: 'issued',
        issuedAt: IN_PERIOD,
        createdAt: IN_PERIOD,
      },
    });

    // Movimientos de inventario en 2031-05: merma (−2) + salida manual sale (−3).
    // unitCost 10 → realCost = 20 (waste) + 30 (sale) = 50.
    await admin.inventoryMovement.create({
      data: {
        tenantId,
        ingredientId,
        type: 'waste',
        qty: -2,
        reason: 'Caducado',
        createdAt: IN_PERIOD,
      },
    });
    await admin.inventoryMovement.create({
      data: {
        tenantId,
        ingredientId,
        type: 'sale',
        qty: -3,
        note: 'Salida manual',
        createdAt: IN_PERIOD,
      },
    });
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(TRUNCATE);
    await admin.$disconnect();
    await app.close();
  });

  it('HU-06-06: cierra el período → persiste totales finales (ventas, directos, CIF)', async () => {
    const view = closeSchema.parse(
      (
        await post('/api/costing/close', ownerToken, { period: PERIOD }).expect(
          201,
        )
      ).body,
    ).data;
    expect(view.period).toBe(PERIOD);
    expect(view.totalCIF).toBe('100.00');
    expect(view.totalUnits).toBe(5);
    expect(view.totalIngredientCost).toBe('50.00'); // 5 · 10
    expect(view.totalRevenue).toBe('200.00'); // 5 · 40
    expect(view.totalContribution).toBe('50.00'); // 5 · (40 − 30)
    expect(typeof view.userId).toBe('string'); // quién cerró (JWT sub)
    // snapshot = el reporte de platos al cierre
    expect(view.snapshot.period).toBe(PERIOD);
    expect(view.snapshot.cifPerUnit).toBe('20.00'); // 100 / 5
    const dish = view.snapshot.dishes.find((d) => d.menuItemId === menuItemId);
    expect(dish?.ingredientCost).toBe('10.00');
    expect(dish?.unitsSold).toBe(5);
  });

  it('HU-06-06: segundo cierre del mismo período → 409 (no recerrable)', async () => {
    await post('/api/costing/close', ownerToken, { period: PERIOD }).expect(
      409,
    );
  });

  it('HU-06-06: lista de cierres y cierre por período', async () => {
    const list = closeListSchema.parse(
      (await get('/api/costing/closes', ownerToken).expect(200)).body,
    ).data;
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.some((c) => c.period === PERIOD)).toBe(true);

    const one = closeSchema.parse(
      (await get(`/api/costing/closes/${PERIOD}`, ownerToken).expect(200)).body,
    ).data;
    expect(one.period).toBe(PERIOD);
    expect(one.totalRevenue).toBe('200.00');
  });

  it('HU-06-06: cierre de un período inexistente → 404', async () => {
    await get('/api/costing/closes/2099-12', ownerToken).expect(404);
  });

  it('HU-06-07: comparativo real vs teórico — teórico del reporte, real de movimientos', async () => {
    const view = varianceSchema.parse(
      (
        await get(
          `/api/costing/cost-variance?period=${PERIOD}`,
          ownerToken,
        ).expect(200)
      ).body,
    ).data;
    expect(view.period).toBe(PERIOD);
    expect(view.theoreticalCost).toBe('50.00'); // reporte: 5 · 10
    expect(view.realCost).toBe('50.00'); // merma 20 + salida 30
    expect(view.byType.waste).toBe('20.00'); // |−2| · 10
    expect(view.byType.sale).toBe('30.00'); // |−3| · 10
    expect(view.variance).toBe('0.00'); // 50 − 50
    expect(typeof view.variancePct).toBe('string');
    expect(view.note.length).toBeGreaterThan(0); // limitación documentada
  });

  it('staff NO cierra ni ve el comparativo (info de gestión) → 403', async () => {
    await post('/api/costing/close', staffToken, { period: PERIOD }).expect(
      403,
    );
    await get(`/api/costing/cost-variance?period=${PERIOD}`, staffToken).expect(
      403,
    );
  });
});
