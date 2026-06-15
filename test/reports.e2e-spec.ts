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
  'TRUNCATE TABLE "costing_closes","overhead_costs","inventory_movements","cash_closes","payments","sales","order_items","orders","dining_tables","zones","menu_modifiers","menu_availability","menu_items","menu_categories","recipe_versions","recipe_items","recipes","product_suppliers","suppliers","ingredients","categories","units_of_measure","audit_logs","refresh_tokens","users","tenants" CASCADE';

// Ventana de "hoy" (los dashboards por defecto usan el día local de Lima). Las
// ventas de hoy se siembran "hace 5 min" (dentro de [medianoche Lima, now]); las
// del histórico de 7 días, hace 2 días. La ventana explícita (from/to) que usan
// los tests de totales exactos abarca holgadamente ambas siembras.
const now = Date.now();
const TODAY = new Date(now - 5 * 60_000); // hace 5 minutos → hoy
const TWO_DAYS_AGO = new Date(now - 2 * 24 * 3_600_000); // histórico 7d
const WINDOW_FROM = new Date(now - 6 * 24 * 3_600_000).toISOString(); // hace 6 días
const WINDOW_TO = new Date(now + 60_000).toISOString(); // +1 min (cubre "hoy")

describe('Reportes/Dashboards — HU-07-01/02/03/04/08 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';
  const tokensSchema = apiResponseSchema(authTokensSchema);
  const idSchema = apiResponseSchema(z.object({ id: z.uuid() }));

  const byMethodSchema = z.object({
    cash: z.string(),
    card: z.string(),
    yape: z.string(),
    plin: z.string(),
  });
  const cashierSchema = apiResponseSchema(
    z.object({
      date: z.string(),
      salesCount: z.number(),
      voidCount: z.number(),
      totalCollected: z.string(),
      byMethod: byMethodSchema,
      avgTicket: z.string(),
    }),
  );
  const topDishSchema = z.object({
    name: z.string(),
    qty: z.number(),
    revenue: z.string(),
  });
  const managerSchema = apiResponseSchema(
    z.object({
      date: z.string(),
      salesToday: z.number(),
      revenueToday: z.string(),
      openTables: z.number(),
      ordersOpen: z.number(),
      itemsInKitchen: z.number(),
      lowStockCount: z.number(),
      topDishesToday: z.array(topDishSchema),
    }),
  );
  const adminSchema = apiResponseSchema(
    z.object({
      date: z.string(),
      revenueToday: z.string(),
      revenue7d: z.string(),
      ordersToday: z.number(),
      avgTicket: z.string(),
      grossMarginPct: z.string(),
      topDishes: z.array(topDishSchema.extend({ contribution: z.string() })),
      lowStockCount: z.number(),
      salesByDay7d: z.array(z.object({ day: z.string(), revenue: z.string() })),
    }),
  );
  const salesReportSchema = apiResponseSchema(
    z.object({
      from: z.string(),
      to: z.string(),
      totalRevenue: z.string(),
      salesCount: z.number(),
      avgTicket: z.string(),
      byMethod: byMethodSchema,
      byDocType: z.object({ boleta: z.string(), factura: z.string() }),
      series: z.array(
        z.object({
          key: z.string(),
          revenue: z.string(),
          count: z.number(),
        }),
      ),
    }),
  );
  const paretoSchema = apiResponseSchema(
    z.object({
      totalRevenue: z.string(),
      items: z.array(
        z.object({
          name: z.string(),
          qty: z.number(),
          revenue: z.string(),
          revenuePct: z.string(),
          cumulativePct: z.string(),
          abcClass: z.enum(['A', 'B', 'C']),
        }),
      ),
    }),
  );

  let ownerToken = '';
  let staffToken = '';
  let tenantId = '';
  let pizzaId = ''; // precio 40, costo ingredientes 10
  let aguaId = ''; // precio 10, costo ingredientes 2

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

  // Siembra DIRECTA de una venta emitida (issued) con N pagos por método.
  let saleNumber = 0;
  const seedSale = async (params: {
    when: Date;
    docType: 'boleta' | 'factura';
    lines: {
      menuItemId: string;
      name: string;
      qty: number;
      unitPrice: number;
    }[];
    payments: { method: string; amount: number }[];
    status?: 'issued' | 'void';
    tableStatus?: string;
    orderStatus?: string;
  }): Promise<void> => {
    const total = params.lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
    const subtotal = Math.round((total / 1.18) * 100) / 100;
    const igv = Math.round((total - subtotal) * 100) / 100;
    const table = await admin.diningTable.create({
      data: {
        tenantId,
        zoneId,
        code: `M${++saleNumber}`,
        capacity: 8,
        status: params.tableStatus ?? 'free',
      },
    });
    const order = await admin.order.create({
      data: {
        tenantId,
        tableId: table.id,
        guests: 2,
        status: params.orderStatus ?? 'paid',
        openedAt: params.when,
        createdAt: params.when,
      },
    });
    for (const l of params.lines) {
      await admin.orderItem.create({
        data: {
          tenantId,
          orderId: order.id,
          menuItemId: l.menuItemId,
          name: l.name,
          qty: l.qty,
          unitPrice: l.unitPrice,
          createdAt: params.when,
        },
      });
    }
    const sale = await admin.sale.create({
      data: {
        tenantId,
        orderId: order.id,
        serie: params.docType === 'factura' ? 'F001' : 'B001',
        number: saleNumber,
        docType: params.docType,
        subtotal,
        igv,
        total,
        status: params.status ?? 'issued',
        issuedAt: params.when,
        createdAt: params.when,
      },
    });
    for (const p of params.payments) {
      await admin.payment.create({
        data: {
          tenantId,
          saleId: sale.id,
          method: p.method,
          amount: p.amount,
          createdAt: params.when,
        },
      });
    }
  };

  let zoneId = '';

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
        email: 'owner@rep.pe',
        name: 'O',
        passwordHash,
        roles: ['owner'],
      },
    });
    await admin.user.create({
      data: {
        tenantId,
        email: 'staff@rep.pe',
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
    ownerToken = await login('owner@rep.pe');
    staffToken = await login('staff@rep.pe');

    // Salón + carta. Pizza: insumo unitCost 10 → receta 10 → plato precio 40.
    // Agua: insumo unitCost 2 → receta 2 → plato precio 10.
    zoneId = idSchema.parse(
      (await post('/api/zones', ownerToken, { name: 'Salón' }).expect(201))
        .body,
    ).data.id;
    const quesoId = idSchema.parse(
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
    // Insumo bajo mínimo → lowStockCount = 1 (stock 1 < minStock 5).
    await post('/api/ingredients', ownerToken, {
      sku: 'TOM',
      name: 'Tomate',
      type: 'raw',
      unit: 'kg',
      unitCost: 3,
    }).expect(201);
    const tomate = await admin.ingredient.findFirstOrThrow({
      where: { tenantId, sku: 'TOM' },
    });
    await admin.ingredient.update({
      where: { id: tomate.id },
      data: { stock: 1, minStock: 5 },
    });

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
          name: 'Agua Mineral',
          price: 10,
        }).expect(201)
      ).body,
    ).data.id;

    // === Ventas de HOY (4 métodos) ===
    // Venta 1: 2 pizzas (80) + 1 agua (10) = 90, pago cash.
    await seedSale({
      when: TODAY,
      docType: 'boleta',
      lines: [
        { menuItemId: pizzaId, name: 'Pizza Margarita', qty: 2, unitPrice: 40 },
        { menuItemId: aguaId, name: 'Agua Mineral', qty: 1, unitPrice: 10 },
      ],
      payments: [{ method: 'cash', amount: 90 }],
    });
    // Venta 2: 1 pizza (40), pago card.
    await seedSale({
      when: TODAY,
      docType: 'boleta',
      lines: [
        { menuItemId: pizzaId, name: 'Pizza Margarita', qty: 1, unitPrice: 40 },
      ],
      payments: [{ method: 'card', amount: 40 }],
    });
    // Venta 3: 3 aguas (30), pago yape.
    await seedSale({
      when: TODAY,
      docType: 'factura',
      lines: [
        { menuItemId: aguaId, name: 'Agua Mineral', qty: 3, unitPrice: 10 },
      ],
      payments: [{ method: 'yape', amount: 30 }],
    });
    // Venta 4: 1 pizza (40), pago MIXTO plin 20 + cash 20.
    await seedSale({
      when: TODAY,
      docType: 'boleta',
      lines: [
        { menuItemId: pizzaId, name: 'Pizza Margarita', qty: 1, unitPrice: 40 },
      ],
      payments: [
        { method: 'plin', amount: 20 },
        { method: 'cash', amount: 20 },
      ],
    });
    // Venta ANULADA de hoy (no suma totales; cuenta en voidCount).
    await seedSale({
      when: TODAY,
      docType: 'boleta',
      lines: [
        { menuItemId: pizzaId, name: 'Pizza Margarita', qty: 1, unitPrice: 40 },
      ],
      payments: [{ method: 'cash', amount: 40 }],
      status: 'void',
    });
    // Venta de HACE 2 DÍAS (para revenue7d / salesByDay7d): 1 pizza (40) cash.
    await seedSale({
      when: TWO_DAYS_AGO,
      docType: 'boleta',
      lines: [
        { menuItemId: pizzaId, name: 'Pizza Margarita', qty: 1, unitPrice: 40 },
      ],
      payments: [{ method: 'cash', amount: 40 }],
    });

    // Estado operativo para el dashboard del gerente: 1 mesa ocupada con orden
    // abierta y 2 ítems en cocina (pending + preparing).
    const openTable = await admin.diningTable.create({
      data: {
        tenantId,
        zoneId,
        code: 'OPEN1',
        capacity: 4,
        status: 'occupied',
      },
    });
    const openOrder = await admin.order.create({
      data: {
        tenantId,
        tableId: openTable.id,
        guests: 2,
        status: 'sent_to_kitchen',
        openedAt: TODAY,
      },
    });
    await admin.orderItem.create({
      data: {
        tenantId,
        orderId: openOrder.id,
        menuItemId: pizzaId,
        name: 'Pizza Margarita',
        qty: 1,
        unitPrice: 40,
        status: 'pending',
      },
    });
    await admin.orderItem.create({
      data: {
        tenantId,
        orderId: openOrder.id,
        menuItemId: aguaId,
        name: 'Agua Mineral',
        qty: 1,
        unitPrice: 10,
        status: 'preparing',
      },
    });
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(TRUNCATE);
    await admin.$disconnect();
    await app.close();
  });

  // === HU-07-03 · Dashboard de cajero ===
  it('HU-07-03: cajero ve caja del día (totales + byMethod + anulaciones)', async () => {
    const view = cashierSchema.parse(
      (await get('/api/reports/dashboard/cashier', staffToken).expect(200))
        .body,
    ).data;
    // 4 ventas emitidas hoy: 90 + 40 + 30 + 40 = 200.
    expect(view.salesCount).toBe(4);
    expect(view.voidCount).toBe(1);
    expect(view.totalCollected).toBe('200.00');
    // byMethod: cash = 90 + 20 = 110; card 40; yape 30; plin 20.
    expect(view.byMethod.cash).toBe('110.00');
    expect(view.byMethod.card).toBe('40.00');
    expect(view.byMethod.yape).toBe('30.00');
    expect(view.byMethod.plin).toBe('20.00');
    // avgTicket = 200 / 4 = 50.
    expect(view.avgTicket).toBe('50.00');
    // suma de byMethod == totalCollected
    const sum =
      Number(view.byMethod.cash) +
      Number(view.byMethod.card) +
      Number(view.byMethod.yape) +
      Number(view.byMethod.plin);
    expect(sum).toBeCloseTo(Number(view.totalCollected), 2);
  });

  // === HU-07-02 · Dashboard de gerente ===
  it('HU-07-02: gerente ve operativo de hoy (revenueToday, topDishes, cocina, stock)', async () => {
    const view = managerSchema.parse(
      (await get('/api/reports/dashboard/manager', ownerToken).expect(200))
        .body,
    ).data;
    expect(view.salesToday).toBe(4);
    expect(view.revenueToday).toBe('200.00');
    expect(view.itemsInKitchen).toBe(2); // pending + preparing
    expect(view.ordersOpen).toBe(1); // la orden abierta sembrada
    expect(view.openTables).toBeGreaterThanOrEqual(1); // mesa ocupada
    expect(view.lowStockCount).toBe(1); // tomate 1 < 5
    // top platos de hoy: pizza (4·40=160) por encima de agua (4·10=40).
    expect(view.topDishesToday[0].name).toBe('Pizza Margarita');
    expect(view.topDishesToday[0].qty).toBe(4);
    expect(view.topDishesToday[0].revenue).toBe('160.00');
    expect(view.topDishesToday[1].name).toBe('Agua Mineral');
    expect(view.topDishesToday[1].revenue).toBe('40.00');
  });

  // === HU-07-01 · Dashboard de admin ===
  it('HU-07-01: admin ve ejecutivo (revenueToday/7d, margen, salesByDay7d, contribución)', async () => {
    const view = adminSchema.parse(
      (await get('/api/reports/dashboard/admin', ownerToken).expect(200)).body,
    ).data;
    expect(view.revenueToday).toBe('200.00');
    expect(view.ordersToday).toBe(4);
    expect(view.avgTicket).toBe('50.00');
    // revenue7d incluye también la venta de hace 2 días (40) → 240.
    expect(view.revenue7d).toBe('240.00');
    // salesByDay7d: 7 días ascendentes; el último = hoy con 200.
    expect(view.salesByDay7d).toHaveLength(7);
    expect(view.salesByDay7d[6].revenue).toBe('200.00');
    expect([...view.salesByDay7d].map((d) => d.day).sort()).toEqual(
      view.salesByDay7d.map((d) => d.day),
    );
    // grossMarginPct y contribución son strings; pizza top con contribución
    // = revenue (160) − costo ingredientes (4·10=40) = 120.00.
    expect(typeof view.grossMarginPct).toBe('string');
    const pizza = view.topDishes.find((d) => d.name === 'Pizza Margarita');
    expect(pizza?.contribution).toBe('120.00');
  });

  // === HU-07-04 · Reporte de ventas ===
  it('HU-07-04: reporte de ventas groupBy=method → byMethod suma cuadra', async () => {
    const view = salesReportSchema.parse(
      (
        await get(
          `/api/reports/sales?from=${WINDOW_FROM}&to=${WINDOW_TO}&groupBy=method`,
          ownerToken,
        ).expect(200)
      ).body,
    ).data;
    // Ventana de 6 días: 5 ventas emitidas (4 hoy + 1 hace 2 días) = 240.
    expect(view.salesCount).toBe(5);
    expect(view.totalRevenue).toBe('240.00');
    // series por método: revenue de cada punto = byMethod del método.
    const byKey = new Map(view.series.map((s) => [s.key, s]));
    expect(byKey.get('cash')?.revenue).toBe(view.byMethod.cash);
    expect(byKey.get('card')?.revenue).toBe(view.byMethod.card);
    expect(byKey.get('yape')?.revenue).toBe(view.byMethod.yape);
    expect(byKey.get('plin')?.revenue).toBe(view.byMethod.plin);
    // suma de revenue de la serie == totalRevenue.
    const seriesSum = view.series.reduce((s, p) => s + Number(p.revenue), 0);
    expect(seriesSum).toBeCloseTo(Number(view.totalRevenue), 2);
    // byDocType: boleta = 90+40+40+40 = 210; factura = 30.
    expect(view.byDocType.boleta).toBe('210.00');
    expect(view.byDocType.factura).toBe('30.00');
  });

  it('HU-07-04: reporte groupBy=day → serie por día ascendente y cuadra', async () => {
    const view = salesReportSchema.parse(
      (
        await get(
          `/api/reports/sales?from=${WINDOW_FROM}&to=${WINDOW_TO}&groupBy=day`,
          ownerToken,
        ).expect(200)
      ).body,
    ).data;
    // 2 días con ventas (hoy + hace 2 días).
    expect(view.series.length).toBe(2);
    expect([...view.series].map((s) => s.key).sort()).toEqual(
      view.series.map((s) => s.key),
    );
    const seriesSum = view.series.reduce((s, p) => s + Number(p.revenue), 0);
    expect(seriesSum).toBeCloseTo(240, 2);
  });

  // === HU-07-08 · Pareto de platos ===
  it('HU-07-08: Pareto ordena por revenue, cumulativePct ↑ a ~100, asigna ABC', async () => {
    const view = paretoSchema.parse(
      (
        await get(
          `/api/reports/pareto-dishes?from=${WINDOW_FROM}&to=${WINDOW_TO}`,
          ownerToken,
        ).expect(200)
      ).body,
    ).data;
    // 2 platos: pizza (revenue 200 = 5·40) y agua (revenue 40 = 4·10) → total 240.
    expect(view.totalRevenue).toBe('240.00');
    expect(view.items).toHaveLength(2);
    // ordenado desc por revenue: pizza primero.
    expect(view.items[0].name).toBe('Pizza Margarita');
    expect(view.items[0].revenue).toBe('200.00');
    // cumulativePct ascendente y el último ~100.
    const cumulatives = view.items.map((i) => Number(i.cumulativePct));
    expect([...cumulatives].sort((a, b) => a - b)).toEqual(cumulatives);
    expect(cumulatives[cumulatives.length - 1]).toBeCloseTo(100, 1);
    // pizza = 200/240 = 83.33% acumulado > 80 → clase B; agua cierra en 100 → C.
    expect(view.items[0].abcClass).toBe('B');
    expect(view.items[1].abcClass).toBe('C');
  });

  // === RBAC ===
  it('staff → 403 en admin/manager/sales/pareto; 200 en cashier', async () => {
    await get('/api/reports/dashboard/admin', staffToken).expect(403);
    await get('/api/reports/dashboard/manager', staffToken).expect(403);
    await get('/api/reports/sales', staffToken).expect(403);
    await get('/api/reports/pareto-dishes', staffToken).expect(403);
    await get('/api/reports/dashboard/cashier', staffToken).expect(200);
  });
});
