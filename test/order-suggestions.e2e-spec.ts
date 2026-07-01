/**
 * E2e spec — HU-03-13: Sugerencias de upsell en una orden.
 * Cubre: top platos no presentes en la orden, exclusión de platos ya en la
 * orden, exclusión de platos inactivos, 404 para orden inexistente, 401 sin token.
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
  'TRUNCATE TABLE "order_items","orders","dining_tables","zones","menu_modifiers","menu_availability","menu_items","menu_categories","recipe_items","recipes","audit_logs","refresh_tokens","users","tenants" CASCADE';

describe('Order Suggestions (Upsell) — HU-03-13 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);

  const suggestionsSchema = apiResponseSchema(
    z.array(
      z.object({
        menuItemId: z.uuid(),
        name: z.string(),
        price: z.string(),
        timesSold: z.number(),
      }),
    ),
  );

  let ownerToken = '';
  let tenantId = '';
  let orderId = '';
  let lomoId = '';
  let ceviId = '';

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

    const owner = await admin.user.create({
      data: {
        tenantId,
        email: 'owner@upsell.pe',
        name: 'O',
        passwordHash: ph,
        roles: ['owner'],
      },
    });

    // Platos del menú: Lomo, Ceviche (más popular) y Pisco Sour (inactivo).
    const recLomo = await admin.recipe.create({
      data: { tenantId, name: 'Lomo Saltado', kind: 'dish' },
    });
    const recCevi = await admin.recipe.create({
      data: { tenantId, name: 'Ceviche', kind: 'dish' },
    });
    const recPisco = await admin.recipe.create({
      data: { tenantId, name: 'Pisco Sour', kind: 'dish' },
    });

    const lomo = await admin.menuItem.create({
      data: {
        tenantId,
        recipeId: recLomo.id,
        name: 'Lomo Saltado',
        price: 48,
        isActive: true,
      },
    });
    lomoId = lomo.id;

    const cevi = await admin.menuItem.create({
      data: {
        tenantId,
        recipeId: recCevi.id,
        name: 'Ceviche Clásico',
        price: 42,
        isActive: true,
      },
    });
    ceviId = cevi.id;

    // Pisco Sour: inactivo, no debe aparecer como sugerencia.
    await admin.menuItem.create({
      data: {
        tenantId,
        recipeId: recPisco.id,
        name: 'Pisco Sour',
        price: 24,
        isActive: false,
      },
    });

    // Zona y mesa para poder crear la orden.
    const zone = await admin.zone.create({
      data: { tenantId, name: 'Salón', position: 0 },
    });
    const table = await admin.diningTable.create({
      data: {
        tenantId,
        zoneId: zone.id,
        code: 'S1',
        capacity: 4,
        status: 'free',
      },
    });

    // Crear orden con solo "Lomo Saltado" en ella.
    const order = await admin.order.create({
      data: {
        tenantId,
        tableId: table.id,
        waiterId: owner.id,
        guests: 2,
        status: 'open',
        openedAt: new Date(),
      },
    });
    orderId = order.id;

    await admin.orderItem.create({
      data: {
        tenantId,
        orderId: order.id,
        menuItemId: lomo.id,
        name: 'Lomo Saltado',
        qty: 1,
        unitPrice: new Prisma.Decimal('48'),
        status: 'pending',
      },
    });

    // Historial de ventas de los últimos 30 días: Ceviche es el más vendido (50 uds)
    // y Lomo también tiene ventas (20 uds).
    const now = new Date();
    for (let d = 1; d <= 5; d++) {
      const createdAt = new Date(now.getTime() - d * 24 * 60 * 60 * 1000);
      const pastOrder = await admin.order.create({
        data: {
          tenantId,
          tableId: table.id,
          waiterId: owner.id,
          guests: 2,
          status: 'paid',
          openedAt: createdAt,
          createdAt,
        },
      });
      // 10 Ceviche/día
      await admin.orderItem.create({
        data: {
          tenantId,
          orderId: pastOrder.id,
          menuItemId: cevi.id,
          name: 'Ceviche Clásico',
          qty: 10,
          unitPrice: new Prisma.Decimal('42'),
          status: 'served',
          createdAt,
        },
      });
      // 4 Lomo/día
      await admin.orderItem.create({
        data: {
          tenantId,
          orderId: pastOrder.id,
          menuItemId: lomo.id,
          name: 'Lomo Saltado',
          qty: 4,
          unitPrice: new Prisma.Decimal('48'),
          status: 'served',
          createdAt,
        },
      });
    }

    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication(new FastifyAdapter());
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    ownerToken = await login('owner@upsell.pe');
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(TRUNCATE);
    await admin.$disconnect();
    await app.close();
  });

  it('devuelve platos populares no presentes en la orden', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/orders/${orderId}/suggestions?limit=3`)
      .set(bearer(ownerToken))
      .expect(200);

    const body = suggestionsSchema.parse(res.body);
    // Ceviche: popular y NO está en la orden → debe aparecer.
    const cevi = body.data.find((s) => s.name === 'Ceviche Clásico');
    expect(cevi).toBeDefined();
    expect(cevi!.timesSold).toBeGreaterThan(0);
  });

  it('no incluye platos ya presentes en la orden', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/orders/${orderId}/suggestions?limit=3`)
      .set(bearer(ownerToken))
      .expect(200);

    const body = suggestionsSchema.parse(res.body);
    // Lomo Saltado ya está en la orden → NO debe aparecer.
    const lomo = body.data.find((s) => s.menuItemId === lomoId);
    expect(lomo).toBeUndefined();
  });

  it('no incluye platos inactivos', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/orders/${orderId}/suggestions?limit=10`)
      .set(bearer(ownerToken))
      .expect(200);

    const body = suggestionsSchema.parse(res.body);
    const pisco = body.data.find((s) => s.name === 'Pisco Sour');
    expect(pisco).toBeUndefined();
  });

  it('404 cuando la orden no existe', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000003';
    await request(app.getHttpServer())
      .get(`/api/orders/${fakeId}/suggestions`)
      .set(bearer(ownerToken))
      .expect(404);
  });

  it('sin token: recibe 401', async () => {
    await request(app.getHttpServer())
      .get(`/api/orders/${orderId}/suggestions`)
      .expect(401);
  });

  it('Ceviche tiene más timesSold que otros platos (ranking real)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/orders/${orderId}/suggestions?limit=5`)
      .set(bearer(ownerToken))
      .expect(200);

    const body = suggestionsSchema.parse(res.body);
    const cevi = body.data.find((s) => s.menuItemId === ceviId);
    // Ceviche: 5 días × 10 uds/día = 50 uds
    expect(cevi?.timesSold).toBe(50);
  });
});
