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
  'TRUNCATE TABLE "inventory_movements","cash_closes","payments","sales","order_items","orders","dining_tables","zones","menu_modifiers","menu_availability","menu_items","menu_categories","recipe_versions","recipe_items","recipes","product_suppliers","suppliers","ingredients","categories","units_of_measure","audit_logs","refresh_tokens","users","tenants" CASCADE';

// El nombre del mesero (staff) que abre las mesas — se asevera en waiterName.
const STAFF_NAME = 'Pedro Mesero';

describe('Consumo de stock en venta + waiterName HU-05-consumo-en-venta (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);
  const idSchema = apiResponseSchema(z.object({ id: z.uuid() }));

  const orderSchema = apiResponseSchema(
    z.object({
      id: z.uuid(),
      status: z.string(),
      waiterId: z.uuid().nullable(),
      waiterName: z.string().nullable(),
    }),
  );
  const paySchema = apiResponseSchema(
    z.object({
      order: z.object({ id: z.uuid(), status: z.string() }),
      sale: z.object({ id: z.uuid(), status: z.string() }),
    }),
  );
  const movementListSchema = apiResponseSchema(
    z.array(
      z.object({
        id: z.uuid(),
        ingredientId: z.uuid(),
        type: z.string(),
        qty: z.string(),
        note: z.string().nullable(),
      }),
    ),
  );
  const stockListSchema = apiResponseSchema(
    z.array(
      z.object({
        ingredientId: z.uuid(),
        stock: z.string(),
      }),
    ),
  );
  const tableDetailSchema = apiResponseSchema(
    z.object({
      table: z.object({
        id: z.uuid(),
        status: z.string(),
        waiterId: z.uuid().nullable(),
        waiterName: z.string().nullable(),
      }),
      order: z
        .object({
          id: z.uuid(),
          waiterId: z.uuid().nullable(),
          waiterName: z.string().nullable(),
        })
        .nullable(),
    }),
  );
  const tableListSchema = apiResponseSchema(
    z.array(
      z.object({
        id: z.uuid(),
        status: z.string(),
        waiterId: z.uuid().nullable(),
        waiterName: z.string().nullable(),
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

  let zoneId = '';
  let menuItemId = '';
  let ingredientId = '';
  let tableSeq = 0;

  // Abre una mesa NUEVA con el staff (queda como mesero) y añade `qty` unidades
  // del plato. Devuelve orderId, tableId y el código de la mesa.
  const openOrderWithItems = async (
    qty: number,
  ): Promise<{ orderId: string; tableId: string }> => {
    tableSeq += 1;
    const tableId = idSchema.parse(
      (
        await post('/api/tables', ownerToken, {
          zoneId,
          code: `M${tableSeq}`,
          capacity: 8,
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
      items: [{ menuItemId, qty }],
    }).expect(201);
    return { orderId, tableId };
  };

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
        email: 'owner@stock.pe',
        name: 'O',
        passwordHash,
        roles: ['owner'],
      },
    });
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'staff@stock.pe',
        name: STAFF_NAME,
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
    ownerToken = await login('owner@stock.pe');
    staffToken = await login('staff@stock.pe');

    // Salón.
    zoneId = idSchema.parse(
      (await post('/api/zones', ownerToken, { name: 'Salón' }).expect(201))
        .body,
    ).data.id;

    // Insumo con stock 100 (entrada inicial) y costo 10. La receta usa 2 unidades
    // (yield 1) → cada plato vendido consume 2; plato del menú sobre esa receta.
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
    await post('/api/inventory/movements', ownerToken, {
      ingredientId,
      type: 'purchase',
      qty: 100,
      note: 'Stock inicial',
    }).expect(201);

    const recipeId = idSchema.parse(
      (
        await post('/api/recipes', ownerToken, {
          name: 'Pizza',
          kind: 'dish',
          yield: 1,
          items: [{ ingredientId, qty: 2 }],
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
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(TRUNCATE);
    await admin.$disconnect();
    await app.close();
  });

  it('Gap A: GET /api/tables/:id y GET /api/orders/:id devuelven waiterName del mesero', async () => {
    const { orderId, tableId } = await openOrderWithItems(1);

    // detalle de la mesa: el mesero es el staff que abrió → name = STAFF_NAME.
    const detail = tableDetailSchema.parse(
      (await get(`/api/tables/${tableId}`, staffToken).expect(200)).body,
    ).data;
    expect(detail.table.waiterId).not.toBeNull();
    expect(detail.table.waiterName).toBe(STAFF_NAME);
    expect(detail.order?.waiterName).toBe(STAFF_NAME);

    // vista de la orden.
    const order = orderSchema.parse(
      (await get(`/api/orders/${orderId}`, staffToken).expect(200)).body,
    ).data;
    expect(order.waiterName).toBe(STAFF_NAME);
  });

  it('Gap A: una mesa libre tiene waiterName null en el listado', async () => {
    tableSeq += 1;
    const tableId = idSchema.parse(
      (
        await post('/api/tables', ownerToken, {
          zoneId,
          code: `M${tableSeq}`,
          capacity: 4,
        }).expect(201)
      ).body,
    ).data.id;
    const list = tableListSchema.parse(
      (await get('/api/tables', staffToken).expect(200)).body,
    ).data;
    const free = list.find((t) => t.id === tableId);
    expect(free?.status).toBe('free');
    expect(free?.waiterId).toBeNull();
    expect(free?.waiterName).toBeNull();
  });

  it('Gap B: cobrar 3 unidades descuenta 6 del stock y registra 1 movimiento sale (qty -6)', async () => {
    const { orderId } = await openOrderWithItems(3);

    const { sale } = paySchema.parse(
      (
        await post(`/api/orders/${orderId}/pay`, staffToken, {
          payments: [{ method: 'cash', amount: 120 }],
          docType: 'boleta',
        }).expect(201)
      ).body,
    ).data;
    expect(sale.status).toBe('issued');

    // Un movimiento sale por insumo, qty negativo = -(2·3) = -6.
    const movements = movementListSchema.parse(
      (
        await get(
          `/api/inventory/movements?ingredientId=${ingredientId}`,
          ownerToken,
        ).expect(200)
      ).body,
    ).data;
    const saleMovements = movements.filter((m) => m.type === 'sale');
    expect(saleMovements).toHaveLength(1);
    expect(saleMovements[0].qty).toBe('-6.000');
    expect(saleMovements[0].note?.startsWith('Venta ')).toBe(true);
    expect(saleMovements[0].note).toContain(sale.id);

    // Stock: 100 − 6 = 94.
    const stock = stockListSchema.parse(
      (await get('/api/inventory/stock', ownerToken).expect(200)).body,
    ).data;
    expect(stock.find((s) => s.ingredientId === ingredientId)?.stock).toBe(
      '94.000',
    );
  });

  it('Gap B: vender más que el stock NO bloquea el cobro y deja el stock negativo', async () => {
    // Stock en 94 → vender 50 unidades consume 100 → stock 94 − 100 = -6.
    const { orderId } = await openOrderWithItems(50);

    await post(`/api/orders/${orderId}/pay`, staffToken, {
      payments: [{ method: 'cash', amount: 2000 }],
      docType: 'boleta',
    }).expect(201);

    const stock = stockListSchema.parse(
      (await get('/api/inventory/stock', ownerToken).expect(200)).body,
    ).data;
    expect(stock.find((s) => s.ingredientId === ingredientId)?.stock).toBe(
      '-6.000',
    );

    // El movimiento de consumo de esta venta se registró (qty -100).
    const movements = movementListSchema.parse(
      (
        await get(
          `/api/inventory/movements?ingredientId=${ingredientId}`,
          ownerToken,
        ).expect(200)
      ).body,
    ).data;
    const big = movements.find(
      (m) => m.type === 'sale' && m.qty === '-100.000',
    );
    expect(big).toBeDefined();
  });
});
