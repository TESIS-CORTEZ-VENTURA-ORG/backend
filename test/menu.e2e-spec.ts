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
  'TRUNCATE TABLE "menu_items","menu_categories","recipe_versions","recipe_items","recipes","product_suppliers","suppliers","ingredients","categories","units_of_measure","audit_logs","refresh_tokens","users","tenants" CASCADE';

describe('Catálogo — menú HU-02-10/12 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);
  const idSchema = apiResponseSchema(z.object({ id: z.uuid() }));
  const categorySchema = apiResponseSchema(
    z.object({
      id: z.uuid(),
      name: z.string(),
      position: z.number(),
      isActive: z.boolean(),
    }),
  );
  const categoryListSchema = apiResponseSchema(
    z.array(z.object({ id: z.uuid(), position: z.number() })),
  );
  const itemSchema = apiResponseSchema(
    z.object({
      id: z.uuid(),
      menuCategoryId: z.string().nullable(),
      price: z.string(),
      unitCost: z.string(),
      marginPct: z.string(),
      lowMargin: z.boolean(),
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
  const patch = (path: string, token: string, body: unknown) =>
    request(app.getHttpServer()).patch(path).set(bearer(token)).send(body);

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe(TRUNCATE);
    const tenant = await admin.tenant.create({ data: { name: 'Motif' } });
    const passwordHash = await hash(password, 4);
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'owner@menu.pe',
        name: 'O',
        passwordHash,
        roles: ['owner'],
      },
    });
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'staff@menu.pe',
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
    ownerToken = await login('owner@menu.pe');
    staffToken = await login('staff@menu.pe');
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(TRUNCATE);
    await admin.$disconnect();
    await app.close();
  });

  let recipeId = '';
  let catId = '';

  it('prepara una receta (Lomo, costo 30.00) para el menú', async () => {
    const carneId = idSchema.parse(
      (
        await post('/api/ingredients', ownerToken, {
          sku: 'CAR',
          name: 'Carne',
          type: 'raw',
          unit: 'kg',
          unitCost: 30,
        }).expect(201)
      ).body,
    ).data.id;
    recipeId = idSchema.parse(
      (
        await post('/api/recipes', ownerToken, {
          name: 'Lomo',
          kind: 'dish',
          yield: 1,
          items: [{ ingredientId: carneId, qty: 1 }],
        }).expect(201)
      ).body,
    ).data.id;
  });

  it('HU-02-12: crea categoría de menú', async () => {
    const cat = categorySchema.parse(
      (
        await post('/api/menu/categories', ownerToken, {
          name: 'Principales',
          position: 1,
        }).expect(201)
      ).body,
    ).data;
    expect(cat.name).toBe('Principales');
    expect(cat.isActive).toBe(true);
    catId = cat.id;
  });

  it('HU-02-10: crea plato con margen unitario sano (precio 100, costo 30 → 70%)', async () => {
    const item = itemSchema.parse(
      (
        await post('/api/menu/items', ownerToken, {
          recipeId,
          menuCategoryId: catId,
          name: 'Lomo saltado',
          price: 100,
        }).expect(201)
      ).body,
    ).data;
    expect(item.unitCost).toBe('30.00');
    expect(item.marginPct).toBe('70.00');
    expect(item.lowMargin).toBe(false);
    expect(item.menuCategoryId).toBe(catId);
  });

  it('HU-02-10: plato con margen bajo (<25%) levanta la alerta lowMargin', async () => {
    const item = itemSchema.parse(
      (
        await post('/api/menu/items', ownerToken, {
          recipeId,
          name: 'Lomo barato',
          price: 35,
        }).expect(201)
      ).body,
    ).data;
    expect(item.marginPct).toBe('14.29'); // (35-30)/35
    expect(item.lowMargin).toBe(true);
  });

  it('HU-02-12: reordena categorías (drag-and-drop)', async () => {
    const cat2 = categorySchema.parse(
      (
        await post('/api/menu/categories', ownerToken, {
          name: 'Entradas',
          position: 2,
        }).expect(201)
      ).body,
    ).data;
    const list = categoryListSchema.parse(
      (
        await patch('/api/menu/categories/reorder', ownerToken, {
          order: [
            { id: cat2.id, position: 1 },
            { id: catId, position: 2 },
          ],
        }).expect(200)
      ).body,
    ).data;
    const byId = new Map(list.map((c) => [c.id, c.position]));
    expect(byId.get(cat2.id)).toBe(1);
    expect(byId.get(catId)).toBe(2);
  });

  it('no se puede eliminar una receta usada por un plato → 409', async () => {
    await request(app.getHttpServer())
      .delete(`/api/recipes/${recipeId}`)
      .set(bearer(ownerToken))
      .expect(409);
  });

  it('staff no crea platos → 403', async () => {
    await post('/api/menu/items', staffToken, {
      recipeId,
      name: 'X',
      price: 10,
    }).expect(403);
  });
});
