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

describe('Config del local — HU-01-10 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);
  const settingsSchema = apiResponseSchema(
    z.object({
      ruc: z.string().nullable(),
      currency: z.string(),
      igvRate: z.number(),
      capacity: z.number().nullable(),
      legalName: z.string().nullable(),
      fiscalAddress: z.string().nullable(),
      businessHours: z.unknown(),
    }),
  );
  let ownerToken = '';
  let managerToken = '';
  let staffToken = '';

  const login = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    return tokensSchema.parse(res.body).data.accessToken;
  };

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe(
      'TRUNCATE TABLE "refresh_tokens", "users", "tenants" CASCADE',
    );
    const tenant = await admin.tenant.create({ data: { name: 'Motif' } });
    const passwordHash = await hash(password, 4);
    for (const [email, role] of [
      ['owner@cfg.pe', 'owner'],
      ['manager@cfg.pe', 'manager'],
      ['staff@cfg.pe', 'staff'],
    ] as const) {
      await admin.user.create({
        data: {
          tenantId: tenant.id,
          email,
          name: role,
          passwordHash,
          roles: [role],
        },
      });
    }
    const mf = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mf.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    ownerToken = await login('owner@cfg.pe');
    managerToken = await login('manager@cfg.pe');
    staffToken = await login('staff@cfg.pe');
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(
      'TRUNCATE TABLE "refresh_tokens", "users", "tenants" CASCADE',
    );
    await admin.$disconnect();
    await app.close();
  });

  const get = (token: string) =>
    request(app.getHttpServer())
      .get('/api/tenants/settings')
      .set('Authorization', `Bearer ${token}`);
  const patch = (token: string, body: unknown) =>
    request(app.getHttpServer())
      .patch('/api/tenants/settings')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  it('owner GET settings → 200 con defaults (PEN, IGV 0.18)', async () => {
    const res = await get(ownerToken).expect(200);
    const body = settingsSchema.parse(res.body);
    expect(body.data.currency).toBe('PEN');
    expect(body.data.igvRate).toBeCloseTo(0.18);
  });

  it('owner PATCH settings → 200 aplica RUC/aforo/horarios', async () => {
    const res = await patch(ownerToken, {
      ruc: '20512345678',
      capacity: 40,
      businessHours: [{ day: 1, open: '09:00', close: '23:00' }],
    }).expect(200);
    const body = settingsSchema.parse(res.body);
    expect(body.data.ruc).toBe('20512345678');
    expect(body.data.capacity).toBe(40);
  });

  it('manager GET → 200 (lectura), pero PATCH → 403 (sin escritura en settings)', async () => {
    await get(managerToken).expect(200);
    await patch(managerToken, { capacity: 99 }).expect(403);
  });

  it('staff GET settings → 403', async () => {
    await get(staffToken).expect(403);
  });

  it('owner PATCH con RUC inválido → 400', async () => {
    await patch(ownerToken, { ruc: '123' }).expect(400);
  });

  it('GET settings sin token → 401', async () => {
    await request(app.getHttpServer()).get('/api/tenants/settings').expect(401);
  });
});
