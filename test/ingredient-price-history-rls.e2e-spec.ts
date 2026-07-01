/**
 * Suite RLS de los 4 vectores para `ingredient_price_history` (HU-05-12).
 * Sigue el mismo patrón que `rls.e2e-spec.ts` (backend.md §4, ADR-004).
 *
 * Vectores cubiertos:
 *  V1 · cross-read:          tenantA no puede leer filas del tenantB.
 *  V2 · cross-write:         tenantA no puede escribir en tenantB.
 *  V3 · bypass JWT:          sin SET LOCAL app.tenant_id no se ve ninguna fila.
 *  V4 · bypass schema-owner: superuser (admin) bypasea RLS; gastronomia_app no.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaService } from './../src/platform/prisma/prisma.service';

const adminUrl = process.env.DATABASE_URL_ADMIN;
if (!adminUrl) {
  throw new Error('DATABASE_URL_ADMIN no está definido (ver .env)');
}

describe('RLS — ingredient_price_history (4 vectores) (e2e)', () => {
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  // gastronomia_app = rol NO-superuser al que la RLS FORCE SÍ aplica.
  const app = new PrismaService();

  let tenantA = '';
  let tenantB = '';
  let ingA = '';
  let ingB = '';

  beforeAll(async () => {
    await admin.$connect();
    await app.onModuleInit();

    // Limpiar y crear 2 tenants aislados.
    await admin.$executeRawUnsafe(
      'TRUNCATE TABLE "ingredient_price_history","ingredients","users","tenants" CASCADE',
    );

    const a = await admin.tenant.create({ data: { name: 'Tenant A' } });
    const b = await admin.tenant.create({ data: { name: 'Tenant B' } });
    tenantA = a.id;
    tenantB = b.id;

    // Insumos mínimos (necesarios para la FK).
    const ia = await admin.ingredient.create({
      data: {
        tenantId: tenantA,
        sku: 'RLS-A',
        name: 'Ing A',
        type: 'raw',
        unit: 'kg',
      },
    });
    const ib = await admin.ingredient.create({
      data: {
        tenantId: tenantB,
        sku: 'RLS-B',
        name: 'Ing B',
        type: 'raw',
        unit: 'kg',
      },
    });
    ingA = ia.id;
    ingB = ib.id;

    // Sembrar 1 registro por tenant como superuser (bypasea RLS).
    await admin.ingredientPriceHistory.create({
      data: {
        tenantId: tenantA,
        ingredientId: ingA,
        unitCost: new Prisma.Decimal('38.00'),
        recordedAt: new Date(),
        source: 'purchase_order',
      },
    });
    await admin.ingredientPriceHistory.create({
      data: {
        tenantId: tenantB,
        ingredientId: ingB,
        unitCost: new Prisma.Decimal('45.00'),
        recordedAt: new Date(),
        source: 'purchase_order',
      },
    });
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(
      'TRUNCATE TABLE "ingredient_price_history","ingredients","users","tenants" CASCADE',
    );
    await admin.$disconnect();
    await app.onModuleDestroy();
  });

  // V1 · cross-read: tenantA solo ve sus propias filas.
  it('V1 cross-read: tenantA no ve filas de tenantB', async () => {
    const rows = await app.runInTenant(tenantA, (tx) =>
      tx.ingredientPriceHistory.findMany(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe(tenantA);
  });

  // V2 · cross-write: tenantA no puede insertar una fila con tenantId=tenantB.
  it('V2 cross-write: tenantA no puede escribir en tenantB', async () => {
    await expect(
      app.runInTenant(tenantA, (tx) =>
        tx.ingredientPriceHistory.create({
          data: {
            tenantId: tenantB, // intento de contaminación cross-tenant
            ingredientId: ingB,
            unitCost: new Prisma.Decimal('99.00'),
            recordedAt: new Date(),
            source: 'manual',
          },
        }),
      ),
    ).rejects.toThrow();
  });

  // V3 · bypass JWT: sin SET LOCAL no se ve ninguna fila (FORCE RLS).
  it('V3 bypass JWT: sin contexto de tenant no se ve ninguna fila', async () => {
    const rows = await app.ingredientPriceHistory.findMany();
    expect(rows).toHaveLength(0);
  });

  // V4 · bypass schema-owner: el superuser (admin) SÍ bypasea RLS y ve todo;
  // gastronomia_app no. Valida que FORCE RLS solo aplica al rol no-superuser.
  it('V4 bypass schema-owner: superuser ve todas las filas; gastronomia_app no', async () => {
    // admin (superuser) bypasea → ve las 2 filas sembradas.
    const allRows = await admin.ingredientPriceHistory.findMany();
    expect(allRows.length).toBeGreaterThanOrEqual(2);

    // gastronomia_app sin tenant_id → ve 0 (FORCE RLS activo).
    const appRows = await app.ingredientPriceHistory.findMany();
    expect(appRows).toHaveLength(0);
  });
});
