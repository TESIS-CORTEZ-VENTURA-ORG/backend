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
  'TRUNCATE TABLE "sales_history","menu_items","recipes","audit_logs","refresh_tokens","users","tenants" CASCADE';

// Mediodía local (Lima, UTC-5) para evitar cruces de día por el offset.
const at = (day: string): Date => new Date(`${day}T12:00:00-05:00`);

describe('Forecasting — serie de demanda agregada HU-08-02 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);

  const seriesSchema = apiResponseSchema(
    z.object({
      scope: z.enum(['total', 'menuItem']),
      seriesId: z.string(),
      label: z.string(),
      frequency: z.literal('D'),
      observations: z.number(),
      spanDays: z.number(),
      dataQuality: z.enum(['insufficient', 'few_shot', 'good']),
      points: z.array(z.object({ ds: z.string(), y: z.number() })),
    }),
  );

  let ownerToken = '';
  let staffToken = '';
  let lomoId = '';

  const login = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    return tokensSchema.parse(res.body).data.accessToken;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const getSeries = (token: string, query = '') =>
    request(app.getHttpServer())
      .get(`/api/forecasting/series${query}`)
      .set(bearer(token));

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe(TRUNCATE);

    // --- Tenant A (Motif): owner + staff + histórico de ventas ---
    const a = await admin.tenant.create({ data: { name: 'Motif' } });
    const passwordHash = await hash(password, 4);
    await admin.user.create({
      data: {
        tenantId: a.id,
        email: 'owner@fc.pe',
        name: 'O',
        passwordHash,
        roles: ['owner'],
      },
    });
    await admin.user.create({
      data: {
        tenantId: a.id,
        email: 'staff@fc.pe',
        name: 'S',
        passwordHash,
        roles: ['staff'],
      },
    });
    const recipe = await admin.recipe.create({
      data: { tenantId: a.id, name: 'Lomo Saltado', kind: 'dish' },
    });
    const lomo = await admin.menuItem.create({
      data: {
        tenantId: a.id,
        recipeId: recipe.id,
        name: 'Lomo Saltado',
        price: 30,
        isActive: true,
      },
    });
    lomoId = lomo.id;

    // Lomo: 01-01 (3+2) y 01-04 (4); hueco en 01-02 y 01-03 para el menuItem.
    // "Fantasma" (sin enlace): 01-02 (5). Total diario: 01-01=5, 01-02=5, 01-03=0, 01-04=4.
    await admin.salesHistory.createMany({
      data: [
        {
          tenantId: a.id,
          soldOn: at('2024-01-01'),
          dishName: 'Lomo Saltado',
          menuItemId: lomoId,
          qty: 3,
          unitPrice: 30,
          total: 90,
        },
        {
          tenantId: a.id,
          soldOn: at('2024-01-01'),
          dishName: 'Lomo Saltado',
          menuItemId: lomoId,
          qty: 2,
          unitPrice: 30,
          total: 60,
        },
        {
          tenantId: a.id,
          soldOn: at('2024-01-02'),
          dishName: 'Plato Fantasma',
          menuItemId: null,
          qty: 5,
          unitPrice: 10,
          total: 50,
        },
        {
          tenantId: a.id,
          soldOn: at('2024-01-04'),
          dishName: 'Lomo Saltado',
          menuItemId: lomoId,
          qty: 4,
          unitPrice: 30,
          total: 120,
        },
      ],
    });

    // --- Tenant B: histórico que NO debe filtrarse a A (aislamiento RLS) ---
    const b = await admin.tenant.create({ data: { name: 'Otro' } });
    await admin.salesHistory.create({
      data: {
        tenantId: b.id,
        soldOn: at('2024-01-01'),
        dishName: 'Ajeno',
        menuItemId: null,
        qty: 999,
        unitPrice: 1,
        total: 999,
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
    ownerToken = await login('owner@fc.pe');
    staffToken = await login('staff@fc.pe');
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(TRUNCATE);
    await admin.$disconnect();
    await app.close();
  });

  it('total: agrega por día con zero-fill del día sin ventas', async () => {
    const data = seriesSchema.parse(
      (await getSeries(ownerToken).expect(200)).body,
    ).data;
    expect(data.scope).toBe('total');
    expect(data.points).toEqual([
      { ds: '2024-01-01', y: 5 },
      { ds: '2024-01-02', y: 5 },
      { ds: '2024-01-03', y: 0 }, // zero-fill
      { ds: '2024-01-04', y: 4 },
    ]);
    expect(data.observations).toBe(3);
    expect(data.spanDays).toBe(4);
    expect(data.dataQuality).toBe('insufficient');
  });

  it('aislamiento RLS: el total de A NO incluye las ventas de B (999)', async () => {
    const data = seriesSchema.parse(
      (await getSeries(ownerToken).expect(200)).body,
    ).data;
    const sum = data.points.reduce((s, p) => s + p.y, 0);
    expect(sum).toBe(14); // 5+5+0+4 — sin el 999 de tenant B
  });

  it('por plato: filtra por menuItemId y excluye filas sin enlace', async () => {
    const data = seriesSchema.parse(
      (
        await getSeries(
          ownerToken,
          `?scope=menuItem&menuItemId=${lomoId}`,
        ).expect(200)
      ).body,
    ).data;
    expect(data.seriesId).toBe(lomoId);
    expect(data.label).toBe('Lomo Saltado');
    expect(data.points).toEqual([
      { ds: '2024-01-01', y: 5 },
      { ds: '2024-01-02', y: 0 },
      { ds: '2024-01-03', y: 0 },
      { ds: '2024-01-04', y: 4 },
    ]);
    expect(data.observations).toBe(2);
  });

  it('scope=menuItem sin menuItemId → 400', async () => {
    await getSeries(ownerToken, '?scope=menuItem').expect(400);
  });

  it('staff NO puede leer la serie → 403 (read Report)', async () => {
    await getSeries(staffToken).expect(403);
  });
});
