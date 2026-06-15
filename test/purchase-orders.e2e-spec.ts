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
  'TRUNCATE TABLE "purchase_order_items","purchase_orders","inventory_movements","order_items","orders","dining_tables","zones","menu_modifiers","menu_availability","menu_items","menu_categories","recipe_versions","recipe_items","recipes","product_suppliers","suppliers","ingredients","categories","units_of_measure","audit_logs","refresh_tokens","users","tenants" CASCADE';

describe('Órdenes de compra — HU-05-04/05/06/07 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);
  const idSchema = apiResponseSchema(z.object({ id: z.uuid() }));

  const poSchema = apiResponseSchema(
    z.object({
      id: z.uuid(),
      supplierId: z.uuid(),
      supplierName: z.string(),
      status: z.enum([
        'draft',
        'sent',
        'partially_received',
        'received',
        'cancelled',
      ]),
      expectedAt: z.string().nullable(),
      notes: z.string().nullable(),
      total: z.string(),
      items: z.array(
        z.object({
          id: z.uuid(),
          ingredientId: z.uuid(),
          ingredientName: z.string(),
          qtyOrdered: z.string(),
          qtyReceived: z.string(),
          unitCost: z.string(),
          lineTotal: z.string(),
        }),
      ),
    }),
  );
  const stockListSchema = apiResponseSchema(
    z.array(
      z.object({
        ingredientId: z.uuid(),
        stock: z.string(),
        unitCost: z.string(),
      }),
    ),
  );
  const movementListSchema = apiResponseSchema(
    z.array(z.object({ type: z.string(), qty: z.string() })),
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

  let supplierId = '';
  let ingredientId = '';

  // Stock actual del insumo sembrado (vía GET /api/inventory/stock).
  const stockOf = async (id: string): Promise<string> => {
    const rows = stockListSchema.parse(
      (await get('/api/inventory/stock', ownerToken).expect(200)).body,
    ).data;
    return rows.find((r) => r.ingredientId === id)?.stock ?? 'NOT_FOUND';
  };
  // Nº de movimientos `purchase` registrados (verifica el kardex).
  const purchaseMovements = async (): Promise<number> => {
    const rows = movementListSchema.parse(
      (await get('/api/inventory/movements', ownerToken).expect(200)).body,
    ).data;
    return rows.filter((m) => m.type === 'purchase').length;
  };

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe(TRUNCATE);
    const tenant = await admin.tenant.create({ data: { name: 'Motif' } });
    const passwordHash = await hash(password, 4);
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'owner@po.pe',
        name: 'O',
        passwordHash,
        roles: ['owner'],
      },
    });
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'staff@po.pe',
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
    ownerToken = await login('owner@po.pe');
    staffToken = await login('staff@po.pe');

    // Proveedor + insumo (stock 0, unitCost 10) — owner siembra el catálogo.
    supplierId = idSchema.parse(
      (
        await post('/api/suppliers', ownerToken, {
          ruc: '20123456789',
          name: 'Distribuidora Andina',
        }).expect(201)
      ).body,
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
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(TRUNCATE);
    await admin.$disconnect();
    await app.close();
  });

  let poId = '';

  it('HU-05-04: el gerente crea una OC (2 del insumo @ 12) → draft, total 24.00', async () => {
    const po = poSchema.parse(
      (
        await post('/api/purchase-orders', ownerToken, {
          supplierId,
          notes: 'Reposición semanal',
          items: [{ ingredientId, qtyOrdered: 2, unitCost: 12 }],
        }).expect(201)
      ).body,
    ).data;
    expect(po.status).toBe('draft');
    expect(po.supplierName).toBe('Distribuidora Andina');
    expect(po.total).toBe('24.00');
    expect(po.items).toHaveLength(1);
    expect(po.items[0].qtyOrdered).toBe('2.000');
    expect(po.items[0].qtyReceived).toBe('0.000');
    expect(po.items[0].unitCost).toBe('12.00');
    expect(po.items[0].lineTotal).toBe('24.00');
    poId = po.id;
  });

  it('HU-05-04: crear OC con proveedor inexistente → 400', async () => {
    await post('/api/purchase-orders', ownerToken, {
      supplierId: '00000000-0000-0000-0000-000000000000',
      items: [{ ingredientId, qtyOrdered: 1, unitCost: 5 }],
    }).expect(400);
  });

  it('HU-05-06: recepcionar una OC en draft (aún no enviada) → 409', async () => {
    const before = await stockOf(ingredientId);
    expect(before).toBe('0.000');
    // Necesita una línea válida; el estado draft la bloquea (409).
    const itemId = poSchema.parse(
      (await get(`/api/purchase-orders/${poId}`, ownerToken).expect(200)).body,
    ).data.items[0].id;
    await post(`/api/purchase-orders/${poId}/receive`, ownerToken, {
      items: [{ itemId, qtyReceived: 1 }],
    }).expect(409);
  });

  it('HU-05-05: enviar la OC (draft → sent); reenviar → 409', async () => {
    const sent = poSchema.parse(
      (
        await post(`/api/purchase-orders/${poId}/send`, ownerToken, {}).expect(
          201,
        )
      ).body,
    ).data;
    expect(sent.status).toBe('sent');
    // Reenviar una OC ya enviada → 409.
    await post(`/api/purchase-orders/${poId}/send`, ownerToken, {}).expect(409);
  });

  it('HU-05-06: recepción PARCIAL (1 de 2) → stock +1, OC partially_received, 1 movimiento purchase', async () => {
    const itemId = poSchema.parse(
      (await get(`/api/purchase-orders/${poId}`, ownerToken).expect(200)).body,
    ).data.items[0].id;

    const po = poSchema.parse(
      (
        await post(`/api/purchase-orders/${poId}/receive`, ownerToken, {
          items: [{ itemId, qtyReceived: 1 }],
        }).expect(201)
      ).body,
    ).data;
    expect(po.status).toBe('partially_received');
    expect(po.items[0].qtyReceived).toBe('1.000');

    expect(await stockOf(ingredientId)).toBe('1.000');
    expect(await purchaseMovements()).toBe(1);
  });

  it('HU-05-06: recepción de MÁS de lo que falta → 400', async () => {
    const itemId = poSchema.parse(
      (await get(`/api/purchase-orders/${poId}`, ownerToken).expect(200)).body,
    ).data.items[0].id;
    // Falta 1 (2 ordenadas − 1 recibida); recibir 2 más excede → 400.
    await post(`/api/purchase-orders/${poId}/receive`, ownerToken, {
      items: [{ itemId, qtyReceived: 2 }],
    }).expect(400);
  });

  it('HU-05-06: recepción del RESTO (1) → stock 2 (total), OC received, otro movimiento purchase, unitCost = 12', async () => {
    const itemId = poSchema.parse(
      (await get(`/api/purchase-orders/${poId}`, ownerToken).expect(200)).body,
    ).data.items[0].id;

    const po = poSchema.parse(
      (
        await post(`/api/purchase-orders/${poId}/receive`, ownerToken, {
          items: [{ itemId, qtyReceived: 1 }],
        }).expect(201)
      ).body,
    ).data;
    expect(po.status).toBe('received');
    expect(po.items[0].qtyReceived).toBe('2.000');

    // Stock acumulado 0 + 1 + 1 = 2.
    expect(await stockOf(ingredientId)).toBe('2.000');
    // Dos recepciones → dos movimientos purchase.
    expect(await purchaseMovements()).toBe(2);

    // last purchase price: unitCost del insumo pasó de 10 a 12 (precio de la OC).
    const rows = stockListSchema.parse(
      (await get('/api/inventory/stock', ownerToken).expect(200)).body,
    ).data;
    expect(rows.find((r) => r.ingredientId === ingredientId)?.unitCost).toBe(
      '12.00',
    );
  });

  it('HU-05-07: cancelar una OC ya recibida → 409', async () => {
    await post(`/api/purchase-orders/${poId}/cancel`, ownerToken, {}).expect(
      409,
    );
  });

  it('HU-05-07: crear + cancelar una OC en draft → cancelled', async () => {
    const draft = poSchema.parse(
      (
        await post('/api/purchase-orders', ownerToken, {
          supplierId,
          items: [{ ingredientId, qtyOrdered: 5, unitCost: 9 }],
        }).expect(201)
      ).body,
    ).data;
    expect(draft.status).toBe('draft');

    const cancelled = poSchema.parse(
      (
        await post(
          `/api/purchase-orders/${draft.id}/cancel`,
          ownerToken,
          {},
        ).expect(201)
      ).body,
    ).data;
    expect(cancelled.status).toBe('cancelled');

    // Una OC cancelada ya no se puede recepcionar (409 por estado).
    const itemId = cancelled.items[0].id;
    await post(`/api/purchase-orders/${draft.id}/receive`, ownerToken, {
      items: [{ itemId, qtyReceived: 1 }],
    }).expect(409);
  });

  it('HU-05-04: GET /api/purchase-orders lista las OCs (desc) con total', async () => {
    const listSchema = apiResponseSchema(
      z.array(
        z.object({
          id: z.uuid(),
          status: z.string(),
          total: z.string(),
        }),
      ),
    );
    const list = listSchema.parse(
      (await get('/api/purchase-orders', ownerToken).expect(200)).body,
    ).data;
    // La recibida + la cancelada.
    expect(list.length).toBe(2);
    expect(list.some((p) => p.status === 'received')).toBe(true);
    expect(list.some((p) => p.status === 'cancelled')).toBe(true);
  });

  it('RBAC: el staff NO puede crear una OC → 403, pero SÍ puede leerlas', async () => {
    await post('/api/purchase-orders', staffToken, {
      supplierId,
      items: [{ ingredientId, qtyOrdered: 1, unitCost: 5 }],
    }).expect(403);

    await get('/api/purchase-orders', staffToken).expect(200);
  });
});
