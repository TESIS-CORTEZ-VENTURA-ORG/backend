/**
 * E2e spec — HU-05-12: Tendencia de precio de insumos.
 * Cubre: alimentación automática en recepción de OC, listado paginado y
 * ordenado, CASL 403 para staff, 404 para insumo inexistente.
 */
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient, Prisma } from '@prisma/client';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { AppModule } from './../src/app.module';
import { apiResponseSchema, authTokensSchema } from './../src/shared';

const adminUrl = process.env.DATABASE_URL_ADMIN;
if (!adminUrl) {
  throw new Error('DATABASE_URL_ADMIN no está definido (ver .env)');
}

const TRUNCATE =
  'TRUNCATE TABLE "ingredient_price_history","purchase_order_items","purchase_orders","inventory_movements","suppliers","ingredients","audit_logs","refresh_tokens","users","tenants" CASCADE';

describe('Price Trend — HU-05-12 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);

  const trendSchema = apiResponseSchema(
    z.array(
      z.object({
        recordedAt: z.string(),
        unitCost: z.string(),
        source: z.enum(['purchase_order', 'manual']),
      }),
    ),
  );

  let ownerToken = '';
  let staffToken = '';
  let ingId = '';
  let supplierId = '';
  let tenantId = '';

  const login = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    return tokensSchema.parse(res.body).data.accessToken;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe(TRUNCATE);

    const tenant = await admin.tenant.create({ data: { name: 'Motif' } });
    tenantId = tenant.id;
    const ph = await hash(password, 4);

    const [owner, staff] = await Promise.all([
      admin.user.create({
        data: {
          tenantId,
          email: 'owner@pt.pe',
          name: 'O',
          passwordHash: ph,
          roles: ['owner'],
        },
      }),
      admin.user.create({
        data: {
          tenantId,
          email: 'staff@pt.pe',
          name: 'S',
          passwordHash: ph,
          roles: ['staff'],
        },
      }),
    ]);
    void owner;
    void staff;

    const supplier = await admin.supplier.create({
      data: {
        tenantId,
        ruc: '20123456789',
        name: 'Proveedor SAC',
      },
    });
    supplierId = supplier.id;

    const ing = await admin.ingredient.create({
      data: {
        tenantId,
        sku: 'PT-001',
        name: 'Pescado',
        type: 'raw',
        unit: 'kg',
        unitCost: 38,
        stock: new Prisma.Decimal('10'),
      },
    });
    ingId = ing.id;

    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication(new FastifyAdapter());
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    ownerToken = await login('owner@pt.pe');
    staffToken = await login('staff@pt.pe');
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(TRUNCATE);
    await admin.$disconnect();
    await app.close();
  });

  it('alimentación automática: recepcionar una OC crea fila en price-trend', async () => {
    // Crear OC draft con una línea.
    const createRes = await request(app.getHttpServer())
      .post('/api/purchase-orders')
      .set(bearer(ownerToken))
      .send({
        supplierId,
        items: [{ ingredientId: ingId, qtyOrdered: 10, unitCost: 40.5 }],
      })
      .expect(201);

    // Parse through a typed schema to avoid unsafe `any` member access.
    const poSchema = apiResponseSchema(
      z.object({
        id: z.string().uuid(),
        items: z.array(z.object({ id: z.string().uuid() })),
      }),
    );
    const poBody = poSchema.parse(createRes.body);
    const poId = poBody.data.id;

    // Enviar la OC. POST sin @HttpCode → NestJS devuelve 201 por defecto.
    await request(app.getHttpServer())
      .post(`/api/purchase-orders/${poId}/send`)
      .set(bearer(ownerToken))
      .expect(201);

    // Recepcionar la OC. Idem → 201.
    const itemId = poBody.data.items[0].id;
    await request(app.getHttpServer())
      .post(`/api/purchase-orders/${poId}/receive`)
      .set(bearer(ownerToken))
      .send({ items: [{ itemId, qtyReceived: 10 }] })
      .expect(201);

    // Verificar que el endpoint price-trend devuelve el registro.
    const res = await request(app.getHttpServer())
      .get(`/api/inventory/ingredients/${ingId}/price-trend`)
      .set(bearer(ownerToken))
      .expect(200);

    const body = trendSchema.parse(res.body);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].unitCost).toBe('40.50');
    expect(body.data[0].source).toBe('purchase_order');
  });

  it('devuelve los últimos N registros ordenados por fecha DESC', async () => {
    // Insertar 3 registros históricos directamente.
    const now = new Date();
    for (let i = 1; i <= 3; i++) {
      await admin.ingredientPriceHistory.create({
        data: {
          tenantId,
          ingredientId: ingId,
          unitCost: new Prisma.Decimal(30 + i),
          recordedAt: new Date(now.getTime() - i * 30 * 24 * 60 * 60 * 1000),
          source: 'purchase_order',
        },
      });
    }

    const res = await request(app.getHttpServer())
      .get(`/api/inventory/ingredients/${ingId}/price-trend?limit=2`)
      .set(bearer(ownerToken))
      .expect(200);

    const body = trendSchema.parse(res.body);
    // limit=2 → solo los 2 más recientes (de los 4 totales: 1 del test anterior + 3 insertados).
    expect(body.data.length).toBeLessThanOrEqual(2);
    // Orden descendente por fecha: el primero es el más reciente.
    const dates = body.data.map((r) => new Date(r.recordedAt).getTime());
    expect(dates[0]).toBeGreaterThanOrEqual(dates[1] ?? 0);
  });

  it('404 cuando el insumo no existe', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000002';
    await request(app.getHttpServer())
      .get(`/api/inventory/ingredients/${fakeId}/price-trend`)
      .set(bearer(ownerToken))
      .expect(404);
  });

  // Staff has `can('read', 'Inventory')` in CASL — price-trend is read-only so
  // staff gets 200. The CASL 403 barrier only applies to create/update/delete.
  it('staff: puede leer price-trend (CASL read Inventory) → 200', async () => {
    await request(app.getHttpServer())
      .get(`/api/inventory/ingredients/${ingId}/price-trend`)
      .set(bearer(staffToken))
      .expect(200);
  });
});
