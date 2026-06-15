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
  'TRUNCATE TABLE "menu_modifiers","menu_availability","menu_items","menu_categories","recipe_versions","recipe_items","recipes","product_suppliers","suppliers","ingredients","categories","units_of_measure","audit_logs","refresh_tokens","users","tenants" CASCADE';

describe('Catálogo — modificadores y disponibilidad HU-02-11/13 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);
  const idSchema = apiResponseSchema(z.object({ id: z.uuid() }));
  const modifierSchema = apiResponseSchema(
    z.object({
      id: z.uuid(),
      priceDelta: z.string(),
      required: z.boolean(),
    }),
  );
  const modifierListSchema = apiResponseSchema(
    z.array(z.object({ id: z.uuid(), priceDelta: z.string() })),
  );
  const windowSchema = apiResponseSchema(
    z.object({
      id: z.uuid(),
      dayOfWeek: z.number().nullable(),
      startMinute: z.number(),
      endMinute: z.number(),
    }),
  );
  const checkSchema = apiResponseSchema(
    z.object({
      available: z.boolean(),
      dayOfWeek: z.number(),
      minuteOfDay: z.number(),
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
  const get = (path: string, token: string) =>
    request(app.getHttpServer()).get(path).set(bearer(token));

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe(TRUNCATE);
    const tenant = await admin.tenant.create({ data: { name: 'Motif' } });
    const passwordHash = await hash(password, 4);
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'owner@mod.pe',
        name: 'O',
        passwordHash,
        roles: ['owner'],
      },
    });
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'staff@mod.pe',
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
    ownerToken = await login('owner@mod.pe');
    staffToken = await login('staff@mod.pe');
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(TRUNCATE);
    await admin.$disconnect();
    await app.close();
  });

  let itemId = '';

  it('prepara receta + plato', async () => {
    const ingId = idSchema.parse(
      (
        await post('/api/ingredients', ownerToken, {
          sku: 'QUE',
          name: 'Queso',
          type: 'raw',
          unit: 'kg',
          unitCost: 20,
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
    itemId = idSchema.parse(
      (
        await post('/api/menu/items', ownerToken, {
          recipeId,
          name: 'Pizza Margarita',
          price: 50,
        }).expect(201)
      ).body,
    ).data.id;
  });

  it('HU-02-11: agrega modificador con price_delta y lo lista', async () => {
    const mod = modifierSchema.parse(
      (
        await post(`/api/menu/items/${itemId}/modifiers`, ownerToken, {
          name: 'Extra queso',
          priceDelta: 5,
          required: false,
        }).expect(201)
      ).body,
    ).data;
    expect(mod.priceDelta).toBe('5.00');
    expect(mod.required).toBe(false);

    const list = modifierListSchema.parse(
      (await get(`/api/menu/items/${itemId}/modifiers`, ownerToken).expect(200))
        .body,
    ).data;
    expect(list).toHaveLength(1);
    expect(list[0].priceDelta).toBe('5.00');
  });

  it('HU-02-11: modificador obligatorio (required) y delta negativo', async () => {
    const mod = modifierSchema.parse(
      (
        await post(`/api/menu/items/${itemId}/modifiers`, ownerToken, {
          name: 'Sin queso',
          priceDelta: -3,
          required: true,
        }).expect(201)
      ).body,
    ).data;
    expect(mod.priceDelta).toBe('-3.00');
    expect(mod.required).toBe(true);
  });

  it('HU-02-11: staff no agrega modificadores → 403', async () => {
    await post(`/api/menu/items/${itemId}/modifiers`, staffToken, {
      name: 'X',
    }).expect(403);
  });

  it('HU-02-13: sin ventanas el plato está disponible siempre', async () => {
    const res = checkSchema.parse(
      (
        await get(
          `/api/menu/items/${itemId}/availability/check?at=2026-06-15T18:00:00Z`,
          ownerToken,
        ).expect(200)
      ).body,
    ).data;
    expect(res.available).toBe(true);
  });

  it('HU-02-13: ventana de almuerzo (12:00–15:00, hora Lima) filtra por horario', async () => {
    const win = windowSchema.parse(
      (
        await post(`/api/menu/items/${itemId}/availability`, ownerToken, {
          dayOfWeek: null,
          startMinute: 12 * 60,
          endMinute: 15 * 60,
        }).expect(201)
      ).body,
    ).data;
    expect(win.startMinute).toBe(720);

    // 18:00Z = 13:00 Lima → dentro de la ventana.
    const inside = checkSchema.parse(
      (
        await get(
          `/api/menu/items/${itemId}/availability/check?at=2026-06-15T18:00:00Z`,
          ownerToken,
        ).expect(200)
      ).body,
    ).data;
    expect(inside.minuteOfDay).toBe(13 * 60);
    expect(inside.available).toBe(true);

    // 21:00Z = 16:00 Lima → fuera de la ventana.
    const outside = checkSchema.parse(
      (
        await get(
          `/api/menu/items/${itemId}/availability/check?at=2026-06-15T21:00:00Z`,
          ownerToken,
        ).expect(200)
      ).body,
    ).data;
    expect(outside.minuteOfDay).toBe(16 * 60);
    expect(outside.available).toBe(false);
  });
});
