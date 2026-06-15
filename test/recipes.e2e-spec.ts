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
  'TRUNCATE TABLE "recipe_versions","recipe_items","recipes","product_suppliers","suppliers","ingredients","categories","units_of_measure","audit_logs","refresh_tokens","users","tenants" CASCADE';

describe('Catálogo — recetas/BOM HU-02-07/08/09 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);
  const idSchema = apiResponseSchema(z.object({ id: z.uuid() }));
  const recipeSchema = apiResponseSchema(
    z.object({ id: z.uuid(), totalCost: z.string(), version: z.number() }),
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

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe(TRUNCATE);
    const tenant = await admin.tenant.create({ data: { name: 'Motif' } });
    const passwordHash = await hash(password, 4);
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'owner@rec.pe',
        name: 'O',
        passwordHash,
        roles: ['owner'],
      },
    });
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'staff@rec.pe',
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
    ownerToken = await login('owner@rec.pe');
    staffToken = await login('staff@rec.pe');
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(TRUNCATE);
    await admin.$disconnect();
    await app.close();
  });

  let carneId = '';
  let cebollaId = '';
  let aderezoId = '';
  let lomoId = '';

  it('HU-02-07/08: costo recursivo = ingrediente + sub-receta', async () => {
    carneId = idSchema.parse(
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
    cebollaId = idSchema.parse(
      (
        await post('/api/ingredients', ownerToken, {
          sku: 'CEB',
          name: 'Cebolla',
          type: 'raw',
          unit: 'kg',
          unitCost: 5,
        }).expect(201)
      ).body,
    ).data.id;

    // sub-receta Aderezo: 2 × cebolla(5) = 10.00
    const aderezo = recipeSchema.parse(
      (
        await post('/api/recipes', ownerToken, {
          name: 'Aderezo',
          kind: 'sub_recipe',
          yield: 1,
          items: [{ ingredientId: cebollaId, qty: 2 }],
        }).expect(201)
      ).body,
    ).data;
    expect(aderezo.totalCost).toBe('10.00');
    aderezoId = aderezo.id;

    // plato Lomo: carne(30) + aderezo(10/yield 1) = 40.00
    const lomo = recipeSchema.parse(
      (
        await post('/api/recipes', ownerToken, {
          name: 'Lomo saltado',
          kind: 'dish',
          yield: 1,
          items: [
            { ingredientId: carneId, qty: 1 },
            { subRecipeId: aderezoId, qty: 1 },
          ],
        }).expect(201)
      ).body,
    ).data;
    expect(lomo.totalCost).toBe('40.00');
    lomoId = lomo.id;
  });

  it('HU-02-08: ciclo de sub-recetas rechazado → 400', async () => {
    await request(app.getHttpServer())
      .patch(`/api/recipes/${aderezoId}`)
      .set(bearer(ownerToken))
      .send({
        items: [
          { ingredientId: cebollaId, qty: 2 },
          { subRecipeId: lomoId, qty: 1 },
        ],
      })
      .expect(400);
  });

  it('HU-02-09: editar items incrementa la versión y recalcula el costo', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/recipes/${lomoId}`)
      .set(bearer(ownerToken))
      .send({
        items: [
          { ingredientId: carneId, qty: 2 },
          { subRecipeId: aderezoId, qty: 1 },
        ],
      })
      .expect(200);
    const lomo = recipeSchema.parse(res.body).data;
    expect(lomo.version).toBe(2);
    expect(lomo.totalCost).toBe('70.00'); // 2×30 + 10
    // se creó un snapshot de versión
    const versions = await admin.recipeVersion.count({
      where: { recipeId: lomoId },
    });
    expect(versions).toBeGreaterThanOrEqual(2);
  });

  it('staff no crea recetas → 403', async () => {
    await post('/api/recipes', staffToken, {
      name: 'X',
      items: [{ ingredientId: carneId, qty: 1 }],
    }).expect(403);
  });
});
