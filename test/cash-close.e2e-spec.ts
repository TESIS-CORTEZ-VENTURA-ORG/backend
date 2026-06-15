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

describe('Cierre Z del día HU-04-08 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);
  const idSchema = apiResponseSchema(z.object({ id: z.uuid() }));
  const orderSchema = apiResponseSchema(
    z.object({ id: z.uuid(), status: z.string() }),
  );
  const byMethodSchema = z.object({
    cash: z.string(),
    card: z.string(),
    yape: z.string(),
    plin: z.string(),
  });
  const previewSchema = apiResponseSchema(
    z.object({
      periodStart: z.string().nullable(),
      salesCount: z.number(),
      voidCount: z.number(),
      totalGross: z.string(),
      byMethod: byMethodSchema,
      openSince: z.string().nullable(),
    }),
  );
  const closeSchema = apiResponseSchema(
    z.object({
      id: z.uuid(),
      openedAt: z.string(),
      closedAt: z.string(),
      salesCount: z.number(),
      voidCount: z.number(),
      totalGross: z.string(),
      byMethod: byMethodSchema,
      userId: z.string().nullable(),
    }),
  );
  const closeListSchema = apiResponseSchema(z.array(closeSchema.shape.data));

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
  let menuItemId = ''; // precio 118
  let tableSeq = 0;

  // Abre una orden NUEVA con 1 plato (118) y la cobra con el método indicado.
  const sell = async (method: string): Promise<void> => {
    tableSeq += 1;
    const tableId = idSchema.parse(
      (
        await post('/api/tables', ownerToken, {
          zoneId,
          code: `Z${tableSeq}`,
          capacity: 4,
        }).expect(201)
      ).body,
    ).data.id;
    const orderId = orderSchema.parse(
      (
        await post('/api/orders', staffToken, { tableId, guests: 1 }).expect(
          201,
        )
      ).body,
    ).data.id;
    await post(`/api/orders/${orderId}/items`, staffToken, {
      items: [{ menuItemId, qty: 1 }],
    }).expect(201);
    await post(`/api/orders/${orderId}/pay`, staffToken, {
      payments: [{ method, amount: 118 }],
    }).expect(201);
  };

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe(TRUNCATE);
    const tenant = await admin.tenant.create({
      data: { name: 'Motif Z', igvRate: 0.18 },
    });
    const passwordHash = await hash(password, 4);
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'owner@cz.pe',
        name: 'O',
        passwordHash,
        roles: ['owner'],
      },
    });
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'staff@cz.pe',
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
    ownerToken = await login('owner@cz.pe');
    staffToken = await login('staff@cz.pe');

    zoneId = idSchema.parse(
      (await post('/api/zones', ownerToken, { name: 'Salón' }).expect(201))
        .body,
    ).data.id;
    const ingId = idSchema.parse(
      (
        await post('/api/ingredients', ownerToken, {
          sku: 'QZ',
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
          name: 'Pizza',
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

  it('preview agrega ventas por método + conteos (2 ventas: cash + yape)', async () => {
    await sell('cash');
    await sell('yape');
    const preview = previewSchema.parse(
      (await get('/api/cash-close/preview', staffToken).expect(200)).body,
    ).data;
    expect(preview.salesCount).toBe(2);
    expect(preview.voidCount).toBe(0);
    expect(preview.totalGross).toBe('236.00'); // 118 + 118
    expect(preview.byMethod.cash).toBe('118.00');
    expect(preview.byMethod.yape).toBe('118.00');
    expect(preview.byMethod.card).toBe('0.00');
    expect(preview.byMethod.plin).toBe('0.00');
    expect(preview.periodStart).toBeNull(); // primer turno (all-time)
    expect(preview.openSince).not.toBeNull();
  });

  it('staff NO puede cerrar caja → 403', async () => {
    await post('/api/cash-close', staffToken, {}).expect(403);
  });

  it('owner cierra caja (cierre Z) → persiste totales == preview', async () => {
    const close = closeSchema.parse(
      (await post('/api/cash-close', ownerToken, {}).expect(201)).body,
    ).data;
    expect(close.salesCount).toBe(2);
    expect(close.totalGross).toBe('236.00');
    expect(close.byMethod.cash).toBe('118.00');
    expect(close.byMethod.yape).toBe('118.00');
    expect(close.userId).not.toBeNull();
  });

  it('tras el cierre, el preview arranca ventana fresca (vacía)', async () => {
    const preview = previewSchema.parse(
      (await get('/api/cash-close/preview', staffToken).expect(200)).body,
    ).data;
    expect(preview.salesCount).toBe(0);
    expect(preview.totalGross).toBe('0.00');
    expect(preview.byMethod.cash).toBe('0.00');
    expect(preview.periodStart).not.toBeNull(); // = closedAt del cierre anterior
  });

  it('una venta nueva tras el cierre cuenta solo en la ventana nueva', async () => {
    await sell('card');
    const preview = previewSchema.parse(
      (await get('/api/cash-close/preview', staffToken).expect(200)).body,
    ).data;
    expect(preview.salesCount).toBe(1);
    expect(preview.totalGross).toBe('118.00');
    expect(preview.byMethod.card).toBe('118.00');
    expect(preview.byMethod.cash).toBe('0.00');
  });

  it('GET /api/cash-close lista los cierres (desc) — staff puede leer', async () => {
    const closes = closeListSchema.parse(
      (await get('/api/cash-close', staffToken).expect(200)).body,
    ).data;
    expect(closes.length).toBeGreaterThanOrEqual(1);
    expect(closes[0].totalGross).toBe('236.00');
  });
});
