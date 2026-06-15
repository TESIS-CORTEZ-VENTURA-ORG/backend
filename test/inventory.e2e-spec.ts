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
  'TRUNCATE TABLE "inventory_movements","order_items","orders","dining_tables","zones","menu_modifiers","menu_availability","menu_items","menu_categories","recipe_versions","recipe_items","recipes","product_suppliers","suppliers","ingredients","categories","units_of_measure","audit_logs","refresh_tokens","users","tenants" CASCADE';

describe('Inventario — stock/movimientos/mermas/alertas HU-05-01/02/03/08/09/10 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);
  const idSchema = apiResponseSchema(z.object({ id: z.uuid() }));

  const movementSchema = apiResponseSchema(
    z.object({
      id: z.uuid(),
      ingredientId: z.uuid(),
      ingredientName: z.string(),
      type: z.string(),
      qty: z.string(),
      unit: z.string(),
      note: z.string().nullable(),
      reason: z.string().nullable(),
      userId: z.uuid().nullable(),
      createdAt: z.string(),
    }),
  );
  const movementListSchema = apiResponseSchema(
    z.array(
      z.object({
        id: z.uuid(),
        ingredientId: z.uuid(),
        ingredientName: z.string(),
        type: z.string(),
        qty: z.string(),
        reason: z.string().nullable(),
        userId: z.uuid().nullable(),
        createdAt: z.string(),
      }),
    ),
  );
  const stockListSchema = apiResponseSchema(
    z.array(
      z.object({
        ingredientId: z.uuid(),
        name: z.string(),
        unit: z.string(),
        unitCost: z.string(),
        stock: z.string(),
        minStock: z.string(),
        status: z.enum(['ok', 'low', 'critical']),
      }),
    ),
  );
  const stockSchema = apiResponseSchema(
    z.object({
      ingredientId: z.uuid(),
      stock: z.string(),
      minStock: z.string(),
      status: z.enum(['ok', 'low', 'critical']),
    }),
  );
  const alertListSchema = apiResponseSchema(
    z.array(
      z.object({
        ingredientId: z.uuid(),
        name: z.string(),
        unit: z.string(),
        stock: z.string(),
        minStock: z.string(),
        deficit: z.string(),
        status: z.enum(['ok', 'low', 'critical']),
      }),
    ),
  );
  const wasteSchema = apiResponseSchema(
    z.object({
      items: z.array(
        z.object({
          id: z.uuid(),
          ingredientName: z.string(),
          type: z.string(),
          qty: z.string(),
          reason: z.string().nullable(),
          userId: z.uuid().nullable(),
          createdAt: z.string(),
        }),
      ),
      totalWasteCost: z.string(),
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
  const get = (path: string, token: string) =>
    request(app.getHttpServer()).get(path).set(bearer(token));
  const post = (path: string, token: string, body: unknown) =>
    request(app.getHttpServer()).post(path).set(bearer(token)).send(body);
  const patch = (path: string, token: string, body: unknown) =>
    request(app.getHttpServer()).patch(path).set(bearer(token)).send(body);

  let ingredientId = '';

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe(TRUNCATE);
    const tenant = await admin.tenant.create({ data: { name: 'Motif' } });
    const passwordHash = await hash(password, 4);
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'owner@inv.pe',
        name: 'O',
        passwordHash,
        roles: ['owner'],
      },
    });
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'staff@inv.pe',
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
    ownerToken = await login('owner@inv.pe');
    staffToken = await login('staff@inv.pe');

    // Insumo con costo 10 (owner crea el catálogo).
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
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(TRUNCATE);
    await admin.$disconnect();
    await app.close();
  });

  it('HU-05-10: el gerente configura el mínimo de reorden (minStock=5)', async () => {
    const level = stockSchema.parse(
      (
        await patch(`/api/inventory/levels/${ingredientId}`, ownerToken, {
          minStock: 5,
        }).expect(200)
      ).body,
    ).data;
    expect(level.minStock).toBe('5.000');
    expect(level.stock).toBe('0.000');
    // stock 0 ≤ min·0.5 → crítico.
    expect(level.status).toBe('critical');
  });

  it('HU-05-02: entrada +10 → stock 10', async () => {
    const mov = movementSchema.parse(
      (
        await post('/api/inventory/movements', ownerToken, {
          ingredientId,
          type: 'purchase',
          qty: 10,
          note: 'Compra al contado',
        }).expect(201)
      ).body,
    ).data;
    expect(mov.qty).toBe('10.000');
    expect(mov.type).toBe('purchase');
    expect(mov.userId).not.toBeNull();
  });

  it('HU-05-03: salida -3 → stock 7', async () => {
    await post('/api/inventory/movements', ownerToken, {
      ingredientId,
      type: 'sale',
      qty: -3,
    }).expect(201);
  });

  it('HU-05-08: merma -2 CON razón → stock 5', async () => {
    const mov = movementSchema.parse(
      (
        await post('/api/inventory/movements', ownerToken, {
          ingredientId,
          type: 'waste',
          qty: -2,
          reason: 'EXPIRED',
        }).expect(201)
      ).body,
    ).data;
    expect(mov.reason).toBe('EXPIRED');
    expect(mov.qty).toBe('-2.000');
  });

  it('HU-05-08: merma SIN razón → 400', async () => {
    await post('/api/inventory/movements', ownerToken, {
      ingredientId,
      type: 'waste',
      qty: -1,
    }).expect(400);
  });

  it('HU-05-03: salida que dejaría el stock negativo → 400', async () => {
    await post('/api/inventory/movements', ownerToken, {
      ingredientId,
      type: 'sale',
      qty: -999,
    }).expect(400);
  });

  it('HU-05-01: GET /api/inventory/stock muestra stock 5 y su estado', async () => {
    const rows = stockListSchema.parse(
      (await get('/api/inventory/stock', ownerToken).expect(200)).body,
    ).data;
    const queso = rows.find((r) => r.ingredientId === ingredientId);
    expect(queso?.stock).toBe('5.000');
    expect(queso?.minStock).toBe('5.000');
    expect(queso?.unitCost).toBe('10.00');
    // stock 5 = min 5 → no es low (low es estricto <), pero 5 > min·0.5 → ok.
    expect(queso?.status).toBe('ok');
  });

  it('HU-05-10: salida -1 → stock 4 (< min 5) y aparece en /api/inventory/alerts', async () => {
    await post('/api/inventory/movements', ownerToken, {
      ingredientId,
      type: 'sale',
      qty: -1,
    }).expect(201);

    const alerts = alertListSchema.parse(
      (await get('/api/inventory/alerts', ownerToken).expect(200)).body,
    ).data;
    const alert = alerts.find((a) => a.ingredientId === ingredientId);
    expect(alert).toBeDefined();
    expect(alert?.stock).toBe('4.000');
    expect(alert?.deficit).toBe('1.000'); // 5 − 4
    expect(alert?.status).toBe('low');
  });

  it('HU-05-09: GET /api/inventory/waste muestra la merma con su razón y el costo', async () => {
    const waste = wasteSchema.parse(
      (await get('/api/inventory/waste', ownerToken).expect(200)).body,
    ).data;
    expect(waste.items).toHaveLength(1);
    expect(waste.items[0].reason).toBe('EXPIRED');
    expect(waste.items[0].type).toBe('waste');
    // |−2| · 10 = 20.00
    expect(waste.totalWasteCost).toBe('20.00');
  });

  it('HU-05-01: GET /api/inventory/movements lista todos en orden (desc)', async () => {
    const movements = movementListSchema.parse(
      (await get('/api/inventory/movements', ownerToken).expect(200)).body,
    ).data;
    // purchase +10, sale -3, waste -2, sale -1 = 4 movimientos.
    expect(movements).toHaveLength(4);
    // El más reciente primero (la última salida).
    expect(movements[0].type).toBe('sale');
    expect(movements[0].qty).toBe('-1.000');

    // Filtrado por insumo devuelve lo mismo (solo hay un insumo).
    const filtered = movementListSchema.parse(
      (
        await get(
          `/api/inventory/movements?ingredientId=${ingredientId}`,
          ownerToken,
        ).expect(200)
      ).body,
    ).data;
    expect(filtered).toHaveLength(4);
  });

  it('RBAC: el staff NO puede registrar un movimiento → 403, pero SÍ puede leer el stock', async () => {
    await post('/api/inventory/movements', staffToken, {
      ingredientId,
      type: 'purchase',
      qty: 1,
    }).expect(403);

    // staff tiene read Inventory.
    await get('/api/inventory/stock', staffToken).expect(200);
  });
});
