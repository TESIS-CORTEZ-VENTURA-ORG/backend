import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import request from 'supertest';
import { App } from 'supertest/types';
import { Prisma, PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { AppModule } from './../src/app.module';
import { apiResponseSchema, authTokensSchema } from './../src/shared';

const adminUrl = process.env.DATABASE_URL_ADMIN;
if (!adminUrl) {
  throw new Error('DATABASE_URL_ADMIN no está definido (ver .env)');
}

const TRUNCATE =
  'TRUNCATE TABLE "costing_closes","overhead_costs","inventory_movements","cash_closes","payments","sales","order_items","orders","dining_tables","zones","menu_modifiers","menu_availability","menu_items","menu_categories","recipe_versions","recipe_items","recipes","product_suppliers","suppliers","ingredients","categories","units_of_measure","audit_logs","refresh_tokens","users","tenants" CASCADE';

// Período del reporte de food cost (mes en curso, UTC). Las ventas se siembran
// el día 15 del mes para caer holgadamente dentro de [inicio, fin) del mes.
const nowDate = new Date();
const PERIOD = `${nowDate.getUTCFullYear()}-${String(nowDate.getUTCMonth() + 1).padStart(2, '0')}`;
const IN_PERIOD = new Date(
  Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 15, 12, 0, 0),
);
// Ventana de mermas: todo el mes (cubre las mermas sembradas el día 15).
const WASTE_FROM = new Date(
  Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 1),
).toISOString();
const WASTE_TO = new Date(
  Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth() + 1, 1),
).toISOString();

describe('Reportes operativos — HU-07-05/06/07/10 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);
  const idSchema = apiResponseSchema(z.object({ id: z.uuid() }));

  const inventorySchema = apiResponseSchema(
    z.object({
      generatedAt: z.string(),
      totalSkus: z.number(),
      totalStockValue: z.string(),
      lowStockCount: z.number(),
      criticalCount: z.number(),
      items: z.array(
        z.object({
          ingredientId: z.uuid(),
          name: z.string(),
          unit: z.string(),
          stock: z.string(),
          minStock: z.string(),
          unitCost: z.string(),
          stockValue: z.string(),
          status: z.enum(['ok', 'low', 'critical']),
        }),
      ),
    }),
  );
  const foodCostSchema = apiResponseSchema(
    z.object({
      period: z.string(),
      overallFoodCostPct: z.string(),
      targetFoodCostPct: z.string(),
      dishes: z.array(
        z.object({
          name: z.string(),
          sellPrice: z.string(),
          ingredientCost: z.string(),
          foodCostPct: z.string(),
          unitsSold: z.number(),
          revenue: z.string(),
        }),
      ),
    }),
  );
  const wasteSchema = apiResponseSchema(
    z.object({
      from: z.string(),
      to: z.string(),
      totalWasteQty: z.string(),
      totalWasteCost: z.string(),
      byIngredient: z.array(
        z.object({
          ingredientId: z.uuid(),
          name: z.string(),
          qty: z.string(),
          cost: z.string(),
        }),
      ),
      byReason: z.array(
        z.object({ reason: z.string(), qty: z.string(), cost: z.string() }),
      ),
      movements: z.array(
        z.object({
          id: z.uuid(),
          ingredientId: z.uuid(),
          ingredientName: z.string(),
          qty: z.string(),
          unit: z.string(),
          reason: z.string().nullable(),
          createdAt: z.string(),
        }),
      ),
    }),
  );

  let ownerToken = '';
  let staffToken = '';
  let tenantId = '';
  let zoneId = '';
  let pizzaId = '';
  let aguaId = '';
  let quesoId = '';
  let tomateId = '';

  const login = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    return tokensSchema.parse(res.body).data.accessToken;
  };
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (path: string, token: string) =>
    request(app.getHttpServer()).get(path).set(bearer(token));
  const post = (path: string, token: string, body: unknown) =>
    request(app.getHttpServer()).post(path).set(bearer(token)).send(body);

  // Siembra una venta emitida (issued) con sus líneas de plato dentro del período.
  let saleNumber = 0;
  const seedSale = async (
    lines: {
      menuItemId: string;
      name: string;
      qty: number;
      unitPrice: number;
    }[],
  ): Promise<void> => {
    const total = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
    const subtotal = Math.round((total / 1.18) * 100) / 100;
    const igv = Math.round((total - subtotal) * 100) / 100;
    const table = await admin.diningTable.create({
      data: {
        tenantId,
        zoneId,
        code: `M${++saleNumber}`,
        capacity: 4,
        status: 'free',
      },
    });
    const order = await admin.order.create({
      data: {
        tenantId,
        tableId: table.id,
        guests: 2,
        status: 'paid',
        openedAt: IN_PERIOD,
        createdAt: IN_PERIOD,
      },
    });
    for (const l of lines) {
      await admin.orderItem.create({
        data: {
          tenantId,
          orderId: order.id,
          menuItemId: l.menuItemId,
          name: l.name,
          qty: l.qty,
          unitPrice: l.unitPrice,
          createdAt: IN_PERIOD,
        },
      });
    }
    await admin.sale.create({
      data: {
        tenantId,
        orderId: order.id,
        serie: 'B001',
        number: saleNumber,
        docType: 'boleta',
        subtotal,
        igv,
        total,
        status: 'issued',
        issuedAt: IN_PERIOD,
        createdAt: IN_PERIOD,
      },
    });
  };

  const seedWaste = async (
    ingredientId: string,
    qty: number,
    reason: string,
  ): Promise<void> => {
    await admin.inventoryMovement.create({
      data: {
        tenantId,
        ingredientId,
        type: 'waste',
        qty: new Prisma.Decimal(-qty),
        reason,
        createdAt: IN_PERIOD,
      },
    });
  };

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe(TRUNCATE);
    const tenant = await admin.tenant.create({
      data: { name: 'Motif', igvRate: 0.18 },
    });
    tenantId = tenant.id;
    const passwordHash = await hash(password, 4);
    await admin.user.create({
      data: {
        tenantId,
        email: 'owner@ops.pe',
        name: 'O',
        passwordHash,
        roles: ['owner'],
      },
    });
    await admin.user.create({
      data: {
        tenantId,
        email: 'staff@ops.pe',
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
    ownerToken = await login('owner@ops.pe');
    staffToken = await login('staff@ops.pe');

    zoneId = idSchema.parse(
      (await post('/api/zones', ownerToken, { name: 'Salón' }).expect(201))
        .body,
    ).data.id;

    // Insumos con stock + unitCost para la valoración de inventario.
    // Queso: unitCost 10, stock 5, sin mínimo → ok, valor 50.
    quesoId = idSchema.parse(
      (
        await post('/api/ingredients', ownerToken, {
          sku: 'QUE',
          name: 'Queso',
          type: 'raw',
          unit: 'kg',
          unitCost: 10,
        }).expect(201)
      ).body,
    ).data.id;
    const aguaInsumoId = idSchema.parse(
      (
        await post('/api/ingredients', ownerToken, {
          sku: 'AGU',
          name: 'Agua',
          type: 'raw',
          unit: 'l',
          unitCost: 2,
        }).expect(201)
      ).body,
    ).data.id;
    // Tomate: unitCost 3, stock 1 < minStock 5 → low (1 > 5·0.5=2.5? no, 1 ≤ 2.5 → critical).
    tomateId = idSchema.parse(
      (
        await post('/api/ingredients', ownerToken, {
          sku: 'TOM',
          name: 'Tomate',
          type: 'raw',
          unit: 'kg',
          unitCost: 3,
        }).expect(201)
      ).body,
    ).data.id;
    // Harina: unitCost 4, stock 3 < minStock 5, 3 > 5·0.5=2.5 → low.
    const harinaId = idSchema.parse(
      (
        await post('/api/ingredients', ownerToken, {
          sku: 'HAR',
          name: 'Harina',
          type: 'raw',
          unit: 'kg',
          unitCost: 4,
        }).expect(201)
      ).body,
    ).data.id;

    // Stock + mínimos directos (el endpoint de insumos no fija stock).
    await admin.ingredient.update({
      where: { id: quesoId },
      data: { stock: 5, minStock: 0 },
    });
    await admin.ingredient.update({
      where: { id: aguaInsumoId },
      data: { stock: 3, minStock: 0 },
    });
    await admin.ingredient.update({
      where: { id: tomateId },
      data: { stock: 1, minStock: 5 }, // critical (1 ≤ 2.5)
    });
    await admin.ingredient.update({
      where: { id: harinaId },
      data: { stock: 3, minStock: 5 }, // low (3 < 5, 3 > 2.5)
    });
    // totalStockValue = 5·10 + 3·2 + 1·3 + 3·4 = 50 + 6 + 3 + 12 = 71.
    // lowStockCount (stock<min) = tomate + harina = 2. criticalCount = tomate = 1.

    // Carta: Pizza precio 40 / costo ing. 10 (queso 1·10). Agua precio 10 / costo 2.
    const pizzaRecipe = idSchema.parse(
      (
        await post('/api/recipes', ownerToken, {
          name: 'Pizza',
          kind: 'dish',
          yield: 1,
          items: [{ ingredientId: quesoId, qty: 1 }],
        }).expect(201)
      ).body,
    ).data.id;
    const aguaRecipe = idSchema.parse(
      (
        await post('/api/recipes', ownerToken, {
          name: 'Agua receta',
          kind: 'dish',
          yield: 1,
          items: [{ ingredientId: aguaInsumoId, qty: 1 }],
        }).expect(201)
      ).body,
    ).data.id;
    pizzaId = idSchema.parse(
      (
        await post('/api/menu/items', ownerToken, {
          recipeId: pizzaRecipe,
          name: 'Pizza Margarita',
          price: 40,
        }).expect(201)
      ).body,
    ).data.id;
    aguaId = idSchema.parse(
      (
        await post('/api/menu/items', ownerToken, {
          recipeId: aguaRecipe,
          name: 'Agua Mineral, fría',
          price: 10,
        }).expect(201)
      ).body,
    ).data.id;

    // Ventas del período: 2 pizzas (80) + 3 aguas (30). unitsSold pizza 2, agua 3.
    await seedSale([
      { menuItemId: pizzaId, name: 'Pizza Margarita', qty: 2, unitPrice: 40 },
    ]);
    await seedSale([
      { menuItemId: aguaId, name: 'Agua Mineral, fría', qty: 3, unitPrice: 10 },
    ]);

    // Mermas con razones: Tomate -2 EXPIRED (cost 6), Queso -1 DAMAGED (cost 10),
    // Tomate -1 EXPIRED (cost 3). totalCost = 19, totalQty = 4.
    await seedWaste(tomateId, 2, 'EXPIRED');
    await seedWaste(quesoId, 1, 'DAMAGED');
    await seedWaste(tomateId, 1, 'EXPIRED');
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(TRUNCATE);
    await admin.$disconnect();
    await app.close();
  });

  // === HU-07-05 · Reporte de inventario ===
  it('HU-07-05: inventario valoriza el stock (totalStockValue, low/critical, status)', async () => {
    const view = inventorySchema.parse(
      (await get('/api/reports/inventory', ownerToken).expect(200)).body,
    ).data;
    expect(view.totalSkus).toBe(4);
    expect(view.totalStockValue).toBe('71.00'); // 50+6+3+12
    expect(view.lowStockCount).toBe(2); // tomate + harina (stock<min)
    expect(view.criticalCount).toBe(1); // tomate (1 ≤ 2.5)
    const byName = new Map(view.items.map((i) => [i.name, i]));
    expect(byName.get('Queso')?.stockValue).toBe('50.00');
    expect(byName.get('Queso')?.status).toBe('ok');
    expect(byName.get('Tomate')?.stockValue).toBe('3.00');
    expect(byName.get('Tomate')?.status).toBe('critical');
    expect(byName.get('Harina')?.status).toBe('low');
    expect(byName.get('Harina')?.stock).toBe('3.000');
    // items ordenados por nombre asc.
    expect(view.items.map((i) => i.name)).toEqual(
      [...view.items.map((i) => i.name)].sort(),
    );
  });

  // === HU-07-06 · Reporte de food cost ===
  it('HU-07-06: food cost global + por plato, orden desc por foodCostPct', async () => {
    const view = foodCostSchema.parse(
      (
        await get(`/api/reports/food-cost?period=${PERIOD}`, ownerToken).expect(
          200,
        )
      ).body,
    ).data;
    expect(view.period).toBe(PERIOD);
    expect(view.targetFoodCostPct).toBe('30.00');
    // overall = (10·2 + 2·3) / (80 + 30) · 100 = 26/110·100 = 23.64.
    expect(view.overallFoodCostPct).toBe('23.64');
    const pizza = view.dishes.find((d) => d.name === 'Pizza Margarita');
    const agua = view.dishes.find((d) => d.name === 'Agua Mineral, fría');
    expect(pizza?.foodCostPct).toBe('25.00'); // 10/40
    expect(pizza?.unitsSold).toBe(2);
    expect(pizza?.revenue).toBe('80.00');
    expect(agua?.foodCostPct).toBe('20.00'); // 2/10
    expect(agua?.unitsSold).toBe(3);
    expect(agua?.revenue).toBe('30.00');
    // orden desc por foodCostPct: pizza (25) antes que agua (20).
    const pizzaIdx = view.dishes.findIndex((d) => d.name === 'Pizza Margarita');
    const aguaIdx = view.dishes.findIndex(
      (d) => d.name === 'Agua Mineral, fría',
    );
    expect(pizzaIdx).toBeLessThan(aguaIdx);
  });

  // === HU-07-07 · Reporte de mermas ===
  it('HU-07-07: mermas agregadas por razón y por insumo + movimientos', async () => {
    const view = wasteSchema.parse(
      (
        await get(
          `/api/reports/waste?from=${WASTE_FROM}&to=${WASTE_TO}`,
          ownerToken,
        ).expect(200)
      ).body,
    ).data;
    expect(view.totalWasteQty).toBe('4.000'); // 2+1+1
    expect(view.totalWasteCost).toBe('19.00'); // 6+10+3
    // byReason: EXPIRED qty 3 cost 9; DAMAGED qty 1 cost 10.
    const byReason = new Map(view.byReason.map((r) => [r.reason, r]));
    expect(byReason.get('EXPIRED')?.qty).toBe('3.000');
    expect(byReason.get('EXPIRED')?.cost).toBe('9.00');
    expect(byReason.get('DAMAGED')?.cost).toBe('10.00');
    // byIngredient: Tomate qty 3 cost 9; Queso qty 1 cost 10.
    const byIng = new Map(view.byIngredient.map((i) => [i.name, i]));
    expect(byIng.get('Tomate')?.qty).toBe('3.000');
    expect(byIng.get('Tomate')?.cost).toBe('9.00');
    expect(byIng.get('Queso')?.cost).toBe('10.00');
    // movements: 3 mermas, qty como magnitud positiva.
    expect(view.movements).toHaveLength(3);
    expect(view.movements.every((m) => Number(m.qty) > 0)).toBe(true);
  });

  // === HU-07-10 · Exportación CSV ===
  it('HU-07-10: inventory CSV → text/csv + Content-Disposition + cabeceras', async () => {
    const res = await get(
      '/api/reports/inventory?format=csv',
      ownerToken,
    ).expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-type']).toContain('charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="inventory-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    const lines = res.text.split('\r\n');
    expect(lines[0]).toBe(
      'ingredientId,name,unit,stock,minStock,unitCost,stockValue,status',
    );
    // 4 insumos + cabecera (sin línea final vacía).
    expect(lines).toHaveLength(5);
    expect(res.text).toContain('Queso');
  });

  it('HU-07-10: food-cost CSV → cabeceras de platos', async () => {
    const res = await get(
      `/api/reports/food-cost?period=${PERIOD}&format=csv`,
      ownerToken,
    ).expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="food-cost-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    const lines = res.text.split('\r\n');
    expect(lines[0]).toBe(
      'name,sellPrice,ingredientCost,foodCostPct,unitsSold,revenue',
    );
    // El nombre con coma "Agua Mineral, fría" debe ir entrecomillado (RFC-4180).
    expect(res.text).toContain('"Agua Mineral, fría"');
  });

  it('HU-07-10: waste CSV → cabeceras de movimientos', async () => {
    const res = await get(
      `/api/reports/waste?from=${WASTE_FROM}&to=${WASTE_TO}&format=csv`,
      ownerToken,
    ).expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="waste-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    const lines = res.text.split('\r\n');
    expect(lines[0]).toBe(
      'id,ingredientId,ingredientName,qty,unit,reason,createdAt',
    );
    expect(lines).toHaveLength(4); // 3 mermas + cabecera
  });

  it('HU-07-10: sales CSV → cabeceras de la serie', async () => {
    const res = await get(
      `/api/reports/sales?from=${WASTE_FROM}&to=${WASTE_TO}&format=csv`,
      ownerToken,
    ).expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="sales-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    expect(res.text.split('\r\n')[0]).toBe('key,revenue,count');
  });

  // === RBAC ===
  it('staff → 403 en inventory/food-cost/waste (también con ?format=csv)', async () => {
    await get('/api/reports/inventory', staffToken).expect(403);
    await get(`/api/reports/food-cost?period=${PERIOD}`, staffToken).expect(
      403,
    );
    await get(
      `/api/reports/waste?from=${WASTE_FROM}&to=${WASTE_TO}`,
      staffToken,
    ).expect(403);
    await get('/api/reports/inventory?format=csv', staffToken).expect(403);
  });
});
