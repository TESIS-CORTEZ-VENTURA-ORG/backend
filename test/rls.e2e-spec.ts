import { PrismaClient } from '@prisma/client';
import { PrismaService } from './../src/platform/prisma/prisma.service';

/**
 * Suite RLS de los 4 vectores (backend.md §4, riesgo R4). DEBE pasar antes de
 * cualquier feature de negocio. Requiere la DB local levantada (docker compose up).
 *
 * `admin` = conexión superuser (DATABASE_URL_ADMIN) que BYPASEA RLS → siembra
 * datos cross-tenant. `app` = PrismaService como gastronomia_app (DATABASE_URL),
 * rol NO-superuser al que la RLS FORCE SÍ aplica.
 */
describe('RLS multi-tenant — 4 vectores (e2e)', () => {
  const adminUrl = process.env.DATABASE_URL_ADMIN;
  if (!adminUrl) {
    throw new Error('DATABASE_URL_ADMIN no está definido (ver .env)');
  }

  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const app = new PrismaService();
  let tenantA = '';
  let tenantB = '';

  beforeAll(async () => {
    await admin.$connect();
    await app.onModuleInit();
    await admin.$executeRawUnsafe('TRUNCATE TABLE "users", "tenants" CASCADE');
    const a = await admin.tenant.create({ data: { name: 'Motif A' } });
    const b = await admin.tenant.create({ data: { name: 'Resto B' } });
    tenantA = a.id;
    tenantB = b.id;
    await admin.user.create({
      data: {
        tenantId: tenantA,
        email: 'a@motif.pe',
        name: 'User A',
        passwordHash: 'x',
        roles: ['owner'],
      },
    });
    await admin.user.create({
      data: {
        tenantId: tenantB,
        email: 'b@resto.pe',
        name: 'User B',
        passwordHash: 'x',
        roles: ['owner'],
      },
    });
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe('TRUNCATE TABLE "users", "tenants" CASCADE');
    await admin.$disconnect();
    await app.onModuleDestroy();
  });

  it('V1 cross-read: el tenant A solo ve sus propios usuarios', async () => {
    const users = await app.runInTenant(tenantA, (tx) => tx.user.findMany());
    expect(users).toHaveLength(1);
    expect(users[0]?.email).toBe('a@motif.pe');
  });

  it('V2 cross-write: el tenant A no puede escribir en el tenant B', async () => {
    await expect(
      app.runInTenant(tenantA, (tx) =>
        tx.user.create({
          data: {
            tenantId: tenantB,
            email: 'evil@a.pe',
            name: 'Evil',
            passwordHash: 'x',
            roles: ['staff'],
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it('V3 bypass JWT: sin contexto de tenant no se ve ninguna fila', async () => {
    const users = await app.user.findMany();
    expect(users).toHaveLength(0);
  });

  it('V4 bypass schema-owner: FORCE RLS aplica al owner (gastronomia_app)', async () => {
    const rows = await admin.$queryRaw<Array<{ forced: boolean }>>`
      SELECT relforcerowsecurity AS forced
      FROM pg_class WHERE relname = 'users'`;
    expect(rows[0]?.forced).toBe(true);

    // Y como owner, el contexto del tenant B nunca filtra usuarios de A.
    const users = await app.runInTenant(tenantB, (tx) => tx.user.findMany());
    expect(users.every((u) => u.email !== 'a@motif.pe')).toBe(true);
  });
});
