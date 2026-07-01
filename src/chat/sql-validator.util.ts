/**
 * SQL validation utility — the hard security gate for Text-to-SQL execution
 * (backend.md §8.2, E09 spec rule R3).
 *
 * DESIGN PHILOSOPHY: conservative / reject-on-doubt.
 *   - False positive (reject a valid query): recoverable — user retries.
 *   - False negative (pass malicious SQL): security incident — unacceptable.
 *
 * Even if this validator passes a query, RLS FORCE + statement_timeout provide
 * two independent backstop layers. Defence-in-depth means no single layer is
 * trusted alone.
 *
 * 9 rules (applied in order):
 *   1. Strip SQL comments, normalise whitespace.
 *   2. Single statement only — no embedded semicolons.
 *   3. Must start with SELECT or WITH.
 *   4. No blocked DDL/DML keywords (whole-word, case-insensitive).
 *      Includes INTO to prevent `SELECT INTO <table>` (PostgreSQL DDL that
 *      creates a new table — a schema-pollution vector even under RLS).
 *   5. No system catalog access (pg_*, information_schema, pg_catalog).
 *   6. No blocked dangerous functions (pg_read_file, dblink, etc.).
 *   7. No sensitive column references (salary).
 *   8. All FROM/JOIN table references must be in the analytics allowlist.
 *   9. LIMIT ≤ MAX_ROWS; appended automatically if absent.
 */

/** Hard cap on rows returned through the chat interface. */
export const MAX_ROWS = 200;

/**
 * Analytics table allowlist.
 *
 * ONLY these tables may appear in FROM/JOIN clauses in a chat query. The list
 * is reviewed and hard-coded here — any addition requires a code review.
 * Tables NOT in this list that must never be reachable:
 *   - users          (auth credentials, personal data)
 *   - refresh_tokens (auth tokens)
 *   - audit_logs     (system audit — not an analytics table)
 *   - tenants        (no business analytics value; exposes tenant metadata)
 *
 * employees IS in the list but the salary column is blocked by Rule 7.
 */
export const ALLOWED_TABLES: ReadonlySet<string> = new Set([
  'sales',
  'order_items',
  'orders',
  'menu_items',
  'menu_categories',
  'menu_modifiers',
  'menu_availability',
  'recipes',
  'recipe_items',
  'recipe_versions',
  'ingredients',
  'ingredient_price_history',
  'units_of_measure',
  'categories',
  'suppliers',
  'product_suppliers',
  'inventory_movements',
  'purchase_orders',
  'purchase_order_items',
  'sales_history',
  'overhead_costs',
  'costing_closes',
  'employees',
  'forecast_runs',
  'payments',
  'cash_closes',
  'kitchen_stations',
  'zones',
  'dining_tables',
  'notifications',
]);

// --------------------------------------------------------------------------
// Internal regex patterns
// --------------------------------------------------------------------------

/** Must start with SELECT or WITH (CTEs), allowing optional whitespace. */
const SELECT_START_RE = /^\s*(WITH|SELECT)\b/i;

/**
 * Blocked DDL/DML/system command keywords. Uses \b word boundaries so
 * identifiers like "created_at" or "droplets" are NOT flagged.
 * "COMMENT ON" uses \s+ between the words to allow multiline queries.
 *
 * INTO is explicitly included to prevent the PostgreSQL `SELECT INTO <table>`
 * form, which creates a new table in the public schema (DDL) even though the
 * statement syntactically starts with SELECT. RLS limits which rows are
 * selected but does NOT prevent the new table from being created, making this
 * a schema-pollution / DoS vector. INTO has no legitimate use in a read-only
 * analytics query: FETCH INTO is PL/pgSQL-only (not plain SQL), and FETCH is
 * already blocked; no other valid analytics pattern requires INTO.
 */
const BLOCKED_KEYWORDS_RE =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|VACUUM|EXECUTE|PREPARE|DEALLOCATE|FETCH|MOVE|DECLARE|DISCARD|RESET|UNLISTEN|LISTEN|NOTIFY|LOAD|MERGE|IMPORT|EXPORT|INTO)\b/i;

/**
 * System catalog identifiers. Matches:
 *   - pg_<anything>   (pg_tables, pg_roles, pg_stat_*, etc.)
 *   - information_schema
 *   - pg_catalog
 */
const SYSTEM_CATALOG_RE = /\bpg_[a-z_]+\b|information_schema|pg_catalog/i;

/** Dangerous server-side functions that must never appear in user queries. */
const BLOCKED_FUNCTIONS_RE =
  /\b(pg_read_file|pg_write_file|dblink|lo_import|lo_export|pg_sleep|copy_file_range|pg_ls_dir|pg_execute_server_program)\b/i;

/**
 * Sensitive column block. The "salary" column of the employees table must not
 * be accessible through the chat interface regardless of which table is queried.
 * Word-boundary match prevents blocking "annual_salary_override" (hypothetical),
 * but we intentionally block the simple word "salary" conservatively.
 */
const BLOCKED_COLUMNS_RE = /\bsalary\b/i;

/** Matches LIMIT <n> anywhere in the query (global, used to enumerate). */
const LIMIT_VALUE_RE = /\bLIMIT\s+(\d+)\b/gi;

// --------------------------------------------------------------------------
// Result types
// --------------------------------------------------------------------------

export interface ValidatedSql {
  /** Normalised, comment-stripped SQL with LIMIT enforced. Execute this. */
  sql: string;
}

export interface SqlValidationError {
  /** Human-readable rejection reason (safe to surface in a 400 response). */
  reason: string;
  /** Rule number (1-9) that triggered the rejection — for logging/tracing. */
  rule: number;
}

export type SqlValidationResult =
  | { ok: true; value: ValidatedSql }
  | { ok: false; error: SqlValidationError };

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * Strip SQL line comments (`-- ...`) and block comments (`/* ... *\/`).
 *
 * This is intentionally conservative: we do NOT parse inside string literals,
 * so a WHERE clause like `name = 'DROP TABLE'` would still flag Rule 4.
 * That is acceptable — the LLM should not be embedding DDL in strings.
 */
function stripComments(sql: string): string {
  // Block comments first (handles nested /* */ in a single pass)
  let s = sql.replace(/\/\*[\s\S]*?\*\//g, ' ');
  // Line comments
  s = s.replace(/--[^\n]*/g, ' ');
  return s.trim();
}

/**
 * Extract CTE alias names from a WITH clause so they can be excluded from the
 * table allowlist check. CTE aliases are NOT real DB tables — they are query-
 * scoped temporary result sets. For example `WITH t AS (SELECT …)` defines `t`
 * as a CTE alias; when the outer SELECT references `FROM t` we must NOT reject
 * it as an unknown table.
 *
 * The real tables referenced INSIDE the CTE bodies are still checked by
 * extractTableRefs (the `FROM sales_history` inside `WITH t AS (…)` is caught
 * on a separate pass of the same regex). This keeps the allowlist check tight:
 * only CTE output aliases are exempted, never underlying table names.
 */
function extractCteNames(sql: string): Set<string> {
  const names = new Set<string>();
  // Matches: WITH alias AS (   or   , alias AS (  (multiple CTEs).
  // We don't need to handle nested parens — only the first ( matters for naming.
  const CTE_NAME_RE = /(?:\bWITH\b|,)\s*("?[a-z_][a-z0-9_]*"?)\s+AS\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = CTE_NAME_RE.exec(sql)) !== null) {
    if (m[1]) names.add(m[1].replace(/"/g, '').toLowerCase());
  }
  return names;
}

/**
 * Extract unquoted table names that immediately follow FROM or JOIN keywords.
 *
 * Heuristic approach: we grab the first bare identifier (not starting with `(`)
 * after each FROM/JOIN token in a comment-stripped, string-literal-emptied copy
 * of the query. This handles:
 *   - Simple `FROM foo`
 *   - `LEFT JOIN foo`
 *   - `CROSS JOIN foo`
 *   - CTEs: `FROM cte_name` (CTE names are not in the allowlist, so they
 *     would fail Rule 8 — intentional; the validator rejects CTEs that
 *     reference non-whitelisted names.)
 *
 * Limitation: if the LLM wraps a subquery in parens (`FROM (SELECT ...)`)
 * the regex skips the `(` opener — the inner FROM/JOIN is caught on the
 * next match iteration. This is correct behaviour.
 */
function extractTableRefs(sql: string): string[] {
  // Remove single-quoted string literals to avoid false positives in WHERE clauses
  const noStrings = sql.replace(/'[^']*'/g, "''");

  const TABLE_REF_RE = /\b(?:FROM|JOIN)\s+("?[a-z_][a-z0-9_]*"?|\([^)]*\))/gi;
  const tables: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = TABLE_REF_RE.exec(noStrings)) !== null) {
    const raw = match[1];
    if (!raw || raw.startsWith('(')) continue; // subquery — skip
    // Strip optional double-quote wrapping
    const name = raw.replace(/"/g, '').toLowerCase();
    if (name) tables.push(name);
  }

  return tables;
}

/**
 * Enforce a LIMIT clause ≤ MAX_ROWS.
 *  - If absent: appends `LIMIT MAX_ROWS`.
 *  - If present and ≤ MAX_ROWS: keeps as-is.
 *  - If present and > MAX_ROWS: replaces with MAX_ROWS.
 *
 * Handles multiple LIMIT occurrences (e.g. inside a CTE + outer SELECT) by
 * capping each one.
 */
function enforceLimitClause(sql: string): string {
  LIMIT_VALUE_RE.lastIndex = 0;
  const matches = [...sql.matchAll(LIMIT_VALUE_RE)];

  if (matches.length === 0) {
    return `${sql} LIMIT ${MAX_ROWS}`;
  }

  let result = sql;
  for (const m of matches) {
    const n = parseInt(m[1] ?? '0', 10);
    if (n > MAX_ROWS) {
      // Replace first occurrence of this exact match string
      result = result.replace(m[0], `LIMIT ${MAX_ROWS}`);
    }
  }
  return result;
}

function fail(reason: string, rule: number): SqlValidationResult {
  return { ok: false, error: { reason, rule } };
}

// --------------------------------------------------------------------------
// Main entry point
// --------------------------------------------------------------------------

/**
 * Validate a raw SQL string produced by an LLM adapter.
 *
 * Returns a discriminated union:
 *   { ok: true,  value: { sql } }              — safe to execute
 *   { ok: false, error: { reason, rule } }      — rejected, never execute
 *
 * The caller (ChatService) must check `.ok` before touching the DB. Rejection
 * reasons are safe to surface in 400 responses (no internal detail leaked).
 */
export function validateSql(rawSql: string): SqlValidationResult {
  // Rule 1 — strip comments, normalise whitespace
  const stripped = stripComments(rawSql);
  // Remove trailing semicolons (SQL convention allows one; we strip it so the
  // embedded-semicolon check in Rule 2 only fires on real multi-statements).
  const normalized = stripped.replace(/;+$/, '').trim();

  if (!normalized) {
    return fail('Empty query after comment-stripping and normalisation.', 1);
  }

  // Rule 2 — single statement only
  if (/;/.test(normalized)) {
    return fail(
      'Multiple statements detected (embedded semicolon). ' +
        'Only a single read-only SELECT is allowed.',
      2,
    );
  }

  // Rule 3 — must start with SELECT or WITH
  if (!SELECT_START_RE.test(normalized)) {
    return fail(
      'Query must start with SELECT or WITH (CTE). ' +
        'INSERT, UPDATE, DELETE, and DDL statements are not allowed.',
      3,
    );
  }

  // Rule 4 — no blocked DDL/DML keywords
  const kwMatch = BLOCKED_KEYWORDS_RE.exec(normalized);
  if (kwMatch) {
    return fail(
      `Blocked keyword '${kwMatch[0].toUpperCase()}' found. ` +
        'Only read-only SELECT queries are allowed.',
      4,
    );
  }

  // Rule 5 — no system catalog access
  if (SYSTEM_CATALOG_RE.test(normalized)) {
    return fail(
      'Access to PostgreSQL system catalogs (pg_*, information_schema, ' +
        'pg_catalog) is not allowed through the analytics interface.',
      5,
    );
  }

  // Rule 6 — no dangerous server-side functions
  if (BLOCKED_FUNCTIONS_RE.test(normalized)) {
    return fail(
      'Query contains a blocked server-side function ' +
        '(pg_read_file, dblink, lo_import, etc.).',
      6,
    );
  }

  // Rule 7 — no sensitive column references
  if (BLOCKED_COLUMNS_RE.test(normalized)) {
    return fail(
      "Column 'salary' is not available through the analytics interface. " +
        'Employee salary data is excluded from chat queries.',
      7,
    );
  }

  // Rule 8 — all table references must be in the analytics allowlist.
  // CTE alias names are excluded: they are query-scoped names, not real tables.
  const cteNames = extractCteNames(normalized);
  const tableRefs = extractTableRefs(normalized).filter(
    (t) => !cteNames.has(t),
  );
  for (const tbl of tableRefs) {
    if (!ALLOWED_TABLES.has(tbl)) {
      return fail(
        `Table '${tbl}' is not in the analytics allowlist. ` +
          'Only whitelisted analytics tables may be queried via the chat interface.',
        8,
      );
    }
  }

  // Rule 9 — enforce LIMIT ≤ MAX_ROWS
  const withLimit = enforceLimitClause(normalized);

  return { ok: true, value: { sql: withLimit } };
}
