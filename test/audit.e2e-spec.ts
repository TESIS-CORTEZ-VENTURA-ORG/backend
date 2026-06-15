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

describe('Audit log — HU-01-09 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);
  const auditSchema = apiResponseSchema(
    z.array(z.object({ action: z.string(), userId: z.string() })),
  );
  let ownerToken = '';
  let staffToken = '';
  let staffId = '';

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
      'TRUNCATE TABLE "audit_logs", "refresh_tokens", "users", "tenants" CASCADE',
    );
    const tenant = await admin.tenant.create({ data: { name: 'Motif' } });
    const passwordHash = await hash(password, 4);
    await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'owner@aud.pe',
        name: 'Owner',
        passwordHash,
        roles: ['owner'],
      },
    });
    const staff = await admin.user.create({
      data: {
        tenantId: tenant.id,
        email: 'staff@aud.pe',
        name: 'Staff',
        passwordHash,
        roles: ['staff'],
      },
    });
    staffId = staff.id;
    const mf = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mf.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    ownerToken = await login('owner@aud.pe');
    staffToken = await login('staff@aud.pe');
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(
      'TRUNCATE TABLE "audit_logs", "refresh_tokens", "users", "tenants" CASCADE',
    );
    await admin.$disconnect();
    await app.close();
  });

  it('acciones @Audited quedan en el audit log; owner las puede ver', async () => {
    await request(app.getHttpServer())
      .patch('/api/tenants/settings')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ capacity: 30 })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/users/${staffId}/role`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ roles: ['manager'] })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/api/audit')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const actions = auditSchema.parse(res.body).data.map((e) => e.action);
    expect(actions).toContain('settings.update');
    expect(actions).toContain('user.role.change');
  });

  it('staff no puede leer el audit log → 403', async () => {
    await request(app.getHttpServer())
      .get('/api/audit')
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(403);
  });
});
