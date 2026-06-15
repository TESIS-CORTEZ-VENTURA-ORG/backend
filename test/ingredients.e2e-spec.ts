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

describe('Catálogo — insumos HU-02-01 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);
  const ingredientSchema = apiResponseSchema(
    z.object({
      id: z.uuid(),
      sku: z.string(),
      name: z.string(),
      unitCost: z.string(),
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
  const auth = (token: string) => `Bearer ${token}`;

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe(
      'TRUNCATE TABLE "ingredients", "audit_logs", "refresh_tokens", "users", "tenants" CASCADE',
    );
    const tenant = await admin.tenant.create({ data: { name: 'Motif' } });
    const passwordHash = await hash(password, 4);
    for (const [email, role] of [
      ['owner@cat.pe', 'owner'],
      ['manager@cat.pe', 'manager'],
      ['staff@cat.pe', 'staff'],
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
    ownerToken = await login('owner@cat.pe');
    managerToken = await login('manager@cat.pe');
    staffToken = await login('staff@cat.pe');
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(
      'TRUNCATE TABLE "ingredients", "audit_logs", "refresh_tokens", "users", "tenants" CASCADE',
    );
    await admin.$disconnect();
    await app.close();
  });

  const newIngredient = {
    sku: 'LIM-001',
    name: 'Limón Sutil',
    type: 'raw',
    unit: 'kg',
    category: 'Frutas',
    unitCost: 8.5,
  };
  let createdId = '';

  it('manager crea insumo → 201 (unitCost como string)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/ingredients')
      .set('Authorization', auth(managerToken))
      .send(newIngredient)
      .expect(201);
    const body = ingredientSchema.parse(res.body);
    expect(body.data.sku).toBe('LIM-001');
    expect(body.data.unitCost).toBe('8.50');
    createdId = body.data.id;
  });

  it('staff NO puede crear → 403', async () => {
    await request(app.getHttpServer())
      .post('/api/ingredients')
      .set('Authorization', auth(staffToken))
      .send({ ...newIngredient, sku: 'X-1' })
      .expect(403);
  });

  it('staff sí puede leer el catálogo → 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/ingredients')
      .set('Authorization', auth(staffToken))
      .expect(200);
    const body = apiResponseSchema(z.array(z.object({ id: z.uuid() }))).parse(
      res.body,
    );
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('SKU duplicado → 409', async () => {
    await request(app.getHttpServer())
      .post('/api/ingredients')
      .set('Authorization', auth(managerToken))
      .send(newIngredient)
      .expect(409);
  });

  it('manager actualiza el costo → 200', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/ingredients/${createdId}`)
      .set('Authorization', auth(managerToken))
      .send({ unitCost: 9.25 })
      .expect(200);
    expect(ingredientSchema.parse(res.body).data.unitCost).toBe('9.25');
  });

  it('manager hace soft-delete → 200 y desaparece de la lista', async () => {
    await request(app.getHttpServer())
      .delete(`/api/ingredients/${createdId}`)
      .set('Authorization', auth(managerToken))
      .expect(200);
    const res = await request(app.getHttpServer())
      .get('/api/ingredients')
      .set('Authorization', auth(ownerToken))
      .expect(200);
    const ids = apiResponseSchema(z.array(z.object({ id: z.uuid() })))
      .parse(res.body)
      .data.map((i) => i.id);
    expect(ids).not.toContain(createdId);
  });

  it('sin token → 401', async () => {
    await request(app.getHttpServer()).get('/api/ingredients').expect(401);
  });
});
