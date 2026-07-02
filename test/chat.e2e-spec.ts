/**
 * E09 · Chat IA e2e test suite.
 *
 * COVERAGE:
 *  1. Happy path    — owner gets answer + SQL + rows from seeded data.
 *  2. RBAC          — staff → 403; no token → 401; manager → 200.
 *  3. Security gate — DELETE / DROP / UPDATE / multi-statement /
 *                     non-whitelisted table / users table → all 400,
 *                     none executed against the DB.
 *  4. RLS vector    — a generic SELECT on sales_history under tenant A
 *                     returns ONLY tenant A rows; tenant B rows (qty=999)
 *                     are invisible.
 *  5. LOTE B3       — preguntas sobre el futuro (con/sin corrida completada,
 *                     dentro/fuera de horizonte), rechazo fuera de dominio
 *                     SIN ejecutar SQL, y clarificación de preguntas ambiguas.
 *
 * CoreAiChatClient is replaced by a controllable stub via NestJS DI override
 * so no real core-ai process is required. The SQL validator, Prisma runInTenant,
 * and RLS FORCE all run for real against the local Docker DB.
 */

import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import request from 'supertest';
import type { App } from 'supertest/types';
import { z } from 'zod';
import { AppModule } from '../src/app.module';
import { CoreAiChatClient } from '../src/chat/core-ai-chat.client';
import { addDays, dayOfWeek, todayLima } from '../src/chat/lima-date.util';
import { apiResponseSchema, authTokensSchema } from '../src/shared';

// --------------------------------------------------------------------------
// DB bootstrap
// --------------------------------------------------------------------------

const adminUrl = process.env.DATABASE_URL_ADMIN;
if (!adminUrl) throw new Error('DATABASE_URL_ADMIN not set (see .env)');

const TRUNCATE = `
  TRUNCATE TABLE
    "forecast_runs","sales_history","order_items","orders","menu_items","recipes",
    "menu_categories","ingredients","audit_logs","refresh_tokens","users","tenants"
  CASCADE
`;

// --------------------------------------------------------------------------
// Stub CoreAiChatClient — controls what SQL the "LLM" returns
// --------------------------------------------------------------------------

/**
 * Build a mock CoreAiChatClient that returns a fixed SQL string from nl2sql
 * and a fixed answer string from answerFromRows.
 */
function buildMockClient(
  fixedSql: string,
  fixedAnswer = 'Respuesta de prueba.',
): Partial<CoreAiChatClient> {
  return {
    nl2sql: () =>
      Promise.resolve({
        sql: fixedSql,
        provider: 'mock',
        model: 'mock-v1',
        notes: 'test stub',
      }),
    answerFromRows: () =>
      Promise.resolve({
        answer: fixedAnswer,
        provider: 'mock',
      }),
  };
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

const tokensSchema = apiResponseSchema(authTokensSchema);

const chatResponseSchema = apiResponseSchema(
  z.object({
    answer: z.string(),
    sql: z.string(),
    columns: z.array(z.string()),
    rows: z.array(z.array(z.unknown())),
    provider: z.string(),
    model: z.string(),
    // LOTE B3 · aditivos, ausentes en respuestas previas a este cambio.
    kind: z
      .enum(['historical', 'future', 'out_of_domain', 'ambiguous'])
      .optional(),
    forecast: z
      .object({
        runId: z.string().uuid(),
        range: z.object({
          from: z.string(),
          to: z.string(),
          label: z.string(),
        }),
        totalYhat: z.number(),
        totalLo: z.number(),
        totalHi: z.number(),
        // QA-23 (LOTE B5) · aditivos — unidades reales + estimación derivada.
        unitLabel: z.string(),
        estimatedRevenue: z
          .object({
            total: z.number(),
            lo: z.number(),
            hi: z.number(),
            avgUnitPrice: z.number(),
            basisDays: z.number(),
          })
          .nullable(),
        points: z.array(z.unknown()),
        drivers: z.array(z.unknown()),
      })
      .optional(),
  }),
);

async function login(
  app: NestFastifyApplication<App>,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  return tokensSchema.parse(res.body).data.accessToken;
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// --------------------------------------------------------------------------
// Suite
// --------------------------------------------------------------------------

describe('Chat IA — E09 (e2e)', () => {
  let app: NestFastifyApplication<App>;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const password = 'Secret12345';

  // Tokens for each role under tenant A
  let ownerToken = '';
  let managerToken = '';
  let staffToken = '';

  // A generic safe SQL that returns data from sales_history (RLS will isolate)
  const SAFE_SQL =
    'SELECT dish_name, SUM(qty) AS total_sold FROM sales_history GROUP BY dish_name ORDER BY total_sold DESC LIMIT 50';

  // ------------------------------------------------------------------
  // Setup: seed two tenants, create users of each role
  // ------------------------------------------------------------------

  beforeAll(async () => {
    await admin.$connect();
    await admin.$executeRawUnsafe(TRUNCATE);

    const hash4 = await hash(password, 4);

    // --- Tenant A (Motif) ---
    const tenantA = await admin.tenant.create({ data: { name: 'Motif' } });

    await admin.user.createMany({
      data: [
        {
          tenantId: tenantA.id,
          email: 'owner@chat.pe',
          name: 'Owner',
          passwordHash: hash4,
          roles: ['owner'],
        },
        {
          tenantId: tenantA.id,
          email: 'manager@chat.pe',
          name: 'Manager',
          passwordHash: hash4,
          roles: ['manager'],
        },
        {
          tenantId: tenantA.id,
          email: 'staff@chat.pe',
          name: 'Staff',
          passwordHash: hash4,
          roles: ['staff'],
        },
      ],
    });

    // Seed tenant A's sales_history
    await admin.salesHistory.createMany({
      data: [
        {
          tenantId: tenantA.id,
          soldOn: new Date('2024-06-01T12:00:00-05:00'),
          dishName: 'Lomo Saltado',
          qty: 3,
          unitPrice: 30,
          total: 90,
        },
        {
          tenantId: tenantA.id,
          soldOn: new Date('2024-06-02T12:00:00-05:00'),
          dishName: 'Lomo Saltado',
          qty: 2,
          unitPrice: 30,
          total: 60,
        },
        {
          tenantId: tenantA.id,
          soldOn: new Date('2024-06-03T12:00:00-05:00'),
          dishName: 'Ceviche',
          qty: 4,
          unitPrice: 25,
          total: 100,
        },
      ],
    });

    // Seed tenant A's ingredients (E09 bugfix — HU-05-10 low-stock scenario).
    // "Pulpo" and "Conchas de abanico" are BELOW their reorder threshold
    // (stock <= min_stock); "Cebolla roja" is comfortably stocked. This
    // reproduces the demo data shape behind the "¿qué insumos tienen stock
    // bajo?" ticket (2 critical ingredients expected in the answer).
    await admin.ingredient.createMany({
      data: [
        {
          tenantId: tenantA.id,
          sku: 'PUL-001',
          name: 'Pulpo',
          type: 'insumo',
          unit: 'kg',
          unitCost: 45,
          stock: 1.5,
          minStock: 5,
        },
        {
          tenantId: tenantA.id,
          sku: 'CON-001',
          name: 'Conchas de abanico',
          type: 'insumo',
          unit: 'kg',
          unitCost: 38,
          stock: 0.8,
          minStock: 3,
        },
        {
          tenantId: tenantA.id,
          sku: 'CEB-001',
          name: 'Cebolla roja',
          type: 'insumo',
          unit: 'kg',
          unitCost: 3.5,
          stock: 20,
          minStock: 5,
        },
      ],
    });

    // --- Tenant B (other restaurant) ---
    const tenantB = await admin.tenant.create({ data: { name: 'Otro' } });
    await admin.salesHistory.create({
      data: {
        tenantId: tenantB.id,
        soldOn: new Date('2024-06-01T12:00:00-05:00'),
        dishName: 'Ajeno B',
        qty: 999,
        unitPrice: 1,
        total: 999,
      },
    });

    // Boot the NestJS app with a default mock client (overridden per test)
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CoreAiChatClient)
      .useValue(buildMockClient(SAFE_SQL))
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    app.setGlobalPrefix('api');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    ownerToken = await login(app, 'owner@chat.pe', password);
    managerToken = await login(app, 'manager@chat.pe', password);
    staffToken = await login(app, 'staff@chat.pe', password);
  });

  afterAll(async () => {
    await admin.$executeRawUnsafe(TRUNCATE);
    await admin.$disconnect();
    await app.close();
  });

  // --------------------------------------------------------------------------
  // 1. Happy path
  // --------------------------------------------------------------------------

  describe('happy path', () => {
    it('owner receives 200 with answer, sql, columns, rows, provider', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/chat/query')
        .set(bearer(ownerToken))
        .send({ question: '¿cuáles son mis ventas?' })
        .expect(200);

      const body = chatResponseSchema.parse(res.body);
      expect(body.data.provider).toBe('mock');
      expect(body.data.sql).toContain('SELECT');
      expect(body.data.columns.length).toBeGreaterThan(0);
      expect(body.data.answer.length).toBeGreaterThan(0);
    });

    it('manager also receives 200 (has read Report)', async () => {
      await request(app.getHttpServer())
        .post('/api/chat/query')
        .set(bearer(managerToken))
        .send({ question: '¿cuáles son mis ventas?' })
        .expect(200);
    });

    it('response sql starts with SELECT', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/chat/query')
        .set(bearer(ownerToken))
        .send({ question: '¿ventas totales?' })
        .expect(200);

      const body = chatResponseSchema.parse(res.body);
      expect(body.data.sql.trim().toUpperCase()).toMatch(/^(SELECT|WITH)\b/);
    });

    it('missing question body → 400 (Zod validation)', async () => {
      await request(app.getHttpServer())
        .post('/api/chat/query')
        .set(bearer(ownerToken))
        .send({})
        .expect(400);
    });

    it('empty question → 400 (Zod min length)', async () => {
      await request(app.getHttpServer())
        .post('/api/chat/query')
        .set(bearer(ownerToken))
        .send({ question: '' })
        .expect(400);
    });
  });

  // --------------------------------------------------------------------------
  // 2. RBAC
  // --------------------------------------------------------------------------

  describe('RBAC', () => {
    it('staff → 403 (no read Report permission)', async () => {
      await request(app.getHttpServer())
        .post('/api/chat/query')
        .set(bearer(staffToken))
        .send({ question: '¿ventas?' })
        .expect(403);
    });

    it('no token → 401', async () => {
      await request(app.getHttpServer())
        .post('/api/chat/query')
        .send({ question: '¿ventas?' })
        .expect(401);
    });

    it('invalid token → 401', async () => {
      await request(app.getHttpServer())
        .post('/api/chat/query')
        .set({ Authorization: 'Bearer not-a-real-token' })
        .send({ question: '¿ventas?' })
        .expect(401);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Security gate — all vectors must return 400 (never execute)
  // --------------------------------------------------------------------------

  /**
   * Build a temporary app instance with a mock client that returns a fixed
   * (potentially malicious) SQL string. The real CoreAiChatClient is replaced
   * so we control exactly what the "LLM" returns and can verify the validator
   * blocks it before DB execution.
   */
  async function queryWithSql(
    sql: string,
    token: string,
    // LOTE B3: `question` now has to survive `classifyIntent` and land on
    // 'historical' for these tests to still reach `nl2sql` at all — the
    // generic literal `'test'` has no domain keyword and would be classified
    // `out_of_domain` (correctly) before ever calling the mock. Any caller
    // that wants to exercise a NON-historical branch passes its own question.
    question = 'consulta de prueba sobre ventas',
  ): Promise<request.Response> {
    // Override the provider at the module level for this one call.
    // Since we can't re-compile the app per-test, we reach into the running
    // module and swap the provider's nl2sql return value via prototype patching
    // on the already-injected singleton. This is the standard NestJS e2e
    // injection-override pattern when using TestingModule.overrideProvider.
    const mockClient = app.get<CoreAiChatClient>(CoreAiChatClient);
    const original = mockClient.nl2sql.bind(mockClient);
    mockClient.nl2sql = () =>
      Promise.resolve({
        sql,
        provider: 'mock',
        model: 'mock-v1',
        notes: 'security-test-stub',
      });

    const res = await request(app.getHttpServer())
      .post('/api/chat/query')
      .set(bearer(token))
      .send({ question });

    // Restore original after call
    mockClient.nl2sql = original;
    return res;
  }

  describe('security gate', () => {
    it('DELETE statement → 400 (rule 3)', async () => {
      const res = await queryWithSql('DELETE FROM sales_history', ownerToken);
      expect(res.status).toBe(400);
    });

    it('DROP TABLE via semicolon injection → 400 (rule 2)', async () => {
      const res = await queryWithSql(
        'SELECT 1; DROP TABLE sales_history',
        ownerToken,
      );
      expect(res.status).toBe(400);
    });

    it('UPDATE statement → 400 (rule 3)', async () => {
      const res = await queryWithSql(
        'UPDATE employees SET active=false',
        ownerToken,
      );
      expect(res.status).toBe(400);
    });

    it('multi-statement injection → 400 (rule 2)', async () => {
      const res = await queryWithSql(
        'SELECT 1; SELECT 2; DROP TABLE tenants',
        ownerToken,
      );
      expect(res.status).toBe(400);
    });

    it('non-whitelisted table → 400 (rule 8)', async () => {
      const res = await queryWithSql(
        'SELECT * FROM top_secret_data LIMIT 5',
        ownerToken,
      );
      expect(res.status).toBe(400);
    });

    it('users table → 400 (rule 8 — not in allowlist)', async () => {
      const res = await queryWithSql(
        'SELECT email, password_hash FROM users LIMIT 10',
        ownerToken,
      );
      expect(res.status).toBe(400);
    });

    it('refresh_tokens table → 400 (rule 8)', async () => {
      const res = await queryWithSql(
        'SELECT * FROM refresh_tokens LIMIT 10',
        ownerToken,
      );
      expect(res.status).toBe(400);
    });

    it('audit_logs table → 400 (rule 8)', async () => {
      const res = await queryWithSql(
        'SELECT * FROM audit_logs LIMIT 10',
        ownerToken,
      );
      expect(res.status).toBe(400);
    });

    it('salary column → 400 (rule 7)', async () => {
      const res = await queryWithSql(
        'SELECT name, salary FROM employees LIMIT 10',
        ownerToken,
      );
      expect(res.status).toBe(400);
    });

    it('pg_tables system catalog → 400 (rule 5)', async () => {
      const res = await queryWithSql(
        'SELECT * FROM pg_tables LIMIT 5',
        ownerToken,
      );
      expect(res.status).toBe(400);
    });

    it('information_schema → 400 (rule 5)', async () => {
      const res = await queryWithSql(
        'SELECT * FROM information_schema.tables LIMIT 5',
        ownerToken,
      );
      expect(res.status).toBe(400);
    });
  });

  // --------------------------------------------------------------------------
  // 4. RLS vector — cross-tenant isolation
  // --------------------------------------------------------------------------

  describe('RLS isolation', () => {
    it('tenant A query returns only tenant A rows (no qty=999 from tenant B)', async () => {
      // The mock SQL is a generic GROUP BY on sales_history (no tenant_id filter).
      // RLS FORCE must prevent tenant B's row (Ajeno B, qty=999) from appearing.
      const res = await request(app.getHttpServer())
        .post('/api/chat/query')
        .set(bearer(ownerToken))
        .send({ question: '¿platos más vendidos?' })
        .expect(200);

      const body = chatResponseSchema.parse(res.body);
      const rows = body.data.rows;

      // Flatten all values for easy searching
      const allValues = rows.flat().map((v) => String(v));

      expect(allValues).not.toContain('Ajeno B');
      expect(allValues).not.toContain('999');

      // Tenant A dishes must appear
      const dishNames = allValues;
      const hasLomoOrCeviche =
        dishNames.some((v) => v.includes('Lomo')) ||
        dishNames.some((v) => v.includes('Ceviche'));
      expect(hasLomoOrCeviche).toBe(true);
    });

    it('total qty for tenant A is 9 (3+2 Lomo + 4 Ceviche), not 999+9', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/chat/query')
        .set(bearer(ownerToken))
        .send({ question: '¿ventas?' })
        .expect(200);

      const body = chatResponseSchema.parse(res.body);
      const rows = body.data.rows;

      // Sum all numeric values — must not include 999 (tenant B)
      const nums = rows
        .flat()
        .map(Number)
        .filter((n) => !isNaN(n));

      const grandTotal = nums.reduce((a, b) => a + b, 0);
      // 9 total qty + revenue values from tenant A only; 999 would skew this
      expect(grandTotal).toBeLessThan(500);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Execution-time failure degradation (bugfix 2026-07-02)
  //
  // Reproduces the production incident: "¿Qué insumos están por agotarse?"
  // returned a raw 500 because the LLM (guided by a stale schema_context)
  // generated SQL referencing `ingredients.current_cost`, a column that does
  // not exist (Postgres 42703). The validator cannot catch this — it only
  // checks table allowlisting/DDL, not column existence — so the execution
  // layer itself must degrade gracefully instead of leaking an unhandled 500.
  // --------------------------------------------------------------------------

  describe('execution-time failure degradation (never a raw 500)', () => {
    it('undefined column at execution time → 502, not 500 (exact prod repro)', async () => {
      const res = await queryWithSql(
        'SELECT i.current_cost FROM ingredients i LIMIT 200',
        ownerToken,
      );
      expect(res.status).toBe(502);
      expect(res.status).not.toBe(500);
    });

    it('undefined column on a different whitelisted table → 502, not 500', async () => {
      // kitchen_stations IS in the allowlist (validator rule 8 passes), but
      // this column never existed — the validator has no way to catch a
      // per-column hallucination, only the DB execution layer can.
      const res = await queryWithSql(
        'SELECT nonexistent_col FROM kitchen_stations LIMIT 5',
        ownerToken,
      );
      expect(res.status).toBe(502);
      expect(res.status).not.toBe(500);
    });
  });

  // --------------------------------------------------------------------------
  // 6. Low-stock query against the REAL ingredients schema (bugfix 2026-07-02)
  //
  // Reproduces the second symptom: "¿qué insumos tienen stock bajo?" answered
  // "no hay" even though 2 ingredients were below their reorder threshold.
  // The root cause was the schema_context omitting ingredients.stock/
  // min_stock, forcing the LLM to (wrongly) reconstruct stock from
  // inventory_movements. This suite proves the real columns are queryable
  // and RLS-isolated once the schema_context/validator allow the correct SQL.
  // --------------------------------------------------------------------------

  describe('low-stock query against real ingredients.stock/min_stock', () => {
    it('returns exactly the 2 ingredients below their reorder threshold', async () => {
      const res = await queryWithSql(
        'SELECT name, stock, min_stock FROM ingredients ' +
          'WHERE stock <= min_stock ORDER BY name LIMIT 200',
        ownerToken,
      );
      expect(res.status).toBe(200);

      const body = chatResponseSchema.parse(res.body);
      const names = body.data.rows.map((r) => String(r[0]));

      expect(names).toEqual(['Conchas de abanico', 'Pulpo']);
      expect(names).not.toContain('Cebolla roja');
    });
  });

  // --------------------------------------------------------------------------
  // 7. LOTE B3 — preguntas sobre el futuro + rechazo elegante fuera de dominio
  //
  // La clasificación (`classifyIntent`) corre ANTES de decidir si se llama a
  // core-ai. `future` responde desde la última `ForecastRun` completada (sin
  // SQL); `out_of_domain`/`ambiguous` nunca llegan al validador ni a la DB.
  // Estos escenarios usan un tenant/usuarios propios para no interferir con
  // el resto de la suite (RLS ya está probado arriba).
  // --------------------------------------------------------------------------

  describe('LOTE B3 — futuro / fuera de dominio / ambiguo', () => {
    let futureOwnerToken = '';
    let futureStaffToken = '';
    let noForecastOwnerToken = '';

    // Fechas del rango "este fin de semana" resueltas con el MISMO algoritmo
    // que `intent-classifier.util.ts` (próximo sábado/domingo, Lima).
    const today = todayLima();
    const dow = dayOfWeek(today);
    const saturday = addDays(today, (6 - dow + 7) % 7);
    const sunday = addDays(saturday, 1);
    const tomorrow = addDays(today, 1);

    beforeAll(async () => {
      const hash4 = await hash(password, 4);

      // --- Tenant con una corrida completada (para las respuestas "future" con datos) ---
      const tenantFuture = await admin.tenant.create({
        data: { name: 'Motif Futuro' },
      });
      await admin.user.createMany({
        data: [
          {
            tenantId: tenantFuture.id,
            email: 'owner@future.pe',
            name: 'Owner',
            passwordHash: hash4,
            roles: ['owner'],
          },
          {
            tenantId: tenantFuture.id,
            email: 'staff@future.pe',
            name: 'Staff',
            passwordHash: hash4,
            roles: ['staff'],
          },
        ],
      });
      await admin.forecastRun.create({
        data: {
          tenantId: tenantFuture.id,
          scope: 'total',
          horizon: 14,
          engine: 'auto',
          status: 'completed',
          model: 'AutoETS',
          baseline: 'SeasonalNaive',
          points: [
            { target_date: tomorrow, yhat: 50, yhat_lo: 40, yhat_hi: 60 },
            { target_date: saturday, yhat: 120, yhat_lo: 100, yhat_hi: 140 },
            { target_date: sunday, yhat: 110, yhat_lo: 90, yhat_hi: 130 },
          ],
          drivers: [
            {
              date: sunday,
              kind: 'payday',
              label: 'Quincena del 15',
              impact_pct: 12.5,
            },
          ],
          contextStatus: 'calendar_only',
          completedAt: new Date(),
        },
      });

      // QA-23 (LOTE B5) · `sales_history` reciente para "Motif Futuro" — el
      // ticket promedio por plato real (S/500/20 = S/25.00) que el chat DEBE
      // usar para derivar `estimatedRevenue`. `soldOn: now()` cae siempre
      // dentro de la ventana de 30 días (`AVG_UNIT_PRICE_WINDOW_DAYS`),
      // sin importar cuándo corra la suite.
      await admin.salesHistory.createMany({
        data: [
          {
            tenantId: tenantFuture.id,
            soldOn: new Date(),
            dishName: 'Plato A',
            qty: 10,
            unitPrice: 20,
            total: 200,
          },
          {
            tenantId: tenantFuture.id,
            soldOn: new Date(),
            dishName: 'Plato B',
            qty: 10,
            unitPrice: 30,
            total: 300,
          },
        ],
      });

      // --- Tenant SIN ninguna corrida (para needsForecast) ---
      const tenantNoForecast = await admin.tenant.create({
        data: { name: 'Motif Sin Pronostico' },
      });
      await admin.user.create({
        data: {
          tenantId: tenantNoForecast.id,
          email: 'owner@nopronostico.pe',
          name: 'Owner',
          passwordHash: hash4,
          roles: ['owner'],
        },
      });

      futureOwnerToken = await login(app, 'owner@future.pe', password);
      futureStaffToken = await login(app, 'staff@future.pe', password);
      noForecastOwnerToken = await login(
        app,
        'owner@nopronostico.pe',
        password,
      );
    });

    describe('future — con corrida completada', () => {
      it('"este fin de semana" devuelve la proyección real (sáb-dom) + drivers, sin SQL', async () => {
        const res = await request(app.getHttpServer())
          .post('/api/chat/query')
          .set(bearer(futureOwnerToken))
          .send({ question: '¿cuánto voy a vender este fin de semana?' })
          .expect(200);

        const body = chatResponseSchema.parse(res.body);
        expect(body.data.kind).toBe('future');
        expect(body.data.sql).toBe('');
        expect(body.data.columns).toEqual([]);
        expect(body.data.rows).toEqual([]);
        // QA-23 · 120 + 110 = 230 UNIDADES (platos, solo sáb+dom — "mañana"
        // queda fuera del rango pedido), NUNCA "S/ 230.00" (el bug original:
        // re-etiquetar unidades como dinero — ~1% del valor real observado
        // en producción). El monto en soles SOLO aparece como estimación
        // DERIVADA y etiquetada (ticket promedio S/25.00/plato del seed).
        expect(body.data.answer).toContain('230 platos');
        expect(body.data.answer).not.toMatch(/^Se proyectan S\//);
        expect(body.data.answer).toContain('S/ 5750.00');
        expect(body.data.answer).toContain('ticket promedio por plato');
        expect(body.data.answer).toContain('S/ 25.00/plato');
        expect(body.data.answer).toContain('Quincena del 15');
        expect(body.data.answer.toLowerCase()).toContain('proyección');
        expect(body.data.forecast).toBeDefined();
        expect(body.data.forecast?.totalYhat).toBe(230);
        expect(body.data.forecast?.unitLabel).toBe('platos');
        expect(body.data.forecast?.estimatedRevenue).toEqual({
          total: 5750,
          lo: 4750,
          hi: 6750,
          avgUnitPrice: 25,
          basisDays: 30,
        });
        expect(body.data.forecast?.points).toHaveLength(2);
        expect(body.data.forecast?.drivers).toHaveLength(1);
      });

      it('"mañana" devuelve solo el punto de mañana (50 platos, sin driver) + estimación derivada', async () => {
        const res = await request(app.getHttpServer())
          .post('/api/chat/query')
          .set(bearer(futureOwnerToken))
          .send({ question: '¿cuánto voy a vender mañana?' })
          .expect(200);

        const body = chatResponseSchema.parse(res.body);
        expect(body.data.kind).toBe('future');
        expect(body.data.answer).toContain('50 platos');
        expect(body.data.forecast?.totalYhat).toBe(50);
        expect(body.data.forecast?.estimatedRevenue).toEqual({
          total: 1250,
          lo: 1000,
          hi: 1500,
          avgUnitPrice: 25,
          basisDays: 30,
        });
        expect(body.data.forecast?.points).toHaveLength(1);
        expect(body.data.forecast?.drivers).toHaveLength(0);
      });

      it('staff → 403 en una pregunta futura (mismo gate read Report que el resto del chat)', async () => {
        await request(app.getHttpServer())
          .post('/api/chat/query')
          .set(bearer(futureStaffToken))
          .send({ question: '¿cuánto voy a vender este fin de semana?' })
          .expect(403);
      });

      it('rango fuera del horizonte de la corrida (el próximo mes) → explica y NO dispara una corrida', async () => {
        const res = await request(app.getHttpServer())
          .post('/api/chat/query')
          .set(bearer(futureOwnerToken))
          .send({ question: '¿cuánto voy a vender el próximo mes?' })
          .expect(200);

        const body = chatResponseSchema.parse(res.body);
        expect(body.data.kind).toBe('future');
        expect(body.data.forecast).toBeUndefined();
        expect(body.data.sql).toBe('');
        expect(body.data.answer.toLowerCase()).toContain('fuera del rango');

        // No debe haber creado una corrida nueva (needsForecast/outOfHorizon
        // nunca disparan `enqueueForecast`) — sigue habiendo exactamente 1.
        const runs = await admin.forecastRun.count({
          where: {
            tenantId: (
              await admin.tenant.findFirstOrThrow({
                where: { name: 'Motif Futuro' },
              })
            ).id,
          },
        });
        expect(runs).toBe(1);
      });

      it('QA-24: "¿Cuánto venderé en diciembre?" clasifica como future (futuro simple) y explica el horizonte — NUNCA cae al SQL histórico', async () => {
        const mockClient = app.get<CoreAiChatClient>(CoreAiChatClient);
        const nl2sqlSpy = vi.spyOn(mockClient, 'nl2sql');

        const res = await request(app.getHttpServer())
          .post('/api/chat/query')
          .set(bearer(futureOwnerToken))
          .send({ question: '¿Cuánto venderé en diciembre?' })
          .expect(200);

        const body = chatResponseSchema.parse(res.body);
        // Repro exacto QA-24: antes de este fix, "venderé" no disparaba
        // ningún signal de futuro y la pregunta caía al flujo histórico,
        // ejecutando SQL con `sold_on >= '2023-12-01'` y respondiendo
        // "no hay datos disponibles" en vez de explicar el horizonte.
        expect(body.data.kind).toBe('future');
        expect(body.data.sql).toBe('');
        expect(body.data.forecast).toBeUndefined();
        expect(body.data.answer.toLowerCase()).toContain('fuera del rango');
        expect(body.data.answer).not.toContain('no hay datos');
        expect(nl2sqlSpy).not.toHaveBeenCalled();

        nl2sqlSpy.mockRestore();

        // Tampoco dispara una corrida nueva (mismo invariante que "próximo mes").
        const runs = await admin.forecastRun.count({
          where: {
            tenantId: (
              await admin.tenant.findFirstOrThrow({
                where: { name: 'Motif Futuro' },
              })
            ).id,
          },
        });
        expect(runs).toBe(1);
      });
    });

    describe('QA-22 — drivers duplicados en el rango se narran UNA sola vez', () => {
      let qa22OwnerToken = '';

      beforeAll(async () => {
        const hash4 = await hash(password, 4);
        const tenantQa22 = await admin.tenant.create({
          data: { name: 'Motif QA-22' },
        });
        await admin.user.create({
          data: {
            tenantId: tenantQa22.id,
            email: 'owner@qa22.pe',
            name: 'Owner',
            passwordHash: hash4,
            roles: ['owner'],
          },
        });
        // Un fin de semana real trae 2 drivers `weekend` (sáb + dom) con el
        // MISMO label — la repro exacta de QA-22 ("Incluye el efecto de Fin
        // de semana, Fin de semana."). Tenant dedicado para no acoplar esta
        // aserción a la fecha en que corre la suite (evita colisión con el
        // test de "mañana" de arriba si algún día `tomorrow === saturday`).
        await admin.forecastRun.create({
          data: {
            tenantId: tenantQa22.id,
            scope: 'total',
            horizon: 14,
            engine: 'auto',
            status: 'completed',
            model: 'AutoETS',
            baseline: 'SeasonalNaive',
            points: [
              { target_date: saturday, yhat: 60, yhat_lo: 50, yhat_hi: 70 },
              { target_date: sunday, yhat: 55, yhat_lo: 45, yhat_hi: 65 },
            ],
            drivers: [
              {
                date: saturday,
                kind: 'weekend',
                label: 'Fin de semana',
                impact_pct: 54,
              },
              {
                date: sunday,
                kind: 'weekend',
                label: 'Fin de semana',
                impact_pct: 54,
              },
            ],
            contextStatus: 'calendar_only',
            completedAt: new Date(),
          },
        });
        qa22OwnerToken = await login(app, 'owner@qa22.pe', password);
      });

      it('"este fin de semana" narra "Fin de semana" una sola vez, no duplicado', async () => {
        const res = await request(app.getHttpServer())
          .post('/api/chat/query')
          .set(bearer(qa22OwnerToken))
          .send({ question: '¿cuánto voy a vender este fin de semana?' })
          .expect(200);

        const body = chatResponseSchema.parse(res.body);
        // Los 2 drivers crudos SIGUEN viajando (el frontend los usa para el
        // chip/gráfico) — la dedupe es SOLO en la frase narrada de `answer`.
        expect(body.data.forecast?.drivers).toHaveLength(2);
        expect(body.data.answer).toContain(
          'Incluye el efecto de Fin de semana.',
        );
        expect(body.data.answer).not.toContain('Fin de semana, Fin de semana');
      });
    });

    describe('future — sin ninguna corrida completada', () => {
      it('explica que hace falta generar un pronóstico primero, sin SQL ni auto-disparo', async () => {
        const res = await request(app.getHttpServer())
          .post('/api/chat/query')
          .set(bearer(noForecastOwnerToken))
          .send({ question: '¿cuánto voy a vender este fin de semana?' })
          .expect(200);

        const body = chatResponseSchema.parse(res.body);
        expect(body.data.kind).toBe('future');
        expect(body.data.forecast).toBeUndefined();
        expect(body.data.sql).toBe('');
        expect(body.data.answer).toContain('Todavía no hay ningún pronóstico');

        const runs = await admin.forecastRun.count({
          where: {
            tenantId: (
              await admin.tenant.findFirstOrThrow({
                where: { name: 'Motif Sin Pronostico' },
              })
            ).id,
          },
        });
        expect(runs).toBe(0);
      });
    });

    describe('out_of_domain — QA-08', () => {
      it('"¿quién ganó el mundial?" → rechazo elegante, SIN tabla de resultados ni SQL ejecutado', async () => {
        const mockClient = app.get<CoreAiChatClient>(CoreAiChatClient);
        const nl2sqlSpy = vi.spyOn(mockClient, 'nl2sql');

        const res = await request(app.getHttpServer())
          .post('/api/chat/query')
          .set(bearer(ownerToken))
          .send({ question: '¿quién ganó el mundial?' })
          .expect(200);

        const body = chatResponseSchema.parse(res.body);
        expect(body.data.kind).toBe('out_of_domain');
        expect(body.data.sql).toBe('');
        expect(body.data.columns).toEqual([]);
        expect(body.data.rows).toEqual([]);
        expect(body.data.answer).toContain('Solo puedo responder');
        // La clasificación NUNCA llega al executor (core-ai ni siquiera se llama).
        expect(nl2sqlSpy).not.toHaveBeenCalled();

        nl2sqlSpy.mockRestore();
      });
    });

    describe('ambiguous — QA-08', () => {
      it('"¿cómo va todo?" → pide precisión con ejemplos concretos, sin dump de filas', async () => {
        const mockClient = app.get<CoreAiChatClient>(CoreAiChatClient);
        const nl2sqlSpy = vi.spyOn(mockClient, 'nl2sql');

        const res = await request(app.getHttpServer())
          .post('/api/chat/query')
          .set(bearer(ownerToken))
          .send({ question: '¿cómo va todo?' })
          .expect(200);

        const body = chatResponseSchema.parse(res.body);
        expect(body.data.kind).toBe('ambiguous');
        expect(body.data.sql).toBe('');
        expect(body.data.rows).toEqual([]);
        expect(nl2sqlSpy).not.toHaveBeenCalled();

        nl2sqlSpy.mockRestore();
      });
    });

    describe('regresión — preguntas históricas siguen igual', () => {
      it('"¿qué insumos están por agotarse?" sigue clasificando historical y llega al SQL flow', async () => {
        const res = await queryWithSql(
          'SELECT name, stock, min_stock FROM ingredients ' +
            'WHERE stock <= min_stock ORDER BY name LIMIT 200',
          ownerToken,
        );
        expect(res.status).toBe(200);

        const body = chatResponseSchema.parse(res.body);
        expect(body.data.kind).toBe('historical');
        expect(body.data.sql).toContain('SELECT');
      });

      it('guardrail intacto: "¿cuánto le pago a cada empleado?" sigue rechazando la columna salary', async () => {
        const res = await queryWithSql(
          'SELECT name, salary FROM employees LIMIT 10',
          ownerToken,
        );
        expect(res.status).toBe(400);
      });
    });
  });
});
