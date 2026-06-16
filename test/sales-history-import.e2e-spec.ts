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
  'TRUNCATE TABLE "sales_history","menu_items","recipes","audit_logs","refresh_tokens","users","tenants" CASCADE';

describe('Histórico de ventas — importación CSV HU-11-03/04/05 (e2e)', () => {
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
      dryRun: z.boolean(),
    }),
  );
  const listSchema = apiResponseSchema(
    z.object({
      from: z.string(),
      to: z.string(),
      totalQty: z.number(),
      totalRevenue: z.string(),
      rows: z.array(
        z.object({
          soldOn: z.string(),
          dishName: z.string(),
          menuItemId: z.uuid().nullable(),
          qty: z.number(),
          unitPrice: z.string(),
          total: z.string(),
        }),
      ),
    }),
  );

  let ownerToken = '';
  let managerToken = '';
  let staffToken = '';
  let tenantId = '';
  let lomoMenuItemId = '';

  const login = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    return tokensSchema.parse(res.body).data.accessToken;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const importCsv = (content: string, token: string, dryRun?: boolean) =>
    request(app.getHttpServer())
      .post('/api/sales-history/import')
      .set(bearer(token))
      .send(dryRun === undefined ? { content } : { content, dryRun });
  // Ventana amplia que cubre las fechas sembradas (2024).
  const listAll = (token: string) =>
    request(app.getHttpServer())
      .get(
        '/api/sales-history?from=2024-01-01T00:00:00Z&to=2024-12-31T23:59:59Z',
      )
      .set(bearer(token));

  // CSV de prueba: 2 filas válidas (una con plato que matchea "Lomo Saltado" →
  // menuItemId enlazado; otra que no matchea → null) + 1 fila mala (qty 0).
  const CSV = [
    'fecha,plato,cantidad,precio',
    '2024-03-01,Lomo Saltado,2,30', // línea 2 ✓ matchea menu item
    '2024-03-02,Plato Fantasma,1,15', // línea 3 ✓ sin match → null
    '2024-03-03,Ceviche,0,25', // línea 4 ✗ qty 0
  ].join('\n');

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe(TRUNCATE);
    const tenant = await admin.tenant.create({ data: { name: 'Motif' } });
    tenantId = tenant.id;
    const passwordHash = await hash(password, 4);
    await admin.user.create({
      data: {
        tenantId,
        email: 'owner@sh.pe',
        name: 'O',
        passwordHash,
        roles: ['owner'],
      },
    });
    await admin.user.create({
      data: {
        tenantId,
        email: 'manager@sh.pe',
        name: 'M',
        passwordHash,
        roles: ['manager'],
      },
    });
    await admin.user.create({
      data: {
        tenantId,
        email: 'staff@sh.pe',
        name: 'S',
        passwordHash,
        roles: ['staff'],
      },
    });
    // Plato activo "Lomo Saltado" (con su receta) para probar el enlace por nombre.
    const recipe = await admin.recipe.create({
      data: { tenantId, name: 'Lomo Saltado', kind: 'dish' },
    });
    const menuItem = await admin.menuItem.create({
      data: {
        tenantId,
        recipeId: recipe.id,
        name: 'Lomo Saltado',
        price: 30,
        isActive: true,
      },
    });
    lomoMenuItemId = menuItem.id;

    const mf = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mf.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    ownerToken = await login('owner@sh.pe');
    managerToken = await login('manager@sh.pe');
    staffToken = await login('staff@sh.pe');
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(TRUNCATE);
    await admin.$disconnect();
    await app.close();
  });

  it('HU-11-05: dryRun=true valida (reporta errores) pero NO persiste nada', async () => {
    const report = reportSchema.parse(
      (await importCsv(CSV, ownerToken, true).expect(201)).body,
    ).data;
    expect(report.dryRun).toBe(true);
    expect(report.total).toBe(3);
    expect(report.created).toBe(0); // no escribe en dry-run
    expect(report.updated).toBe(0);
    expect(report.failed).toBe(1);
    expect(report.errors.map((e) => e.line)).toEqual([4]); // la fila qty 0

    // Nada persistido.
    const list = listSchema.parse(
      (await listAll(ownerToken).expect(200)).body,
    ).data;
    expect(list.rows).toHaveLength(0);
    expect(list.totalQty).toBe(0);
  });

  it('HU-11-03/04: importa válidos, reporta error con línea y enlaza el plato', async () => {
    const report = reportSchema.parse(
      (await importCsv(CSV, ownerToken).expect(201)).body,
    ).data;
    expect(report.dryRun).toBe(false);
    expect(report.total).toBe(3);
    expect(report.created).toBe(2); // 2 válidas
    expect(report.updated).toBe(0);
    expect(report.failed).toBe(1); // qty 0
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].line).toBe(4);

    // GET muestra las filas + totales; el plato "Lomo Saltado" quedó enlazado.
    const list = listSchema.parse(
      (await listAll(ownerToken).expect(200)).body,
    ).data;
    expect(list.rows).toHaveLength(2);
    expect(list.totalQty).toBe(3); // 2 + 1
    expect(list.totalRevenue).toBe('75.00'); // 2·30 + 1·15
    const lomo = list.rows.find((r) => r.dishName === 'Lomo Saltado');
    const fantasma = list.rows.find((r) => r.dishName === 'Plato Fantasma');
    expect(lomo?.menuItemId).toBe(lomoMenuItemId); // enlazado por nombre exacto
    expect(lomo?.unitPrice).toBe('30.00');
    expect(lomo?.total).toBe('60.00'); // total derivado = unitPrice·qty
    expect(fantasma?.menuItemId).toBeNull(); // sin match → null
  });

  it('HU-11-04: re-importar el mismo CSV es idempotente (created 0, sin duplicar)', async () => {
    const report = reportSchema.parse(
      (await importCsv(CSV, ownerToken).expect(201)).body,
    ).data;
    expect(report.created).toBe(0); // nada nuevo
    expect(report.updated).toBe(2); // las 2 válidas se actualizan
    expect(report.failed).toBe(1);

    const list = listSchema.parse(
      (await listAll(ownerToken).expect(200)).body,
    ).data;
    expect(list.rows).toHaveLength(2); // SIN duplicados
    expect(list.totalQty).toBe(3);
    expect(list.totalRevenue).toBe('75.00');
  });

  it('HU-11-04: idempotencia por externalRef (ref) — rerun actualiza, no duplica', async () => {
    const csvRef = [
      'fecha,plato,cantidad,total,ref',
      '2024-04-01,Aji de Gallina,3,60,A-1',
      '2024-04-02,Causa,2,30,A-2',
    ].join('\n');
    const r1 = reportSchema.parse(
      (await importCsv(csvRef, ownerToken).expect(201)).body,
    ).data;
    expect(r1.created).toBe(2);
    expect(r1.updated).toBe(0);
    const r2 = reportSchema.parse(
      (await importCsv(csvRef, ownerToken).expect(201)).body,
    ).data;
    expect(r2.created).toBe(0); // mismas refs → update
    expect(r2.updated).toBe(2);

    const list = listSchema.parse(
      (await listAll(ownerToken).expect(200)).body,
    ).data;
    // 2 (sin ref, del CSV base) + 2 (con ref) = 4 filas, sin duplicar.
    expect(list.rows).toHaveLength(4);
  });

  it('HU-11-03: manager también puede importar (manage Report)', async () => {
    const report = reportSchema.parse(
      (
        await importCsv(
          'fecha,plato,cantidad,precio,ref\n2024-05-01,Tacu Tacu,1,40,M-1',
          managerToken,
        ).expect(201)
      ).body,
    ).data;
    expect(report.created).toBe(1);
  });

  it('HU-11-03: faltan columnas requeridas → 400', async () => {
    await importCsv('plato,cantidad\nX,1', ownerToken).expect(400);
  });

  it('HU-11-03: staff NO puede importar → 403 (manage Report)', async () => {
    await importCsv(CSV, staffToken).expect(403);
  });

  it('HU-11-03: staff NO puede leer el histórico → 403 (read Report)', async () => {
    await request(app.getHttpServer())
      .get('/api/sales-history')
      .set(bearer(staffToken))
      .expect(403);
  });
});
