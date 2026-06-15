import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AppModule } from './../src/app.module';
import { apiResponseSchema, authTokensSchema } from './../src/shared';

const adminUrl = process.env.DATABASE_URL_ADMIN;
if (!adminUrl) {
  throw new Error('DATABASE_URL_ADMIN no está definido (ver .env)');
}

describe('Auth — register/login/me (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const creds = {
    name: 'Maria Quispe',
    email: 'maria@motif.pe',
    password: 'MotifDemo2026',
    restaurantName: 'Motif Restobar',
  };
  const tokensSchema = apiResponseSchema(authTokensSchema);
  let accessToken = '';

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe('TRUNCATE TABLE "users", "tenants" CASCADE');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe('TRUNCATE TABLE "users", "tenants" CASCADE');
    await admin.$disconnect();
    await app.close();
  });

  it('POST /api/auth/register → 201 + tokens', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(creds)
      .expect(201);
    const body = tokensSchema.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.accessToken.length).toBeGreaterThan(0);
    accessToken = body.data.accessToken;
  });

  it('GET /api/auth/me con token → usuario (cierra JWT→RLS)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const meSchema = apiResponseSchema(
      z.object({
        id: z.uuid(),
        email: z.string(),
        name: z.string(),
        roles: z.array(z.string()),
      }),
    );
    const body = meSchema.parse(res.body);
    expect(body.data.email).toBe('maria@motif.pe');
    expect(body.data.roles).toContain('owner');
  });

  it('GET /api/auth/me sin token → 401', async () => {
    await request(app.getHttpServer()).get('/api/auth/me').expect(401);
  });

  it('POST /api/auth/login correcto → 200 + tokens', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: creds.email, password: creds.password })
      .expect(200);
    const body = tokensSchema.parse(res.body);
    expect(body.data.accessToken.length).toBeGreaterThan(0);
  });

  it('POST /api/auth/login con password incorrecto → 401', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: creds.email, password: 'mala' })
      .expect(401);
  });

  it('POST /api/auth/register con body inválido → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'no-es-email', password: '1' })
      .expect(400);
  });

  it('POST /api/auth/register con email duplicado → 409', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(creds)
      .expect(409);
  });
});
