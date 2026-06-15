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

describe('Cambio de contraseña — HU-01-06 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const tokensSchema = apiResponseSchema(authTokensSchema);

  async function register(
    email: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
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
  const changePassword = (token: string, body: unknown) =>
    request(app.getHttpServer())
      .patch('/api/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const login = (email: string, password: string) =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password });

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe(
      'TRUNCATE TABLE "audit_logs", "refresh_tokens", "users", "tenants" CASCADE',
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
      'TRUNCATE TABLE "audit_logs", "refresh_tokens", "users", "tenants" CASCADE',
    );
    await admin.$disconnect();
    await app.close();
  });

  it('cambia la contraseña, revoca sesiones, y solo la nueva sirve', async () => {
    const reg = await register('chg@demo.pe');
    await changePassword(reg.accessToken, {
      currentPassword: 'Secret12345',
      newPassword: 'NuevaClave123!',
    }).expect(200);

    // los refresh tokens previos quedan revocados
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: reg.refreshToken })
      .expect(401);
    // la nueva contraseña sirve; la vieja no
    await login('chg@demo.pe', 'NuevaClave123!').expect(200);
    await login('chg@demo.pe', 'Secret12345').expect(401);
  });

  it('rechaza una contraseña nueva débil → 400', async () => {
    const reg = await register('chg2@demo.pe');
    await changePassword(reg.accessToken, {
      currentPassword: 'Secret12345',
      newPassword: 'corta',
    }).expect(400);
  });

  it('rechaza si la contraseña actual es incorrecta → 401', async () => {
    const reg = await register('chg3@demo.pe');
    await changePassword(reg.accessToken, {
      currentPassword: 'incorrecta',
      newPassword: 'OtraClave123!',
    }).expect(401);
  });

  it('sin token → 401', async () => {
    await request(app.getHttpServer())
      .patch('/api/auth/password')
      .send({ currentPassword: 'x', newPassword: 'OtraClave123!' })
      .expect(401);
  });
});
