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
  'TRUNCATE TABLE "order_items","orders","dining_tables","zones","kitchen_stations","menu_modifiers","menu_availability","menu_items","menu_categories","recipe_versions","recipe_items","recipes","product_suppliers","suppliers","ingredients","categories","units_of_measure","audit_logs","refresh_tokens","users","tenants" CASCADE';

describe('Cocina / KDS — HU-03-06/07/08/09 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);
  const idSchema = apiResponseSchema(z.object({ id: z.uuid() }));

  const stationSchema = apiResponseSchema(
    z.object({
      id: z.uuid(),
      name: z.string(),
      position: z.number(),
    }),
  );
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
  const kitchenItemSchema = apiResponseSchema(
    z.object({
      orderItemId: z.uuid(),
      orderId: z.uuid(),
      tableCode: z.string(),
      dishName: z.string(),
      qty: z.number(),
      modifiers: z.array(
        z.object({ name: z.string(), priceDelta: z.number() }),
      ),
      notes: z.string().nullable(),
      status: z.string(),
      sentToKitchenAt: z.string(),
      waitMinutes: z.number(),
      isLate: z.boolean(),
    }),
  );
  const stationListSchema = apiResponseSchema(
    z.array(stationSchema.shape.data),
  );
  const queueSchema = apiResponseSchema(z.array(kitchenItemSchema.shape.data));
  const tableDetailSchema = apiResponseSchema(
    z.object({
      table: z.object({
        id: z.uuid(),
        code: z.string(),
        status: z.string(),
        currentOrderId: z.uuid().nullable(),
        openedAt: z.string().nullable(),
        guests: z.number().nullable(),
        waiterId: z.uuid().nullable(),
      }),
      order: orderSchema.shape.data.nullable(),
    }),
  );
  const tableListSchema = apiResponseSchema(
    z.array(
      z.object({
        id: z.uuid(),
        status: z.string(),
        currentOrderId: z.uuid().nullable(),
        guests: z.number().nullable(),
        waiterId: z.uuid().nullable(),
      }),
    ),
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
  let stationId = '';
  let categoryId = '';

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe(TRUNCATE);
    const tenant = await admin.tenant.create({ data: { name: 'Motif' } });
    const passwordHash = await hash(password, 4);
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'owner@kitchen.pe',
        name: 'O',
        passwordHash,
        roles: ['owner'],
      },
    });
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'staff@kitchen.pe',
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
    ownerToken = await login('owner@kitchen.pe');
    staffToken = await login('staff@kitchen.pe');

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
    // Categoría del menú (será enlazada a la estación de cocina).
    categoryId = idSchema.parse(
      (
        await post('/api/menu/categories', ownerToken, {
          name: 'Principales',
        }).expect(201)
      ).body,
    ).data.id;
    menuItemId = idSchema.parse(
      (
        await post('/api/menu/items', ownerToken, {
          recipeId,
          menuCategoryId: categoryId,
          name: 'Pizza Margarita',
          price: 50,
        }).expect(201)
      ).body,
    ).data.id;
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(TRUNCATE);
    await admin.$disconnect();
    await app.close();
  });

  it('HU-03-07: staff NO puede crear estación → 403; owner sí (manager)', async () => {
    await post('/api/kitchen/stations', staffToken, {
      name: 'Parrilla',
    }).expect(403);

    const station = stationSchema.parse(
      (
        await post('/api/kitchen/stations', ownerToken, {
          name: 'Parrilla',
          position: 1,
        }).expect(201)
      ).body,
    ).data;
    expect(station.name).toBe('Parrilla');
    stationId = station.id;

    // staff sí puede LEER la lista de estaciones (read Kitchen).
    const list = stationListSchema.parse(
      (await get('/api/kitchen/stations', staffToken).expect(200)).body,
    ).data;
    expect(list).toHaveLength(1);
  });

  it('vincula la categoría del menú a la estación (PATCH categoría)', async () => {
    await patch(`/api/menu/categories/${categoryId}`, ownerToken, {
      kitchenStationId: stationId,
    }).expect(200);
  });

  let orderId = '';
  let orderItemId = '';

  it('HU-03-06: enviar comanda a cocina sella sentToKitchenAt + estación', async () => {
    // abrir mesa + tomar 1 ítem
    orderId = orderSchema.parse(
      (
        await post('/api/orders', staffToken, {
          tableId,
          guests: 2,
        }).expect(201)
      ).body,
    ).data.id;
    await post(`/api/orders/${orderId}/items`, staffToken, {
      items: [{ menuItemId, qty: 1 }],
    }).expect(201);

    // sin ítems pendientes una orden vacía no aplica; aquí hay 1 → 201
    const sent = orderSchema.parse(
      (
        await post(
          `/api/orders/${orderId}/send-to-kitchen`,
          staffToken,
          {},
        ).expect(201)
      ).body,
    ).data;
    expect(sent.status).toBe('sent_to_kitchen');
    orderItemId = sent.items[0].id;
    // el ítem ya fue enviado (status sigue pending hasta que cocina lo tome)
    expect(sent.items[0].status).toBe('pending');

    // reenviar una orden ya enviada → 409 (no está 'open')
    await post(`/api/orders/${orderId}/send-to-kitchen`, staffToken, {}).expect(
      409,
    );
  });

  it('HU-03-07: la cola por estación devuelve el ítem (waitMinutes≈0, isLate false)', async () => {
    const queue = queueSchema.parse(
      (
        await get(
          `/api/kitchen/queue?stationId=${stationId}`,
          staffToken,
        ).expect(200)
      ).body,
    ).data;
    expect(queue).toHaveLength(1);
    const item = queue[0];
    expect(item.orderItemId).toBe(orderItemId);
    expect(item.tableCode).toBe('M1');
    expect(item.dishName).toBe('Pizza Margarita');
    expect(item.qty).toBe(1);
    expect(item.status).toBe('pending');
    expect(item.waitMinutes).toBe(0);
    expect(item.isLate).toBe(false);

    // cola sin filtro también lo incluye
    const all = queueSchema.parse(
      (await get('/api/kitchen/queue', staffToken).expect(200)).body,
    ).data;
    expect(all.find((i) => i.orderItemId === orderItemId)).toBeDefined();
  });

  it('HU-03-08/09: marcar ítem preparando → listo (timestamps); transición inválida → 409', async () => {
    // pending → ready directamente no se permite (debe pasar por preparing)
    await patch(`/api/kitchen/items/${orderItemId}`, staffToken, {
      status: 'ready',
    }).expect(409);

    const preparing = kitchenItemSchema.parse(
      (
        await patch(`/api/kitchen/items/${orderItemId}`, staffToken, {
          status: 'preparing',
        }).expect(200)
      ).body,
    ).data;
    expect(preparing.status).toBe('preparing');

    const ready = kitchenItemSchema.parse(
      (
        await patch(`/api/kitchen/items/${orderItemId}`, staffToken, {
          status: 'ready',
        }).expect(200)
      ).body,
    ).data;
    expect(ready.status).toBe('ready');

    // 'ready' ya salió de la cola (solo pending|preparing)
    const queue = queueSchema.parse(
      (await get('/api/kitchen/queue', staffToken).expect(200)).body,
    ).data;
    expect(queue.find((i) => i.orderItemId === orderItemId)).toBeUndefined();
  });

  it('POS read-model: GET /api/tables/:id devuelve la orden actual', async () => {
    const detail = tableDetailSchema.parse(
      (await get(`/api/tables/${tableId}`, staffToken).expect(200)).body,
    ).data;
    expect(detail.table.id).toBe(tableId);
    expect(detail.table.status).toBe('occupied');
    expect(detail.table.currentOrderId).toBe(orderId);
    expect(detail.table.guests).toBe(2);
    expect(detail.order).not.toBeNull();
    expect(detail.order?.id).toBe(orderId);
  });

  it('POS read-model: GET /api/tables enriquece con currentOrderId', async () => {
    const list = tableListSchema.parse(
      (await get('/api/tables', staffToken).expect(200)).body,
    ).data;
    const row = list.find((t) => t.id === tableId);
    expect(row?.currentOrderId).toBe(orderId);
    expect(row?.guests).toBe(2);
    expect(row?.waiterId).not.toBeNull();
  });
});
