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
  'TRUNCATE TABLE "dining_tables","zones","audit_logs","refresh_tokens","users","tenants" CASCADE';

describe('Salón — zonas y mesas HU-03-01/02 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);
  const zoneSchema = apiResponseSchema(
    z.object({ id: z.uuid(), name: z.string(), position: z.number() }),
  );
  const tableSchema = apiResponseSchema(
    z.object({
      id: z.uuid(),
      code: z.string(),
      zoneId: z.uuid(),
      zoneName: z.string(),
      status: z.string(),
      capacity: z.number(),
    }),
  );
  const tableListSchema = apiResponseSchema(
    z.array(z.object({ id: z.uuid(), code: z.string(), zoneName: z.string() })),
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
  const post = (path: string, token: string, body: unknown) =>
    request(app.getHttpServer()).post(path).set(bearer(token)).send(body);
  const patch = (path: string, token: string, body: unknown) =>
    request(app.getHttpServer()).patch(path).set(bearer(token)).send(body);

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe(TRUNCATE);
    const tenant = await admin.tenant.create({ data: { name: 'Motif' } });
    const passwordHash = await hash(password, 4);
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'owner@salon.pe',
        name: 'O',
        passwordHash,
        roles: ['owner'],
      },
    });
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'staff@salon.pe',
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
    ownerToken = await login('owner@salon.pe');
    staffToken = await login('staff@salon.pe');
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(TRUNCATE);
    await admin.$disconnect();
    await app.close();
  });

  let salonId = '';
  let terrazaId = '';
  let tableId = '';

  it('HU-03-01: crea zonas y mesas; code único por tenant', async () => {
    salonId = zoneSchema.parse(
      (
        await post('/api/zones', ownerToken, {
          name: 'Salón',
          position: 1,
        }).expect(201)
      ).body,
    ).data.id;
    terrazaId = zoneSchema.parse(
      (
        await post('/api/zones', ownerToken, {
          name: 'Terraza',
          position: 2,
        }).expect(201)
      ).body,
    ).data.id;

    const t = tableSchema.parse(
      (
        await post('/api/tables', ownerToken, {
          zoneId: salonId,
          code: 'M1',
          capacity: 4,
        }).expect(201)
      ).body,
    ).data;
    expect(t.status).toBe('free');
    expect(t.zoneName).toBe('Salón');
    tableId = t.id;

    // code duplicado → 409
    await post('/api/tables', ownerToken, {
      zoneId: salonId,
      code: 'M1',
    }).expect(409);
  });

  it('HU-03-02: lista mesas con su zona (datos del mapa)', async () => {
    const list = tableListSchema.parse(
      (
        await request(app.getHttpServer())
          .get('/api/tables')
          .set(bearer(ownerToken))
          .expect(200)
      ).body,
    ).data;
    expect(list).toHaveLength(1);
    expect(list[0].zoneName).toBe('Salón');
  });

  it('HU-03-01: mover mesa de zona (Salón → Terraza)', async () => {
    const moved = tableSchema.parse(
      (
        await patch(`/api/tables/${tableId}`, ownerToken, {
          zoneId: terrazaId,
        }).expect(200)
      ).body,
    ).data;
    expect(moved.zoneName).toBe('Terraza');
  });

  it('staff opera (PATCH estado) pero NO configura (crear/eliminar)', async () => {
    // staff puede cambiar estado de mesa (abrir/reservar/cuenta)
    await patch(`/api/tables/${tableId}`, staffToken, {
      status: 'reserved',
    }).expect(200);
    // staff NO crea mesas ni zonas → 403
    await post('/api/tables', staffToken, {
      zoneId: terrazaId,
      code: 'X9',
    }).expect(403);
    await post('/api/zones', staffToken, { name: 'Pirata' }).expect(403);
  });

  it('no se puede eliminar una zona con mesas → 409', async () => {
    await request(app.getHttpServer())
      .delete(`/api/zones/${terrazaId}`)
      .set(bearer(ownerToken))
      .expect(409);
  });

  it('eliminar mesa libre y luego su zona', async () => {
    // primero liberar (estaba 'reserved')
    await patch(`/api/tables/${tableId}`, ownerToken, {
      status: 'free',
    }).expect(200);
    await request(app.getHttpServer())
      .delete(`/api/tables/${tableId}`)
      .set(bearer(ownerToken))
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/api/zones/${terrazaId}`)
      .set(bearer(ownerToken))
      .expect(200);
  });
});
