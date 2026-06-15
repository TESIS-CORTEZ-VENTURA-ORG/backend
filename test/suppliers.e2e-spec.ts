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
  'TRUNCATE TABLE "product_suppliers","suppliers","ingredients","categories","units_of_measure","audit_logs","refresh_tokens","users","tenants" CASCADE';

describe('Catálogo — proveedores (02-05) y producto-proveedor (02-06) (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);
  const idSchema = apiResponseSchema(z.object({ id: z.uuid() }));
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
    await admin.$executeRawUnsafe(TRUNCATE);
    const tenant = await admin.tenant.create({ data: { name: 'Motif' } });
    const passwordHash = await hash(password, 4);
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'owner@sup.pe',
        name: 'O',
        passwordHash,
        roles: ['owner'],
      },
    });
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'staff@sup.pe',
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
    ownerToken = await login('owner@sup.pe');
    staffToken = await login('staff@sup.pe');
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(TRUNCATE);
    await admin.$disconnect();
    await app.close();
  });

  let supplierId = '';
  let ingredientId = '';

  it('HU-02-05: owner crea proveedor (RUC válido) → 201; RUC inválido 400; dup 409; staff 403', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/suppliers')
      .set(bearer(ownerToken))
      .send({ ruc: '20123456789', name: 'Distribuidora Lima', leadTimeDays: 3 })
      .expect(201);
    supplierId = idSchema.parse(res.body).data.id;

    await request(app.getHttpServer())
      .post('/api/suppliers')
      .set(bearer(ownerToken))
      .send({ ruc: '123', name: 'Mala' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/suppliers')
      .set(bearer(ownerToken))
      .send({ ruc: '20123456789', name: 'Dup' })
      .expect(409);
    await request(app.getHttpServer())
      .post('/api/suppliers')
      .set(bearer(staffToken))
      .send({ ruc: '20999999999', name: 'X' })
      .expect(403);
  });

  it('HU-02-06: asocia proveedor a insumo, lista y desasocia', async () => {
    const ing = await request(app.getHttpServer())
      .post('/api/ingredients')
      .set(bearer(ownerToken))
      .send({
        sku: 'LIM-1',
        name: 'Limón',
        type: 'raw',
        unit: 'kg',
        unitCost: 8,
      })
      .expect(201);
    ingredientId = idSchema.parse(ing.body).data.id;

    await request(app.getHttpServer())
      .post(`/api/ingredients/${ingredientId}/suppliers`)
      .set(bearer(ownerToken))
      .send({
        supplierId,
        supplierSku: 'PROV-LIM',
        lastPrice: 7.5,
        preferred: true,
      })
      .expect(201);

    // duplicado → 409
    await request(app.getHttpServer())
      .post(`/api/ingredients/${ingredientId}/suppliers`)
      .set(bearer(ownerToken))
      .send({ supplierId })
      .expect(409);

    const listed = await request(app.getHttpServer())
      .get(`/api/ingredients/${ingredientId}/suppliers`)
      .set(bearer(ownerToken))
      .expect(200);
    const body = apiResponseSchema(
      z.array(
        z.object({
          supplierId: z.uuid(),
          supplierName: z.string(),
          lastPrice: z.string().nullable(),
        }),
      ),
    ).parse(listed.body);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.lastPrice).toBe('7.50');

    await request(app.getHttpServer())
      .delete(`/api/ingredients/${ingredientId}/suppliers/${supplierId}`)
      .set(bearer(ownerToken))
      .expect(200);
  });
});
