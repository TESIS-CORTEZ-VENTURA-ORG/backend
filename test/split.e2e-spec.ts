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
  'TRUNCATE TABLE "cash_closes","payments","sales","order_items","orders","dining_tables","zones","menu_modifiers","menu_availability","menu_items","menu_categories","recipe_versions","recipe_items","recipes","product_suppliers","suppliers","ingredients","categories","units_of_measure","audit_logs","refresh_tokens","users","tenants" CASCADE';

describe('Split — división de cuenta por comensal HU-04-03 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);
  const idSchema = apiResponseSchema(z.object({ id: z.uuid() }));
  const orderSchema = apiResponseSchema(
    z.object({
      id: z.uuid(),
      status: z.string(),
      items: z.array(z.object({ id: z.uuid(), name: z.string() })),
    }),
  );
  const splitShare = z.object({
    label: z.string(),
    subtotal: z.string(),
    igv: z.string(),
    total: z.string(),
  });
  const splitSchema = apiResponseSchema(
    z.object({
      orderId: z.uuid(),
      mode: z.string(),
      shares: z.array(splitShare),
      total: z.string(),
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
  const post = (path: string, token: string, body: unknown) =>
    request(app.getHttpServer()).post(path).set(bearer(token)).send(body);

  let zoneId = '';
  let menuItemA = ''; // precio 60
  let menuItemB = ''; // precio 40
  let tableSeq = 0;

  // Abre una orden NUEVA con 1×A (60) + 1×B (40) = total 100. Devuelve los
  // orderItemId resueltos (A primero por orden de inserción).
  const openOrderWith2Items = async (): Promise<{
    orderId: string;
    itemIdA: string;
    itemIdB: string;
  }> => {
    tableSeq += 1;
    const tableId = idSchema.parse(
      (
        await post('/api/tables', ownerToken, {
          zoneId,
          code: `S${tableSeq}`,
          capacity: 4,
        }).expect(201)
      ).body,
    ).data.id;
    const orderId = orderSchema.parse(
      (
        await post('/api/orders', staffToken, { tableId, guests: 2 }).expect(
          201,
        )
      ).body,
    ).data.id;
    await post(`/api/orders/${orderId}/items`, staffToken, {
      items: [{ menuItemId: menuItemA, qty: 1 }],
    }).expect(201);
    const withBoth = orderSchema.parse(
      (
        await post(`/api/orders/${orderId}/items`, staffToken, {
          items: [{ menuItemId: menuItemB, qty: 1 }],
        }).expect(201)
      ).body,
    ).data;
    const itemA = withBoth.items.find((i) => i.name === 'Plato A');
    const itemB = withBoth.items.find((i) => i.name === 'Plato B');
    return { orderId, itemIdA: itemA!.id, itemIdB: itemB!.id };
  };

  const seedMenuItem = async (name: string, price: number): Promise<string> => {
    const ingId = idSchema.parse(
      (
        await post('/api/ingredients', ownerToken, {
          sku: `SKU-${name}`,
          name: `Ing ${name}`,
          type: 'raw',
          unit: 'kg',
          unitCost: 1,
        }).expect(201)
      ).body,
    ).data.id;
    const recipeId = idSchema.parse(
      (
        await post('/api/recipes', ownerToken, {
          name: `Receta ${name}`,
          kind: 'dish',
          yield: 1,
          items: [{ ingredientId: ingId, qty: 1 }],
        }).expect(201)
      ).body,
    ).data.id;
    return idSchema.parse(
      (
        await post('/api/menu/items', ownerToken, {
          recipeId,
          name,
          price,
        }).expect(201)
      ).body,
    ).data.id;
  };

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe(TRUNCATE);
    const tenant = await admin.tenant.create({
      data: { name: 'Motif Split', igvRate: 0.18 },
    });
    const passwordHash = await hash(password, 4);
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'owner@split.pe',
        name: 'O',
        passwordHash,
        roles: ['owner'],
      },
    });
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'staff@split.pe',
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
    ownerToken = await login('owner@split.pe');
    staffToken = await login('staff@split.pe');

    zoneId = idSchema.parse(
      (await post('/api/zones', ownerToken, { name: 'Salón' }).expect(201))
        .body,
    ).data.id;
    menuItemA = await seedMenuItem('Plato A', 60);
    menuItemB = await seedMenuItem('Plato B', 40);
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(TRUNCATE);
    await admin.$disconnect();
    await app.close();
  });

  it('equal parts=2: dos partes que suman el total (100)', async () => {
    const { orderId } = await openOrderWith2Items();
    const split = splitSchema.parse(
      (
        await post(`/api/orders/${orderId}/split`, staffToken, {
          mode: 'equal',
          parts: 2,
        }).expect(201)
      ).body,
    ).data;
    expect(split.mode).toBe('equal');
    expect(split.total).toBe('100.00');
    expect(split.shares).toHaveLength(2);
    expect(split.shares[0].total).toBe('50.00');
    expect(split.shares[1].total).toBe('50.00');
    const sum = split.shares.reduce((a, s) => a + Number(s.total), 0);
    expect(sum).toBeCloseTo(100, 2);
  });

  it('equal sin parts usa order.guests (2) → divide en 2', async () => {
    const { orderId } = await openOrderWith2Items();
    const split = splitSchema.parse(
      (
        await post(`/api/orders/${orderId}/split`, staffToken, {
          mode: 'equal',
        }).expect(201)
      ).body,
    ).data;
    expect(split.shares).toHaveLength(2);
  });

  it('equal con total no divisible (parts=3 de 100) → resto en la 1ª parte; suma exacta', async () => {
    const { orderId } = await openOrderWith2Items();
    const split = splitSchema.parse(
      (
        await post(`/api/orders/${orderId}/split`, staffToken, {
          mode: 'equal',
          parts: 3,
        }).expect(201)
      ).body,
    ).data;
    expect(split.shares).toHaveLength(3);
    // 100/3 = 33.33; resto 0.01 a la 1ª → 33.34 + 33.33 + 33.33 = 100.00
    expect(split.shares[0].total).toBe('33.34');
    expect(split.shares[1].total).toBe('33.33');
    expect(split.shares[2].total).toBe('33.33');
    const sum = split.shares.reduce((a, s) => a + Number(s.total), 0);
    expect(sum).toBeCloseTo(100, 2);
  });

  it('items con asignación válida → totales por parte (60 / 40)', async () => {
    const { orderId, itemIdA, itemIdB } = await openOrderWith2Items();
    const split = splitSchema.parse(
      (
        await post(`/api/orders/${orderId}/split`, staffToken, {
          mode: 'items',
          assignments: [
            { label: 'Ana', itemIds: [itemIdA] },
            { label: 'Beto', itemIds: [itemIdB] },
          ],
        }).expect(201)
      ).body,
    ).data;
    expect(split.mode).toBe('items');
    expect(split.shares).toHaveLength(2);
    const ana = split.shares.find((s) => s.label === 'Ana');
    const beto = split.shares.find((s) => s.label === 'Beto');
    expect(ana?.total).toBe('60.00');
    expect(beto?.total).toBe('40.00');
    const sum = split.shares.reduce((a, s) => a + Number(s.total), 0);
    expect(sum).toBeCloseTo(100, 2);
  });

  it('items con asignación parcial (falta un ítem) → 400', async () => {
    const { orderId, itemIdA } = await openOrderWith2Items();
    await post(`/api/orders/${orderId}/split`, staffToken, {
      mode: 'items',
      assignments: [{ label: 'Ana', itemIds: [itemIdA] }],
    }).expect(400);
  });

  it('items con ítem duplicado → 400', async () => {
    const { orderId, itemIdA, itemIdB } = await openOrderWith2Items();
    await post(`/api/orders/${orderId}/split`, staffToken, {
      mode: 'items',
      assignments: [
        { label: 'Ana', itemIds: [itemIdA, itemIdB] },
        { label: 'Beto', itemIds: [itemIdB] },
      ],
    }).expect(400);
  });

  it('orden inexistente → 404', async () => {
    await post(
      `/api/orders/00000000-0000-0000-0000-000000000000/split`,
      staffToken,
      { mode: 'equal', parts: 2 },
    ).expect(404);
  });
});
