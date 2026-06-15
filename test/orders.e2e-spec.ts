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
  'TRUNCATE TABLE "order_items","orders","dining_tables","zones","menu_modifiers","menu_availability","menu_items","menu_categories","recipe_versions","recipe_items","recipes","product_suppliers","suppliers","ingredients","categories","units_of_measure","audit_logs","refresh_tokens","users","tenants" CASCADE';

describe('POS — órdenes HU-03-03/04/05/10/11/12 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);
  const idSchema = apiResponseSchema(z.object({ id: z.uuid() }));
  const orderSchema = apiResponseSchema(
    z.object({
      id: z.uuid(),
      tableId: z.uuid(),
      waiterId: z.uuid().nullable(),
      guests: z.number(),
      status: z.string(),
      openedAt: z.string(),
      subtotal: z.string(),
      items: z.array(
        z.object({
          id: z.uuid(),
          menuItemId: z.uuid(),
          name: z.string(),
          qty: z.number(),
          unitPrice: z.string(),
          notes: z.string().nullable(),
          modifiers: z.array(
            z.object({ name: z.string(), priceDelta: z.number() }),
          ),
          status: z.string(),
        }),
      ),
    }),
  );
  const tableListSchema = apiResponseSchema(
    z.array(z.object({ id: z.uuid(), status: z.string() })),
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

  let tableId = '';
  let menuItemId = '';
  let modifierId = '';

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe(TRUNCATE);
    const tenant = await admin.tenant.create({ data: { name: 'Motif' } });
    const passwordHash = await hash(password, 4);
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'owner@orders.pe',
        name: 'O',
        passwordHash,
        roles: ['owner'],
      },
    });
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'staff@orders.pe',
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
    ownerToken = await login('owner@orders.pe');
    staffToken = await login('staff@orders.pe');

    // Seed del salón + carta vía API (owner configura).
    const zoneId = idSchema.parse(
      (await post('/api/zones', ownerToken, { name: 'Salón' }).expect(201))
        .body,
    ).data.id;
    tableId = idSchema.parse(
      (
        await post('/api/tables', ownerToken, {
          zoneId,
          code: 'M1',
          capacity: 4,
        }).expect(201)
      ).body,
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
          price: 50,
        }).expect(201)
      ).body,
    ).data.id;
    modifierId = idSchema.parse(
      (
        await post(`/api/menu/items/${menuItemId}/modifiers`, ownerToken, {
          name: 'Extra queso',
          priceDelta: 5,
        }).expect(201)
      ).body,
    ).data.id;
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(TRUNCATE);
    await admin.$disconnect();
    await app.close();
  });

  let orderId = '';

  it('HU-03-03: el mesero abre la mesa (libre → ocupada); reabrir → 409', async () => {
    const order = orderSchema.parse(
      (
        await post('/api/orders', staffToken, {
          tableId,
          guests: 2,
        }).expect(201)
      ).body,
    ).data;
    expect(order.status).toBe('open');
    expect(order.guests).toBe(2);
    expect(order.waiterId).not.toBeNull();
    expect(order.subtotal).toBe('0.00');
    orderId = order.id;

    // la mesa quedó ocupada
    const tables = tableListSchema.parse(
      (await get(`/api/tables`, staffToken).expect(200)).body,
    ).data;
    expect(tables.find((t) => t.id === tableId)?.status).toBe('occupied');

    // abrir una mesa ocupada otra vez → 409
    await post('/api/orders', staffToken, { tableId, guests: 2 }).expect(409);
  });

  it('HU-03-04/05: agrega 2 ítems (uno con modificador); subtotal incluye el delta', async () => {
    const order = orderSchema.parse(
      (
        await post(`/api/orders/${orderId}/items`, staffToken, {
          items: [
            { menuItemId, qty: 1, modifierIds: [modifierId] },
            { menuItemId, qty: 2 },
          ],
        }).expect(201)
      ).body,
    ).data;

    expect(order.items).toHaveLength(2);
    const modified = order.items.find((i) => i.modifiers.length > 0);
    const plain = order.items.find((i) => i.modifiers.length === 0);
    expect(modified?.unitPrice).toBe('55.00'); // 50 + 5
    expect(modified?.modifiers[0]).toEqual({
      name: 'Extra queso',
      priceDelta: 5,
    });
    expect(plain?.unitPrice).toBe('50.00');
    // subtotal = 55*1 + 50*2 = 155.00
    expect(order.subtotal).toBe('155.00');
  });

  it('HU-03-10: marca un ítem como servido → 200', async () => {
    const before = orderSchema.parse(
      (await get(`/api/orders/${orderId}`, staffToken).expect(200)).body,
    ).data;
    const itemId = before.items[0].id;
    const order = orderSchema.parse(
      (
        await patch(`/api/orders/${orderId}/items/${itemId}`, staffToken, {
          status: 'served',
        }).expect(200)
      ).body,
    ).data;
    const served = order.items.find((i) => i.id === itemId);
    expect(served?.status).toBe('served');
  });

  it('HU-03-11: anular sin razón → 400; con razón → 200 y libera la mesa', async () => {
    // sin razón → 400 (validación Zod: reason requerido)
    await post(`/api/orders/${orderId}/void`, staffToken, {}).expect(400);

    const order = orderSchema.parse(
      (
        await post(`/api/orders/${orderId}/void`, staffToken, {
          reason: 'Cliente se retiró',
        }).expect(201)
      ).body,
    ).data;
    expect(order.status).toBe('void');

    // la mesa volvió a 'free'
    const tables = tableListSchema.parse(
      (await get(`/api/tables`, staffToken).expect(200)).body,
    ).data;
    expect(tables.find((t) => t.id === tableId)?.status).toBe('free');
  });

  it('HU-03-03: idempotencia — misma idempotencyKey devuelve la misma orden', async () => {
    // liberar la mesa (la dejó ocupada un test previo si aplica). Aquí la mesa
    // quedó 'free' tras la anulación, así que se puede reabrir.
    const key = 'idem-key-123';
    const first = orderSchema.parse(
      (
        await post('/api/orders', staffToken, {
          tableId,
          guests: 1,
          idempotencyKey: key,
        }).expect(201)
      ).body,
    ).data;
    const second = orderSchema.parse(
      (
        await post('/api/orders', staffToken, {
          tableId,
          guests: 1,
          idempotencyKey: key,
        }).expect(201)
      ).body,
    ).data;
    expect(second.id).toBe(first.id); // sin duplicado
  });
});
