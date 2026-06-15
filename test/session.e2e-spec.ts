import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './../src/app.module';
import { apiResponseSchema, authTokensSchema } from './../src/shared';

const adminUrl = process.env.DATABASE_URL_ADMIN;
if (!adminUrl) {
  throw new Error('DATABASE_URL_ADMIN no está definido (ver .env)');
}

describe('Sesión — refresh/rotación/logout/lockout (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const tokensSchema = apiResponseSchema(authTokensSchema);

  async function register(email: string): Promise<{ refreshToken: string }> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'User',
        email,
        password: 'Secret12345',
        restaurantName: 'Resto',
      })
      .expect(201);
    return tokensSchema.parse(res.body).data;
  }
  const login = (email: string, password: string) =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password });
  const refresh = (refreshToken: string) =>
    request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken });

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe(
      'TRUNCATE TABLE "refresh_tokens", "users", "tenants" CASCADE',
    );
    const mf = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mf.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(
      'TRUNCATE TABLE "refresh_tokens", "users", "tenants" CASCADE',
    );
    await admin.$disconnect();
    await app.close();
  });

  it('HU-01-03 refresh ROTA el token (nuevo par; el rotado vuelve a servir)', async () => {
    const { refreshToken } = await register('sess1@demo.pe');
    const next = tokensSchema.parse(
      (await refresh(refreshToken).expect(200)).body,
    ).data;
    expect(next.accessToken.length).toBeGreaterThan(0);
    expect(next.refreshToken).not.toBe(refreshToken);
    await refresh(next.refreshToken).expect(200);
  });

  it('HU-01-03 REUSO de un refresh revocado → 401 y revoca la familia', async () => {
    const { refreshToken } = await register('sess2@demo.pe');
    const r1 = tokensSchema.parse(
      (await refresh(refreshToken).expect(200)).body,
    ).data;
    await refresh(refreshToken).expect(401); // reuso del original (ya rotado)
    await refresh(r1.refreshToken).expect(401); // la familia quedó revocada
  });

  it('HU-01-08 logout revoca el refresh token', async () => {
    const { refreshToken } = await register('sess3@demo.pe');
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .send({ refreshToken })
      .expect(200);
    await refresh(refreshToken).expect(401);
  });

  it('HU-01-02 lockout: 5 intentos fallidos → bloqueo (aun con password correcto)', async () => {
    await register('lock@demo.pe');
    for (let i = 0; i < 5; i++) {
      await login('lock@demo.pe', 'incorrecta').expect(401);
    }
    await login('lock@demo.pe', 'Secret12345').expect(401);
  });
});
