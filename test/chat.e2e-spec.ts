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
import { apiResponseSchema, authTokensSchema } from '../src/shared';

// --------------------------------------------------------------------------
// DB bootstrap
// --------------------------------------------------------------------------

const adminUrl = process.env.DATABASE_URL_ADMIN;
if (!adminUrl) throw new Error('DATABASE_URL_ADMIN not set (see .env)');

const TRUNCATE = `
  TRUNCATE TABLE
    "sales_history","order_items","orders","menu_items","recipes",
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
      .send({ question: 'test' });

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
});
