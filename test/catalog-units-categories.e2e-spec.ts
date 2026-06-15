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

describe('Catálogo — unidades (02-03) y categorías (02-04) (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);
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

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe(
      'TRUNCATE TABLE "categories", "units_of_measure", "ingredients", "audit_logs", "refresh_tokens", "users", "tenants" CASCADE',
    );
    const tenant = await admin.tenant.create({ data: { name: 'Motif' } });
    const passwordHash = await hash(password, 4);
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'owner@uc.pe',
        name: 'O',
        passwordHash,
        roles: ['owner'],
      },
    });
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'staff@uc.pe',
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
    ownerToken = await login('owner@uc.pe');
    staffToken = await login('staff@uc.pe');
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(
      'TRUNCATE TABLE "categories", "units_of_measure", "ingredients", "audit_logs", "refresh_tokens", "users", "tenants" CASCADE',
    );
    await admin.$disconnect();
    await app.close();
  });

  it('HU-02-03: convierte dentro de la familia y rechaza entre familias', async () => {
    for (const u of [
      { code: 'kg', name: 'Kilogramo', family: 'mass', factorToBase: 1000 },
      { code: 'g', name: 'Gramo', family: 'mass', factorToBase: 1 },
      { code: 'l', name: 'Litro', family: 'volume', factorToBase: 1000 },
    ]) {
      await request(app.getHttpServer())
        .post('/api/units')
        .set(bearer(ownerToken))
        .send(u)
        .expect(201);
    }
    const res = await request(app.getHttpServer())
      .get('/api/units/convert?qty=2&from=kg&to=g')
      .set(bearer(ownerToken))
      .expect(200);
    expect(
      apiResponseSchema(z.object({ result: z.number() })).parse(res.body).data
        .result,
    ).toBe(2000);

    await request(app.getHttpServer())
      .get('/api/units/convert?qty=1&from=kg&to=l')
      .set(bearer(ownerToken))
      .expect(400); // familias distintas
  });

  it('HU-02-03: staff no crea unidades (403) pero sí lee (200)', async () => {
    await request(app.getHttpServer())
      .post('/api/units')
      .set(bearer(staffToken))
      .send({
        code: 'ml',
        name: 'Mililitro',
        family: 'volume',
        factorToBase: 1,
      })
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/units')
      .set(bearer(staffToken))
      .expect(200);
  });

  it('HU-02-04: jerarquía, ciclo rechazado y no borrar con hijas', async () => {
    const catSchema = apiResponseSchema(z.object({ id: z.uuid() }));
    const parent = catSchema.parse(
      (
        await request(app.getHttpServer())
          .post('/api/categories')
          .set(bearer(ownerToken))
          .send({ name: 'Bebidas' })
          .expect(201)
      ).body,
    ).data.id;
    const child = catSchema.parse(
      (
        await request(app.getHttpServer())
          .post('/api/categories')
          .set(bearer(ownerToken))
          .send({ name: 'Gaseosas', parentId: parent })
          .expect(201)
      ).body,
    ).data.id;

    // poner al hijo como padre del padre → ciclo → 400
    await request(app.getHttpServer())
      .patch(`/api/categories/${parent}`)
      .set(bearer(ownerToken))
      .send({ parentId: child })
      .expect(400);
    // borrar el padre que tiene hijas → 409
    await request(app.getHttpServer())
      .delete(`/api/categories/${parent}`)
      .set(bearer(ownerToken))
      .expect(409);
  });

  it('HU-02-04: staff no crea categorías → 403', async () => {
    await request(app.getHttpServer())
      .post('/api/categories')
      .set(bearer(staffToken))
      .send({ name: 'X' })
      .expect(403);
  });
});
