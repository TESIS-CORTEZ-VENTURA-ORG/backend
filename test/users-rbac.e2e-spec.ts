import { Test, TestingModule } from '@nestjs/testing';
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

describe('Users RBAC — gating por rol (HU-01-04) (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret123!';
  const tokensSchema = apiResponseSchema(authTokensSchema);
  const userViewSchema = z.object({
    id: z.uuid(),
    email: z.string(),
    name: z.string(),
    roles: z.array(z.string()),
  });
  let ownerToken = '';
  let managerToken = '';
  let staffToken = '';
  let staffId = '';

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    return tokensSchema.parse(res.body).data.accessToken;
  }

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe('TRUNCATE TABLE "users", "tenants" CASCADE');
    const tenant = await admin.tenant.create({ data: { name: 'Motif' } });
    const passwordHash = await hash(password, 4);
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'owner@motif.pe',
        name: 'Owner',
        passwordHash,
        roles: ['owner'],
      },
    });
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'manager@motif.pe',
        name: 'Manager',
        passwordHash,
        roles: ['manager'],
      },
    });
    const staff = await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'staff@motif.pe',
        name: 'Staff',
        passwordHash,
        roles: ['staff'],
      },
    });
    staffId = staff.id;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    ownerToken = await login('owner@motif.pe');
    managerToken = await login('manager@motif.pe');
    staffToken = await login('staff@motif.pe');
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe('TRUNCATE TABLE "users", "tenants" CASCADE');
    await admin.$disconnect();
    await app.close();
  });

  it('GET /api/users sin token → 401', async () => {
    await request(app.getHttpServer()).get('/api/users').expect(401);
  });

  it('GET /api/users como staff → 403 (no puede leer User)', async () => {
    await request(app.getHttpServer())
      .get('/api/users')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(403);
  });

  it('GET /api/users como owner → 200 con los 3 usuarios del tenant', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/users')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const body = apiResponseSchema(z.array(userViewSchema)).parse(res.body);
    expect(body.data).toHaveLength(3);
  });

  it('GET /api/users como manager → 200 (lectura amplia)', async () => {
    await request(app.getHttpServer())
      .get('/api/users')
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);
  });

  it('PATCH /api/users/:id/role como manager → 403 (no gestiona usuarios)', async () => {
    await request(app.getHttpServer())
      .patch(`/api/users/${staffId}/role`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ roles: ['manager'] })
      .expect(403);
  });

  it('PATCH /api/users/:id/role como owner → 200 y actualiza el rol', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/users/${staffId}/role`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ roles: ['manager'] })
      .expect(200);
    const body = apiResponseSchema(userViewSchema).parse(res.body);
    expect(body.data.roles).toContain('manager');
  });
});
