/**
 * Unit tests for the SQL validation hard gate (E09 security core).
 *
 * EVERY security-relevant rule is tested independently and with injection
 * attempts. These tests are the primary evidence that the validator cannot
 * be bypassed. New attack vectors found in review MUST be added here before
 * the fix is considered done.
 */

import { describe, expect, it } from 'vitest';
import { ALLOWED_TABLES, MAX_ROWS, validateSql } from './sql-validator.util';

// ---- helpers ---------------------------------------------------------------

/** Assert valid SQL and return the normalised output. Throws on rejection. */
function expectOk(sql: string): string {
  const r = validateSql(sql);
  if (!r.ok) {
    throw new Error(
      `Expected ok but got rejection (rule ${r.error.rule}): ${r.error.reason}`,
    );
  }
  return r.value.sql;
}

/** Assert that SQL is rejected and return the rejection reason. Throws on ok. */
function expectReject(sql: string): { reason: string; rule: number } {
  const r = validateSql(sql);
  if (r.ok) {
    throw new Error(`Expected rejection but got ok SQL: ${r.value.sql}`);
  }
  return r.error;
}

// ---- Rule 1: comment stripping & normalisation ----------------------------

describe('Rule 1 — comment stripping', () => {
  it('strips line comments before checking keywords', () => {
    // The comment contains DROP but it should be stripped
    const sql = 'SELECT id FROM sales_history -- DROP TABLE users\nLIMIT 5';
    expect(() => expectOk(sql)).not.toThrow();
  });

  it('strips block comments before checking keywords', () => {
    const sql = 'SELECT /* DROP TABLE users */ id FROM sales_history LIMIT 5';
    expect(() => expectOk(sql)).not.toThrow();
  });

  it('rejects empty query after stripping', () => {
    const { rule } = expectReject('-- only a comment');
    expect(rule).toBe(1);
  });
});

// ---- Rule 2: single statement (no semicolons) -----------------------------

describe('Rule 2 — single statement (no embedded semicolons)', () => {
  it('rejects DELETE via semicolon injection', () => {
    const { rule } = expectReject('SELECT 1; DELETE FROM sales_history');
    expect(rule).toBe(2);
  });

  it('rejects DROP TABLE via semicolon injection', () => {
    const { rule } = expectReject(
      'SELECT id FROM sales_history LIMIT 5; DROP TABLE sales_history',
    );
    expect(rule).toBe(2);
  });

  it('rejects UPDATE via semicolon injection', () => {
    const { rule } = expectReject(
      'SELECT 1; UPDATE employees SET active=false',
    );
    expect(rule).toBe(2);
  });

  it('rejects multiple statements', () => {
    const { rule } = expectReject('SELECT 1; SELECT 2');
    expect(rule).toBe(2);
  });

  it('accepts a trailing semicolon (SQL convention) by stripping it', () => {
    expect(() =>
      expectOk('SELECT id FROM sales_history LIMIT 5;'),
    ).not.toThrow();
  });
});

// ---- Rule 3: SELECT or WITH only ------------------------------------------

describe('Rule 3 — must start with SELECT or WITH', () => {
  it('accepts SELECT', () => {
    expect(() =>
      expectOk('SELECT id FROM sales_history LIMIT 5'),
    ).not.toThrow();
  });

  it('accepts WITH (CTE)', () => {
    const cte = `WITH t AS (SELECT id FROM sales_history)
      SELECT * FROM t LIMIT 5`;
    expect(() => expectOk(cte)).not.toThrow();
  });

  it('rejects INSERT', () => {
    const { rule } = expectReject(
      "INSERT INTO sales_history (dish_name) VALUES ('x')",
    );
    expect(rule).toBe(3);
  });

  it('rejects UPDATE', () => {
    const { rule } = expectReject('UPDATE employees SET active=false');
    expect(rule).toBe(3);
  });

  it('rejects DELETE', () => {
    const { rule } = expectReject('DELETE FROM sales_history');
    expect(rule).toBe(3);
  });

  it('rejects DROP TABLE (starts with DROP)', () => {
    const { rule } = expectReject('DROP TABLE sales_history');
    expect(rule).toBe(3);
  });

  it('rejects TRUNCATE (starts with TRUNCATE)', () => {
    const { rule } = expectReject('TRUNCATE sales_history');
    expect(rule).toBe(3);
  });
});

// ---- Rule 4: blocked DDL/DML keywords -------------------------------------

describe('Rule 4 — blocked DDL/DML keywords inside a SELECT', () => {
  it('rejects DROP keyword embedded in a query', () => {
    // Contrived but the validator must catch it regardless of context
    const { rule } = expectReject(
      'SELECT 1 WHERE (SELECT COUNT(*) FROM (DROP TABLE foo) t) > 0',
    );
    expect(rule).toBe(4);
  });

  it('rejects ALTER keyword', () => {
    const { rule } = expectReject(
      'SELECT id FROM sales_history ALTER COLUMN x',
    );
    expect(rule).toBe(4);
  });

  it('does NOT reject created_at (CREATE is a prefix but not a whole word)', () => {
    expect(() =>
      expectOk('SELECT created_at FROM sales_history LIMIT 5'),
    ).not.toThrow();
  });

  it('does NOT reject updated_at', () => {
    expect(() =>
      expectOk('SELECT updated_at FROM orders LIMIT 5'),
    ).not.toThrow();
  });

  it('does NOT reject deleted_at', () => {
    expect(() =>
      expectOk('SELECT deleted_at FROM menu_items LIMIT 5'),
    ).not.toThrow();
  });

  it('rejects GRANT keyword', () => {
    const { rule } = expectReject('SELECT 1 GRANT ALL ON sales TO public');
    expect(rule).toBe(4);
  });

  it('rejects COPY keyword', () => {
    const { rule } = expectReject("SELECT 1 COPY sales TO '/tmp/out.csv'");
    expect(rule).toBe(4);
  });

  it('rejects MERGE keyword', () => {
    const { rule } = expectReject('SELECT 1 MERGE INTO sales USING src ON x=y');
    expect(rule).toBe(4);
  });

  it('rejects SELECT INTO (DDL masquerading as SELECT)', () => {
    // `SELECT * INTO new_table FROM src` is PostgreSQL DDL: it creates a new
    // table. The query starts with SELECT so it passes Rule 3; Rule 4 must
    // catch INTO before the statement reaches the DB.
    const { rule } = expectReject('SELECT * INTO new_table FROM sales_history');
    expect(rule).toBe(4);
  });

  it('rejects SELECT INTO with a whitelisted source table', () => {
    // Even when the source table is in the analytics allowlist, the INTO
    // clause turns this into a DDL CREATE TABLE operation — reject it.
    const { rule } = expectReject(
      'SELECT dish_name INTO exported_data FROM sales_history LIMIT 10',
    );
    expect(rule).toBe(4);
  });
});

// ---- Rule 5: system catalog access ----------------------------------------

describe('Rule 5 — no system catalog access', () => {
  it('rejects pg_tables', () => {
    const { rule } = expectReject('SELECT * FROM pg_tables LIMIT 5');
    expect(rule).toBe(5);
  });

  it('rejects information_schema', () => {
    const { rule } = expectReject(
      'SELECT * FROM information_schema.tables LIMIT 5',
    );
    expect(rule).toBe(5);
  });

  it('rejects pg_catalog', () => {
    const { rule } = expectReject('SELECT * FROM pg_catalog.pg_class LIMIT 5');
    expect(rule).toBe(5);
  });

  it('rejects pg_roles', () => {
    const { rule } = expectReject('SELECT * FROM pg_roles LIMIT 5');
    expect(rule).toBe(5);
  });
});

// ---- Rule 6: blocked dangerous functions ----------------------------------

describe('Rule 6 — blocked dangerous server functions', () => {
  it('rejects pg_read_file (blocked, caught by rule 5 or 6)', () => {
    // pg_read_file starts with pg_ so SYSTEM_CATALOG_RE (rule 5) fires before
    // BLOCKED_FUNCTIONS_RE (rule 6). Both rules block it — security is intact.
    const { rule } = expectReject("SELECT pg_read_file('/etc/passwd') LIMIT 1");
    expect([5, 6]).toContain(rule);
  });

  it('rejects dblink', () => {
    // dblink does NOT start with pg_ so it reaches rule 6 cleanly.
    const { rule } = expectReject(
      "SELECT * FROM dblink('host=evil', 'SELECT 1') LIMIT 1",
    );
    expect(rule).toBe(6);
  });

  it('rejects lo_import', () => {
    const { rule } = expectReject("SELECT lo_import('/etc/passwd') LIMIT 1");
    expect(rule).toBe(6);
  });

  it('rejects pg_sleep (blocked, caught by rule 5 or 6)', () => {
    // pg_sleep starts with pg_ — same ordering note as pg_read_file above.
    const { rule } = expectReject('SELECT pg_sleep(30) LIMIT 1');
    expect([5, 6]).toContain(rule);
  });
});

// ---- Rule 7: sensitive column block ----------------------------------------

describe('Rule 7 — sensitive column references blocked', () => {
  it('rejects direct salary column reference', () => {
    const { rule } = expectReject('SELECT salary FROM employees LIMIT 10');
    expect(rule).toBe(7);
  });

  it('rejects salary in a calculation', () => {
    const { rule } = expectReject(
      'SELECT name, salary * 12 AS annual FROM employees LIMIT 10',
    );
    expect(rule).toBe(7);
  });

  it('rejects salary in WHERE clause', () => {
    const { rule } = expectReject(
      'SELECT name FROM employees WHERE salary > 1000 LIMIT 10',
    );
    expect(rule).toBe(7);
  });
});

// ---- Rule 8: table allowlist ----------------------------------------------

describe('Rule 8 — table allowlist', () => {
  it('accepts all whitelisted tables', () => {
    for (const tbl of ALLOWED_TABLES) {
      expect(() => expectOk(`SELECT * FROM ${tbl} LIMIT 1`)).not.toThrow();
    }
  });

  it('rejects users table', () => {
    const { rule } = expectReject('SELECT email FROM users LIMIT 10');
    expect(rule).toBe(8);
  });

  it('rejects refresh_tokens table', () => {
    const { rule } = expectReject('SELECT * FROM refresh_tokens LIMIT 10');
    expect(rule).toBe(8);
  });

  it('rejects audit_logs table', () => {
    const { rule } = expectReject('SELECT * FROM audit_logs LIMIT 10');
    expect(rule).toBe(8);
  });

  it('rejects tenants table', () => {
    const { rule } = expectReject('SELECT * FROM tenants LIMIT 10');
    expect(rule).toBe(8);
  });

  it('rejects an arbitrary unknown table', () => {
    const { rule } = expectReject('SELECT * FROM top_secret_data LIMIT 5');
    expect(rule).toBe(8);
  });

  it('accepts JOIN between two whitelisted tables', () => {
    expect(() =>
      expectOk(
        'SELECT sh.dish_name, mi.price ' +
          'FROM sales_history sh ' +
          'JOIN menu_items mi ON sh.menu_item_id = mi.id ' +
          'LIMIT 10',
      ),
    ).not.toThrow();
  });

  it('rejects JOIN that references a non-whitelisted table', () => {
    const { rule } = expectReject(
      'SELECT * FROM sales_history sh JOIN users u ON u.id = sh.id LIMIT 5',
    );
    expect(rule).toBe(8);
  });
});

// ---- Rule 9: LIMIT enforcement --------------------------------------------

describe('Rule 9 — LIMIT enforcement', () => {
  it('adds LIMIT when absent', () => {
    const sql = expectOk('SELECT * FROM sales_history');
    expect(sql.toUpperCase()).toMatch(/LIMIT/);
  });

  it(`caps LIMIT to ${MAX_ROWS} when value exceeds the cap`, () => {
    const sql = expectOk('SELECT * FROM sales_history LIMIT 9999');
    expect(sql).toMatch(new RegExp(`LIMIT ${MAX_ROWS}`));
    expect(sql).not.toMatch(/LIMIT 9999/i);
  });

  it('preserves LIMIT when within the cap', () => {
    const sql = expectOk('SELECT * FROM sales_history LIMIT 10');
    expect(sql).toMatch(/LIMIT 10/i);
  });

  it('preserves LIMIT equal to the cap', () => {
    const sql = expectOk(`SELECT * FROM sales_history LIMIT ${MAX_ROWS}`);
    expect(sql).toMatch(new RegExp(`LIMIT ${MAX_ROWS}`));
  });
});

// ---- Allowlist invariants -------------------------------------------------

describe('ALLOWED_TABLES invariants', () => {
  const blocked = ['users', 'refresh_tokens', 'audit_logs', 'tenants'];

  it.each(blocked)('does NOT contain %s', (tbl) => {
    expect(ALLOWED_TABLES.has(tbl)).toBe(false);
  });

  it('contains sales_history', () => {
    expect(ALLOWED_TABLES.has('sales_history')).toBe(true);
  });

  it('contains employees (but salary column is blocked by Rule 7)', () => {
    expect(ALLOWED_TABLES.has('employees')).toBe(true);
  });
});

// ---- CTE (WITH) queries ---------------------------------------------------

describe('CTE (WITH) queries', () => {
  it('accepts a simple CTE over whitelisted tables', () => {
    const sql = `
      WITH monthly AS (
        SELECT DATE_TRUNC('month', sold_on) AS month, SUM(total) AS revenue
        FROM sales_history
        GROUP BY month
      )
      SELECT month, revenue FROM monthly ORDER BY month DESC LIMIT 12
    `;
    expect(() => expectOk(sql)).not.toThrow();
  });

  it('rejects a CTE that references a blocked table', () => {
    const sql = `
      WITH u AS (SELECT email FROM users)
      SELECT * FROM u LIMIT 10
    `;
    const { rule } = expectReject(sql);
    expect(rule).toBe(8);
  });
});
