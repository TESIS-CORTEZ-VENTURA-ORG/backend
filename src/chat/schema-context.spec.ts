/**
 * Regression guard for the E09 schema_context (2026-07-02 incident).
 *
 * The curated schema text handed to the LLM went stale relative to
 * `prisma/schema.prisma`: it described columns that never existed
 * (`ingredients.current_cost/unit_id/category_id/is_active`) and OMITTED the
 * real `stock`/`min_stock` columns entirely. That produced two production
 * bugs in the same request:
 *   1. A raw 500 for "¿Qué insumos están por agotarse?" (Postgres 42703,
 *      `column i.current_cost does not exist`).
 *   2. A false "no hay insumos con stock bajo" for the stock-bajo variant,
 *      because the LLM had no columns to answer from `ingredients` directly
 *      and hallucinated an `inventory_movements` reconstruction using a
 *      non-existent `type IN ('in','out')` semantic.
 *
 * These assertions pin the schema_context text to the REAL column names so a
 * future drift (renaming a Prisma field without updating this file) fails
 * CI instead of silently reaching production again.
 */

import { describe, expect, it } from 'vitest';
import { ANALYTICS_SCHEMA_CONTEXT as ctx } from './schema-context';
import { ALLOWED_TABLES } from './sql-validator.util';

/**
 * Extract only the COLUMN DECLARATION lines of a `TABLE <name>` block —
 * i.e. everything up to (but excluding) the first explanatory `NOTE:` line
 * or the next `TABLE` header, whichever comes first. NOTE lines legitimately
 * mention the OLD wrong column names in prose ("there is no X column") to
 * warn the LLM away from them, so assertions about "this column must not
 * appear" must not scan the NOTE prose, only the actual declared columns.
 */
function columnDeclaration(tableName: string): string {
  const start = ctx.indexOf(`TABLE ${tableName}\n`);
  if (start === -1)
    throw new Error(`TABLE ${tableName} not found in schema context`);
  const rest = ctx.slice(start);
  const noteIdx = rest.indexOf('\n  NOTE:');
  const nextTableIdx = rest.indexOf('\nTABLE ', 1);
  const end =
    noteIdx === -1
      ? nextTableIdx === -1
        ? rest.length
        : nextTableIdx
      : nextTableIdx === -1
        ? noteIdx
        : Math.min(noteIdx, nextTableIdx);
  return rest.slice(0, end);
}

describe('ANALYTICS_SCHEMA_CONTEXT — ingredients (root cause of the E09 500)', () => {
  it('documents the real stock/min_stock columns', () => {
    const decl = columnDeclaration('ingredients');
    expect(decl).toMatch(/\bstock\b/);
    expect(decl).toMatch(/\bmin_stock\b/);
  });

  it('documents unit_cost (not the fabricated current_cost)', () => {
    expect(columnDeclaration('ingredients')).toMatch(/\bunit_cost\b/);
  });

  it('does NOT declare the fabricated ingredients columns that caused the 500', () => {
    // These never existed on the real `ingredients` table.
    const decl = columnDeclaration('ingredients');
    expect(decl).not.toMatch(/\bcurrent_cost\b/);
    expect(decl).not.toMatch(/\bunit_id\b/);
    expect(decl).not.toMatch(/\bcategory_id\b/);
    expect(decl).not.toMatch(/\bis_active\b/);
  });
});

describe('ANALYTICS_SCHEMA_CONTEXT — other tables that shared the same drift bug', () => {
  it('payments declares created_at, not the fabricated paid_at', () => {
    const decl = columnDeclaration('payments');
    expect(decl).toMatch(/\bcreated_at\b/);
    expect(decl).not.toMatch(/\bpaid_at\b/);
  });

  it('orders has no fabricated total/notes/closed_at columns', () => {
    const decl = columnDeclaration('orders');
    expect(decl).not.toMatch(/\btotal\b/);
    expect(decl).not.toMatch(/\bnotes\b/);
    expect(decl).not.toMatch(/\bclosed_at\b/);
  });

  it('dining_tables uses the real status enum (free|occupied|bill|reserved)', () => {
    const decl = columnDeclaration('dining_tables');
    expect(decl).toContain("'free'");
    expect(decl).not.toContain("'available'");
    expect(decl).not.toContain("'blocked'");
  });

  it('inventory_movements documents the real signed-qty semantics, not a fabricated source/moved_at', () => {
    const decl = columnDeclaration('inventory_movements');
    expect(decl).toMatch(/SIGNED/);
    expect(decl).not.toMatch(/\bmoved_at\b/);
    expect(decl).not.toMatch(/\bsource\b/);
  });

  it('every table name mentioned still matches the ALLOWED_TABLES validator allowlist', () => {
    const tableNames = [...ctx.matchAll(/^TABLE (\w+)/gm)]
      .map((m) => m[1])
      .filter((name): name is string => Boolean(name));
    expect(tableNames.length).toBeGreaterThan(0);
    for (const name of tableNames) {
      expect(ALLOWED_TABLES.has(name)).toBe(true);
    }
  });
});
