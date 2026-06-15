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

describe('Billing — cobros HU-04-01/02/04/05/06/07 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);
  const idSchema = apiResponseSchema(z.object({ id: z.uuid() }));
  const orderSchema = apiResponseSchema(
    z.object({ id: z.uuid(), status: z.string(), subtotal: z.string() }),
  );
  const preBillSchema = apiResponseSchema(
    z.object({
      orderId: z.uuid(),
      tableCode: z.string(),
      items: z.array(
        z.object({
          name: z.string(),
          qty: z.number(),
          unitPrice: z.string(),
          lineTotal: z.string(),
        }),
      ),
      subtotal: z.string(),
      igv: z.string(),
      total: z.string(),
    }),
  );
  const saleSchema = z.object({
    id: z.uuid(),
    orderId: z.uuid(),
    serie: z.string(),
    number: z.number(),
    docType: z.string(),
    customer: z.string().nullable(),
    customerDoc: z.string().nullable(),
    date: z.string(),
    tableLabel: z.string(),
    items: z.array(
      z.object({
        name: z.string(),
        qty: z.number(),
        unitPrice: z.string(),
        total: z.string(),
      }),
    ),
    subtotal: z.string(),
    igv: z.string(),
    total: z.string(),
    method: z.string(),
    payments: z.array(z.object({ method: z.string(), amount: z.string() })),
    status: z.string(),
  });
  const paySchema = apiResponseSchema(
    z.object({
      order: z.object({ id: z.uuid(), status: z.string() }),
      sale: saleSchema,
    }),
  );
  const saleViewSchema = apiResponseSchema(saleSchema);
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

  let zoneId = '';
  let menuItemId = '';
  let tableSeq = 0;

  // Abre una orden sobre una mesa NUEVA (cada test es independiente) con 1
  // unidad del plato (precio 118). Devuelve la orden, la mesa y su código.
  const openOrderWithItem = async (): Promise<{
    orderId: string;
    tableId: string;
    tableCode: string;
  }> => {
    tableSeq += 1;
    const tableCode = `M${tableSeq}`;
    const tableId = idSchema.parse(
      (
        await post('/api/tables', ownerToken, {
          zoneId,
          code: tableCode,
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
      items: [{ menuItemId, qty: 1 }],
    }).expect(201);
    return { orderId, tableId, tableCode };
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
        email: 'owner@billing.pe',
        name: 'O',
        passwordHash,
        roles: ['owner'],
      },
    });
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'staff@billing.pe',
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
    ownerToken = await login('owner@billing.pe');
    staffToken = await login('staff@billing.pe');

    // Seed salón + carta (owner). Precio 118 → subtotal 100, IGV 18 (18%).
    // Cada test abre su propia mesa (openOrderWithItem) → independientes.
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
          price: 118,
        }).expect(201)
      ).body,
    ).data.id;
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(TRUNCATE);
    await admin.$disconnect();
    await app.close();
  });

  it('HU-04-01: pre-cuenta calcula subtotal/IGV/total (precios incluyen IGV)', async () => {
    const { orderId, tableCode } = await openOrderWithItem();
    const pre = preBillSchema.parse(
      (await get(`/api/orders/${orderId}/pre-bill`, staffToken).expect(200))
        .body,
    ).data;
    expect(pre.total).toBe('118.00');
    expect(pre.subtotal).toBe('100.00');
    expect(pre.igv).toBe('18.00');
    expect(pre.tableCode).toBe(tableCode);
    expect(pre.items[0].lineTotal).toBe('118.00');
  });

  it('HU-04-02/04: staff cobra (boleta efectivo) → ticket B001-1, orden paid, mesa free', async () => {
    const { orderId, tableId, tableCode } = await openOrderWithItem();
    const { order, sale } = paySchema.parse(
      (
        await post(`/api/orders/${orderId}/pay`, staffToken, {
          payments: [{ method: 'cash', amount: 118 }],
          docType: 'boleta',
        }).expect(201)
      ).body,
    ).data;
    expect(sale.serie).toBe('B001');
    expect(sale.number).toBe(1);
    expect(sale.docType).toBe('boleta');
    expect(sale.total).toBe('118.00');
    expect(sale.subtotal).toBe('100.00');
    expect(sale.igv).toBe('18.00');
    expect(sale.method).toBe('cash');
    expect(sale.status).toBe('issued');
    expect(sale.tableLabel).toBe(`Mesa ${tableCode}`);
    expect(order.status).toBe('paid');

    // la mesa quedó libre
    const tables = tableListSchema.parse(
      (await get('/api/tables', staffToken).expect(200)).body,
    ).data;
    expect(tables.find((t) => t.id === tableId)?.status).toBe('free');

    // cobrar de nuevo la misma orden → 409
    await post(`/api/orders/${orderId}/pay`, staffToken, {
      payments: [{ method: 'cash', amount: 118 }],
    }).expect(409);
  });

  it('HU-04-04: pago insuficiente (< total) → 400', async () => {
    const { orderId } = await openOrderWithItem();
    await post(`/api/orders/${orderId}/pay`, staffToken, {
      payments: [{ method: 'cash', amount: 50 }],
    }).expect(400);
  });

  it('HU-04-06: pago mixto (efectivo 60 + Yape 58 = 118) → ok; correlativo B001-2', async () => {
    const { orderId } = await openOrderWithItem();
    const { sale } = paySchema.parse(
      (
        await post(`/api/orders/${orderId}/pay`, staffToken, {
          payments: [
            { method: 'cash', amount: 60 },
            { method: 'yape', amount: 58 },
          ],
        }).expect(201)
      ).body,
    ).data;
    expect(sale.serie).toBe('B001');
    expect(sale.number).toBe(2); // correlativo incrementa
    expect(sale.payments).toHaveLength(2);
    expect(sale.method).toBe('cash'); // método del primer pago
    expect(sale.payments.map((p) => p.amount)).toEqual(['60.00', '58.00']);
  });

  it('HU-04-02/05: factura con datos del cliente → serie F001 (correlativo propio)', async () => {
    const { orderId } = await openOrderWithItem();
    const { sale } = paySchema.parse(
      (
        await post(`/api/orders/${orderId}/pay`, staffToken, {
          payments: [{ method: 'card', amount: 118 }],
          docType: 'factura',
          customer: 'ACME SAC',
          customerDoc: '20123456789',
        }).expect(201)
      ).body,
    ).data;
    expect(sale.serie).toBe('F001');
    expect(sale.number).toBe(1); // serie distinta → su propio correlativo
    expect(sale.customer).toBe('ACME SAC');
    expect(sale.customerDoc).toBe('20123456789');
  });

  it('HU-04-07: staff NO anula (403); owner anula con razón (200 void); sin razón → 400', async () => {
    // emite un ticket para anular
    const { orderId } = await openOrderWithItem();
    const { sale } = paySchema.parse(
      (
        await post(`/api/orders/${orderId}/pay`, staffToken, {
          payments: [{ method: 'cash', amount: 118 }],
        }).expect(201)
      ).body,
    ).data;

    // staff → 403 (anular = manager/owner)
    await post(`/api/sales/${sale.id}/void`, staffToken, {
      reason: 'Error de cobro',
    }).expect(403);

    // owner sin razón → 400 (Zod: reason requerido)
    await post(`/api/sales/${sale.id}/void`, ownerToken, {}).expect(400);

    // owner con razón → 200, status void
    const voided = saleViewSchema.parse(
      (
        await post(`/api/sales/${sale.id}/void`, ownerToken, {
          reason: 'Error de cobro',
        }).expect(201)
      ).body,
    ).data;
    expect(voided.status).toBe('void');
  });

  it('GET /api/sales lista los tickets (desc por fecha)', async () => {
    const sales = apiResponseSchema(z.array(saleSchema)).parse(
      (await get('/api/sales', staffToken).expect(200)).body,
    ).data;
    // hasta aquí se emitieron 4 tickets (2 boletas + 1 factura + 1 anulado)
    expect(sales.length).toBeGreaterThanOrEqual(4);
    expect(sales.every((s) => typeof s.total === 'string')).toBe(true);
  });
});
