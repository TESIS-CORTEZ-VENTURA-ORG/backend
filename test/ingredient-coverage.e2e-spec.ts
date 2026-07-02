/**
 * E2e spec — HU-05-11: Cobertura de días de stock por consumo real.
 * Cubre: cobertura finita, cobertura indefinida (sin ventas), 404 para insumo
 * inexistente, CASL 403 para staff.
 *
 * Lote B4 (vida útil de insumos, MVP sin lotes): cobertura EFECTIVA =
 * min(consumo, vida útil restante), atRisk con el escenario del ticket
 * (8kg, 0.8kg/día, 3 días → 5.6kg en riesgo), y el caso sin compras
 * registradas (campos de frescura en null, sin inventar una estimación).
 */
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaClient, Prisma } from '@prisma/client';
import { hash } from 'bcryptjs';
import { AppModule } from './../src/app.module';
import {
  apiResponseSchema,
  authTokensSchema,
  ingredientCoverageResponseSchema,
} from './../src/shared';

const adminUrl = process.env.DATABASE_URL_ADMIN;
if (!adminUrl) {
  throw new Error('DATABASE_URL_ADMIN no está definido (ver .env)');
}

const TRUNCATE =
  'TRUNCATE TABLE "inventory_movements","ingredients","audit_logs","refresh_tokens","users","tenants" CASCADE';

describe('Ingredient Coverage — HU-05-11 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);

  // Reusa el contrato REAL de `packages/shared` (única fuente de verdad) en
  // vez de un shape a mano — evita que el test quede desalineado del schema.
  const coverageSchema = apiResponseSchema(ingredientCoverageResponseSchema);

  let ownerToken = '';
  let staffToken = '';
  let ingWithConsumptionId = '';
  let ingNoConsumptionId = '';
  let ingPerishableWithPurchaseId = '';
  let ingPerishableNoPurchaseId = '';

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
    const tenantId = tenant.id;
    const ph = await hash(password, 4);

    await admin.user.create({
      data: {
        tenantId,
        email: 'owner@cov.pe',
        name: 'O',
        passwordHash: ph,
        roles: ['owner'],
      },
    });
    await admin.user.create({
      data: {
        tenantId,
        email: 'staff@cov.pe',
        name: 'S',
        passwordHash: ph,
        roles: ['staff'],
      },
    });

    // Insumo A: stock=10 kg, con movimientos de venta de -60 kg en 30 días.
    // → avgDailyConsumption = 60/30 = 2 kg/día; daysLeft = 10/2 = 5.
    const ingA = await admin.ingredient.create({
      data: {
        tenantId,
        sku: 'COV-001',
        name: 'Pescado',
        type: 'raw',
        unit: 'kg',
        unitCost: 38,
        stock: new Prisma.Decimal('10'),
      },
    });
    ingWithConsumptionId = ingA.id;

    const now = new Date();
    for (let i = 0; i < 30; i++) {
      const createdAt = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      await admin.inventoryMovement.create({
        data: {
          tenantId,
          ingredientId: ingA.id,
          type: 'sale',
          qty: new Prisma.Decimal('-2'), // -2 kg/día (salida)
          createdAt,
        },
      });
    }

    // Insumo B: stock=5 kg, sin movimientos de venta → daysLeft=null.
    const ingB = await admin.ingredient.create({
      data: {
        tenantId,
        sku: 'COV-002',
        name: 'Arroz',
        type: 'raw',
        unit: 'kg',
        unitCost: 4,
        stock: new Prisma.Decimal('5'),
      },
    });
    ingNoConsumptionId = ingB.id;

    // Lote B4 · Insumo C: perecible CON compra reciente — escenario exacto del
    // ticket: stock=8kg, consumo=0.8kg/día (24kg en 30 días), shelfLifeDays=3.
    // → daysLeft=10, effectiveCoverageDays=min(10,3)=3, atRiskQty=8-0.8×3=5.6kg.
    const ingC = await admin.ingredient.create({
      data: {
        tenantId,
        sku: 'COV-003',
        name: 'Pulpo perecible',
        type: 'raw',
        unit: 'kg',
        unitCost: 30,
        stock: new Prisma.Decimal('8'),
        shelfLifeDays: 3,
      },
    });
    ingPerishableWithPurchaseId = ingC.id;

    for (let i = 0; i < 30; i++) {
      const createdAt = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      await admin.inventoryMovement.create({
        data: {
          tenantId,
          ingredientId: ingC.id,
          type: 'sale',
          qty: new Prisma.Decimal('-0.8'), // -0.8 kg/día (salida)
          createdAt,
        },
      });
    }
    // Compra recién recibida "ahora" → vida útil restante ≈ shelfLifeDays (3d).
    await admin.inventoryMovement.create({
      data: {
        tenantId,
        ingredientId: ingC.id,
        type: 'purchase',
        qty: new Prisma.Decimal('8'),
        createdAt: now,
      },
    });

    // Lote B4 · Insumo D: shelfLifeDays configurado pero SIN NINGUNA compra
    // registrada → no se puede estimar frescura (no se inventa un valor):
    // lastPurchaseAt/estimatedExpiryAt/freshnessStatus/atRisk* deben ser null.
    const ingD = await admin.ingredient.create({
      data: {
        tenantId,
        sku: 'COV-004',
        name: 'Camarones sin compras',
        type: 'raw',
        unit: 'kg',
        unitCost: 33,
        stock: new Prisma.Decimal('5'),
        shelfLifeDays: 3,
      },
    });
    ingPerishableNoPurchaseId = ingD.id;

    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication(new FastifyAdapter());
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    ownerToken = await login('owner@cov.pe');
    staffToken = await login('staff@cov.pe');
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(TRUNCATE);
    await admin.$disconnect();
    await app.close();
  });

  it('cobertura finita con consumo real', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/inventory/ingredients/${ingWithConsumptionId}/coverage`)
      .set(bearer(ownerToken))
      .expect(200);

    const body = coverageSchema.parse(res.body);
    expect(body.data.currentStock).toBe('10.000');
    // 60 kg / 30 días = 2 kg/día
    expect(Number(body.data.avgDailyConsumption)).toBeCloseTo(2, 1);
    // 10 / 2 = 5 días
    expect(Number(body.data.daysLeft)).toBeCloseTo(5, 0);
    expect(body.data.basedOnDays).toBe(30);
  });

  it('cobertura indefinida cuando no hay ventas', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/inventory/ingredients/${ingNoConsumptionId}/coverage`)
      .set(bearer(ownerToken))
      .expect(200);

    const body = coverageSchema.parse(res.body);
    expect(body.data.avgDailyConsumption).toBe('0.000');
    expect(body.data.daysLeft).toBeNull();
    // Sin shelfLifeDays configurado (no perecible) → todo lo de frescura null.
    expect(body.data.shelfLifeDays).toBeNull();
    expect(body.data.freshnessStatus).toBeNull();
  });

  it('404 cuando el insumo no existe', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000001';
    await request(app.getHttpServer())
      .get(`/api/inventory/ingredients/${fakeId}/coverage`)
      .set(bearer(ownerToken))
      .expect(404);
  });

  // Staff has `can('read', 'Inventory')` in CASL — coverage is a read-only endpoint
  // so staff gets 200, not 403. 403 only applies to write actions.
  it('staff: puede leer cobertura (CASL read Inventory) → 200', async () => {
    await request(app.getHttpServer())
      .get(`/api/inventory/ingredients/${ingWithConsumptionId}/coverage`)
      .set(bearer(staffToken))
      .expect(200);
  });

  it('sin token: recibe 401', async () => {
    await request(app.getHttpServer())
      .get(`/api/inventory/ingredients/${ingWithConsumptionId}/coverage`)
      .expect(401);
  });

  // Lote B4 — Vida útil de insumos (MVP sin lotes).
  it('vida útil: cobertura efectiva = min(consumo, vida restante); atRisk = 8kg−0.8kg/d×3d = 5.6kg', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/inventory/ingredients/${ingPerishableWithPurchaseId}/coverage`)
      .set(bearer(ownerToken))
      .expect(200);

    const body = coverageSchema.parse(res.body);
    expect(body.data.shelfLifeDays).toBe(3);
    expect(body.data.lastPurchaseAt).not.toBeNull();
    expect(body.data.estimatedExpiryAt).not.toBeNull();
    // Cobertura por consumo: 8kg / 0.8kg/día = 10 días.
    expect(Number(body.data.daysLeft)).toBeCloseTo(10, 0);
    // Cuello de botella: min(10, ~3) = 3 — NUNCA un promedio de ambos.
    expect(Number(body.data.effectiveCoverageDays)).toBeCloseTo(3, 0);
    expect(['fresh', 'expiring_soon']).toContain(body.data.freshnessStatus);
    // Escenario exacto del ticket: 5.6 kg no se alcanzan a consumir → riesgo.
    expect(Number(body.data.atRiskQty)).toBeCloseTo(5.6, 1);
    expect(Number(body.data.atRiskCost)).toBeCloseTo(5.6 * 30, 0);
  });

  it('vida útil sin compras registradas: no se inventa una estimación (todo null)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/inventory/ingredients/${ingPerishableNoPurchaseId}/coverage`)
      .set(bearer(ownerToken))
      .expect(200);

    const body = coverageSchema.parse(res.body);
    expect(body.data.shelfLifeDays).toBe(3);
    expect(body.data.lastPurchaseAt).toBeNull();
    expect(body.data.estimatedExpiryAt).toBeNull();
    expect(body.data.freshnessStatus).toBeNull();
    expect(body.data.atRiskQty).toBeNull();
    expect(body.data.atRiskCost).toBeNull();
    // Sin vida útil estimable, effectiveCoverageDays degrada al daysLeft de
    // siempre (comportamiento HU-05-11 intacto): stock=5kg, sin consumo → null.
    expect(body.data.daysLeft).toBeNull();
    expect(body.data.effectiveCoverageDays).toBeNull();
  });
});
