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

const employeeViewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
  dni: z.string(),
  position: z.string(),
  phone: z.string().nullable(),
  hiredAt: z.string().nullable(),
  active: z.boolean(),
  userId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

describe('Employees (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);
  let ownerAToken = '';
  let managerAToken = '';
  let staffAToken = '';
  let ownerBToken = '';
  let tenantAId = '';
  let tenantBId = '';

  const login = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    return tokensSchema.parse(res.body).data.accessToken;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  const truncate = () =>
    admin.$executeRawUnsafe(
      'TRUNCATE TABLE "employees", "audit_logs", "refresh_tokens", "users", "tenants" CASCADE',
    );

  beforeAll(async () => {
    await admin.$connect();
    await truncate();

    const tenantA = await admin.tenant.create({ data: { name: 'Tenant A' } });
    tenantAId = tenantA.id;
    const tenantB = await admin.tenant.create({ data: { name: 'Tenant B' } });
    tenantBId = tenantB.id;

    const passwordHash = await hash(password, 4);

    await admin.user.create({
      data: {
        tenantId: tenantAId,
        email: 'owner.a@test.pe',
        name: 'Owner A',
        passwordHash,
        roles: ['owner'],
      },
    });
    await admin.user.create({
      data: {
        tenantId: tenantAId,
        email: 'manager.a@test.pe',
        name: 'Manager A',
        passwordHash,
        roles: ['manager'],
      },
    });
    await admin.user.create({
      data: {
        tenantId: tenantAId,
        email: 'staff.a@test.pe',
        name: 'Staff A',
        passwordHash,
        roles: ['staff'],
      },
    });
    await admin.user.create({
      data: {
        tenantId: tenantBId,
        email: 'owner.b@test.pe',
        name: 'Owner B',
        passwordHash,
        roles: ['owner'],
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

    ownerAToken = await login('owner.a@test.pe');
    managerAToken = await login('manager.a@test.pe');
    staffAToken = await login('staff.a@test.pe');
    ownerBToken = await login('owner.b@test.pe');
  });

  afterAll(async () => {
    await truncate();
    await admin.$disconnect();
    await app.close();
  });

  describe('CASL: staff → 403 on all endpoints', () => {
    it('GET /employees → 403', async () => {
      await request(app.getHttpServer())
        .get('/api/employees')
        .set(bearer(staffAToken))
        .expect(403);
    });

    it('POST /employees → 403', async () => {
      await request(app.getHttpServer())
        .post('/api/employees')
        .set(bearer(staffAToken))
        .send({
          firstName: 'John',
          lastName: 'Doe',
          dni: '99999999',
          position: 'mozo',
          salary: '1000.00',
        })
        .expect(403);
    });
  });

  describe('Owner: full CRUD with salary visible', () => {
    let employeeId = '';

    it('POST /employees → 201 with salary', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/employees')
        .set(bearer(ownerAToken))
        .send({
          firstName: 'Ana',
          lastName: 'García',
          dni: '12345678',
          position: 'caja',
          salary: '2500.00',
          phone: '+51999000111',
        })
        .expect(201);

      const parsed = apiResponseSchema(
        employeeViewSchema.extend({ salary: z.string() }),
      ).parse(res.body);
      expect(parsed.data.salary).toBe('2500.00');
      expect(parsed.data.firstName).toBe('Ana');
      expect(parsed.data.tenantId).toBe(tenantAId);
      employeeId = parsed.data.id;
    });

    it('GET /employees → lists employee with salary', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/employees')
        .set(bearer(ownerAToken))
        .expect(200);

      const parsed = apiResponseSchema(
        z.array(employeeViewSchema.extend({ salary: z.string() })),
      ).parse(res.body);
      expect(parsed.data.length).toBeGreaterThanOrEqual(1);
      const emp = parsed.data.find((e) => e.id === employeeId);
      expect(emp).toBeDefined();
      expect(emp?.salary).toBe('2500.00');
    });

    it('GET /employees/:id → returns employee with salary', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/employees/${employeeId}`)
        .set(bearer(ownerAToken))
        .expect(200);

      const parsed = apiResponseSchema(
        employeeViewSchema.extend({ salary: z.string() }),
      ).parse(res.body);
      expect(parsed.data.salary).toBe('2500.00');
    });

    it('PATCH /employees/:id → updates salary', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/employees/${employeeId}`)
        .set(bearer(ownerAToken))
        .send({ salary: '3000.00', position: 'otro' })
        .expect(200);

      const parsed = apiResponseSchema(
        employeeViewSchema.extend({ salary: z.string() }),
      ).parse(res.body);
      expect(parsed.data.salary).toBe('3000.00');
      expect(parsed.data.position).toBe('otro');
    });

    it('DELETE /employees/:id → soft deletes', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/employees/${employeeId}`)
        .set(bearer(ownerAToken))
        .expect(200);

      const parsed = apiResponseSchema(
        z.object({ deleted: z.literal(true) }),
      ).parse(res.body);
      expect(parsed.data).toEqual({ deleted: true });
    });

    it('GET /employees/:id after delete → 404', async () => {
      await request(app.getHttpServer())
        .get(`/api/employees/${employeeId}`)
        .set(bearer(ownerAToken))
        .expect(404);
    });
  });

  describe('Manager: CRUD without salary', () => {
    let employeeId = '';

    it('POST /employees → 201 without salary in response', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/employees')
        .set(bearer(managerAToken))
        .send({
          firstName: 'Luis',
          lastName: 'Ramos',
          dni: '87654321',
          position: 'cocina',
          salary: '9999.00', // should be ignored (salary gated to owner)
        })
        .expect(201);

      const parsed = apiResponseSchema(employeeViewSchema).parse(res.body);
      expect(parsed.data.firstName).toBe('Luis');
      expect(
        (parsed.data as Record<string, unknown>)['salary'],
      ).toBeUndefined();
      employeeId = parsed.data.id;
    });

    it('GET /employees/:id → no salary field', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/employees/${employeeId}`)
        .set(bearer(managerAToken))
        .expect(200);

      const parsed = apiResponseSchema(employeeViewSchema).parse(res.body);
      expect(
        (parsed.data as Record<string, unknown>)['salary'],
      ).toBeUndefined();
    });

    it('PATCH /employees/:id salary input → ignored in response', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/employees/${employeeId}`)
        .set(bearer(managerAToken))
        .send({ salary: '5000.00', firstName: 'Luigi' })
        .expect(200);

      const parsed = apiResponseSchema(employeeViewSchema).parse(res.body);
      expect(parsed.data.firstName).toBe('Luigi');
      expect(
        (parsed.data as Record<string, unknown>)['salary'],
      ).toBeUndefined();
    });

    it('DELETE /employees/:id → 200', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/employees/${employeeId}`)
        .set(bearer(managerAToken))
        .expect(200);

      const parsed = apiResponseSchema(
        z.object({ deleted: z.literal(true) }),
      ).parse(res.body);
      expect(parsed.data).toEqual({ deleted: true });
    });
  });

  describe('Unique DNI per tenant', () => {
    it('duplicate DNI in same tenant → 409', async () => {
      await request(app.getHttpServer())
        .post('/api/employees')
        .set(bearer(ownerAToken))
        .send({
          firstName: 'Carla',
          lastName: 'Torres',
          dni: '11223344',
          position: 'mozo',
          salary: '1500.00',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/employees')
        .set(bearer(ownerAToken))
        .send({
          firstName: 'Carlos',
          lastName: 'Torres',
          dni: '11223344',
          position: 'caja',
          salary: '1600.00',
        })
        .expect(409);
    });

    it('same DNI in different tenant → 201 (no conflict)', async () => {
      await request(app.getHttpServer())
        .post('/api/employees')
        .set(bearer(ownerBToken))
        .send({
          firstName: 'Carla',
          lastName: 'Torres',
          dni: '11223344', // same DNI as tenant A but in tenant B
          position: 'mozo',
          salary: '1500.00',
        })
        .expect(201);
    });
  });

  describe('Tenant isolation: owner A cannot see tenant B employees', () => {
    it('owner A list does not include tenant B employees', async () => {
      // Create employee in tenant B
      const resBCreate = await request(app.getHttpServer())
        .post('/api/employees')
        .set(bearer(ownerBToken))
        .send({
          firstName: 'Maria',
          lastName: 'Lopez',
          dni: '55667788',
          position: 'otro',
          salary: '2000.00',
        })
        .expect(201);

      const bEmpId = apiResponseSchema(
        employeeViewSchema.extend({ salary: z.string() }),
      ).parse(resBCreate.body).data.id;

      // Owner A should not see it
      const resAList = await request(app.getHttpServer())
        .get('/api/employees')
        .set(bearer(ownerAToken))
        .expect(200);

      const aList = apiResponseSchema(
        z.array(employeeViewSchema.extend({ salary: z.string().optional() })),
      ).parse(resAList.body).data;

      expect(aList.find((e) => e.id === bEmpId)).toBeUndefined();

      // Owner A GET by ID → 404 (RLS blocks cross-tenant access)
      await request(app.getHttpServer())
        .get(`/api/employees/${bEmpId}`)
        .set(bearer(ownerAToken))
        .expect(404);
    });
  });
});
