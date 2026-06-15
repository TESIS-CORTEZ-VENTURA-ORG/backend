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
  'TRUNCATE TABLE "ingredients","audit_logs","refresh_tokens","users","tenants" CASCADE';

describe('Catálogo — carga masiva de insumos HU-02-02 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);
  const reportSchema = apiResponseSchema(
    z.object({
      total: z.number(),
      created: z.number(),
      updated: z.number(),
      failed: z.number(),
      errors: z.array(z.object({ line: z.number(), message: z.string() })),
    }),
  );
  const listSchema = apiResponseSchema(
    z.array(z.object({ sku: z.string(), unitCost: z.string() })),
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
  const importCsv = (content: string, token: string) =>
    request(app.getHttpServer())
      .post('/api/ingredients/import')
      .set(bearer(token))
      .send({ content });

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe(TRUNCATE);
    const tenant = await admin.tenant.create({ data: { name: 'Motif' } });
    const passwordHash = await hash(password, 4);
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'owner@imp.pe',
        name: 'O',
        passwordHash,
        roles: ['owner'],
      },
    });
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'staff@imp.pe',
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
    ownerToken = await login('owner@imp.pe');
    staffToken = await login('staff@imp.pe');
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(TRUNCATE);
    await admin.$disconnect();
    await app.close();
  });

  it('HU-02-02: importa válidos y reporta errores con línea exacta', async () => {
    const csv = [
      'sku,name,type,unit,unitCost,category',
      'LOM,Lomo,raw,kg,30,Carnes', // línea 2 ✓
      'CEB,Cebolla,raw,kg,5,Verduras', // línea 3 ✓
      ',Sin SKU,raw,kg,2,', // línea 4 ✗ formato
      'LOM,Lomo otra vez,raw,kg,31,Carnes', // línea 5 ✗ duplicado
    ].join('\n');

    const report = reportSchema.parse(
      (await importCsv(csv, ownerToken).expect(201)).body,
    ).data;
    expect(report.total).toBe(4);
    expect(report.created).toBe(2);
    expect(report.updated).toBe(0);
    expect(report.failed).toBe(2);
    expect(report.errors.map((e) => e.line).sort()).toEqual([4, 5]);

    const list = listSchema.parse(
      (
        await request(app.getHttpServer())
          .get('/api/ingredients')
          .set(bearer(ownerToken))
          .expect(200)
      ).body,
    ).data;
    expect(list).toHaveLength(2);
  });

  it('HU-02-02: la operación es idempotente (rerun → actualiza, no duplica)', async () => {
    const csv = [
      'sku,name,type,unit,unitCost,category',
      'LOM,Lomo saltado,raw,kg,32,Carnes',
      'CEB,Cebolla,raw,kg,5,Verduras',
    ].join('\n');

    const report = reportSchema.parse(
      (await importCsv(csv, ownerToken).expect(201)).body,
    ).data;
    expect(report.created).toBe(0);
    expect(report.updated).toBe(2);

    const list = listSchema.parse(
      (
        await request(app.getHttpServer())
          .get('/api/ingredients')
          .set(bearer(ownerToken))
          .expect(200)
      ).body,
    ).data;
    expect(list).toHaveLength(2); // sin duplicar
    expect(list.find((i) => i.sku === 'LOM')?.unitCost).toBe('32.00'); // actualizado
  });

  it('HU-02-02: faltan columnas requeridas → 400', async () => {
    await importCsv('name,type,unit\nX,raw,kg', ownerToken).expect(400);
  });

  it('HU-02-02: staff no puede importar → 403', async () => {
    await importCsv('sku,name,type,unit\nA,B,raw,kg', staffToken).expect(403);
  });
});
