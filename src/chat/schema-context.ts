/**
 * Curated analytics schema context sent to the LLM for Text-to-SQL generation.
 *
 * WHY this exists: the LLM must know what tables and columns are available to
 * write valid SQL. We give it ONLY the analytics-relevant subset — sensitive
 * tables (users, refresh_tokens, audit_logs, tenants) and sensitive columns
 * (salary) are deliberately omitted so the LLM cannot reference them even if
 * prompted to do so. The SQL validator provides a second, independent layer.
 *
 * Every table listed here is also in the SQL validator's ALLOWED_TABLES set.
 * Keep both in sync when the analytics schema evolves.
 *
 * CRITICAL INVARIANT (bugfix 2026-07-02): every column name below MUST match
 * the real Postgres column (the `@map(...)` / `@@map(...)` target in
 * `prisma/schema.prisma`), not a guessed/aspirational name. A stale or
 * fabricated column here causes `$queryRawUnsafe` to fail at execution time
 * with Postgres error 42703 (`column ... does not exist`) — that failure
 * happened in production for "¿Qué insumos están por agotarse?" because this
 * file described `ingredients.current_cost` / `unit_id` / `category_id` /
 * `is_active`, none of which exist (the real columns are `unit_cost`, `unit`,
 * `category`, and there is no `is_active` at all). It also OMITTED the
 * `stock`/`min_stock` columns entirely, which caused a second, silent bug:
 * the LLM had no way to answer "stock bajo" questions from `ingredients`
 * directly, so it hallucinated a reconstruction from `inventory_movements`
 * using a non-existent `type IN ('in','out')` semantic (the real enum is
 * `purchase|sale|waste|adjustment|count` with a SIGNED qty delta), which
 * always evaluated to zero and produced a false "no hay insumos con stock
 * bajo" answer even though the demo data has ingredients below `min_stock`.
 *
 * When adding/renaming a Prisma field, update this file in the SAME change —
 * treat schema drift here as a production incident, not a docs nit.
 *
 * Note: tenant_id columns are present in every table but the LLM is instructed
 * NOT to add tenant_id filters — RLS FORCE handles tenant isolation.
 */
export const ANALYTICS_SCHEMA_CONTEXT = `
PostgreSQL analytics schema for a Peruvian restaurant (money in PEN, timezone America/Lima).
All monetary columns are DECIMAL(12,2) unless noted otherwise.
RLS is enforced — never add a tenant_id filter.

TABLE sales_history
  id UUID, sold_on TIMESTAMPTZ, dish_name TEXT, menu_item_id UUID nullable,
  qty INT, unit_price DECIMAL, total DECIMAL, external_ref TEXT nullable, created_at TIMESTAMPTZ

TABLE sales
  id UUID, order_id UUID, serie TEXT, number INT, doc_type TEXT ('boleta'|'factura'),
  customer TEXT nullable, customer_doc TEXT nullable, subtotal DECIMAL, igv DECIMAL, total DECIMAL,
  status TEXT ('issued'|'void'), void_reason TEXT nullable, issued_at TIMESTAMPTZ, created_at TIMESTAMPTZ

TABLE payments
  id UUID, sale_id UUID, method TEXT ('cash'|'card'|'yape'|'plin'),
  amount DECIMAL, created_at TIMESTAMPTZ
  NOTE: there is no paid_at column — use created_at as the payment timestamp.

TABLE orders
  id UUID, table_id UUID, waiter_id UUID nullable, guests INT,
  status TEXT ('open'|'sent_to_kitchen'|'served'|'void'|'paid'), void_reason TEXT nullable,
  opened_at TIMESTAMPTZ, sent_to_kitchen_at TIMESTAMPTZ nullable,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
  NOTE: orders has NO total/notes/closed_at column. Revenue for an order lives
  in the linked "sales" row (sales.order_id = orders.id); an order's line total
  is SUM(order_items.qty * order_items.unit_price) for that order_id.

TABLE order_items
  id UUID, order_id UUID, menu_item_id UUID, name TEXT, qty INT,
  unit_price DECIMAL, notes TEXT nullable, status TEXT ('pending'|'preparing'|'ready'|'served'),
  kitchen_station_id UUID nullable, sent_to_kitchen_at TIMESTAMPTZ nullable,
  preparing_at TIMESTAMPTZ nullable, ready_at TIMESTAMPTZ nullable, served_at TIMESTAMPTZ nullable,
  created_at TIMESTAMPTZ

TABLE menu_items
  id UUID, recipe_id UUID, menu_category_id UUID nullable, name TEXT,
  price DECIMAL, image_url TEXT nullable, is_active BOOLEAN, created_at TIMESTAMPTZ

TABLE menu_categories
  id UUID, name TEXT, position INT, is_active BOOLEAN, kitchen_station_id UUID nullable

TABLE menu_modifiers
  id UUID, menu_item_id UUID, name TEXT, price_delta DECIMAL, required BOOLEAN, position INT

TABLE menu_availability
  id UUID, menu_item_id UUID, day_of_week INT nullable (0=domingo..6=sábado, null=todos),
  start_minute INT, end_minute INT (minutos desde medianoche, hora America/Lima)

TABLE recipes
  id UUID, name TEXT, kind TEXT ('dish'|'sub_recipe'), yield DECIMAL, version INT,
  emoji TEXT nullable, description TEXT nullable, prep_minutes INT nullable, created_at TIMESTAMPTZ
  NOTE: recipes has NO sell_price/yield_unit/notes column. The sell price of a
  dish is menu_items.price (via menu_items.recipe_id).

TABLE recipe_items
  id UUID, recipe_id UUID, ingredient_id UUID nullable, sub_recipe_id UUID nullable,
  qty DECIMAL, waste_factor DECIMAL
  NOTE: waste_factor (not waste_pct) is a fraction (e.g. 0.05 = 5% merma).
  recipe_items has NO unit_id column — the unit is implicitly the ingredient's own unit.

TABLE recipe_versions
  id UUID, recipe_id UUID, version INT, snapshot JSONB, created_at TIMESTAMPTZ

TABLE ingredients
  id UUID, sku TEXT, name TEXT, type TEXT, unit TEXT, category TEXT nullable,
  unit_cost DECIMAL, stock DECIMAL(12,3), min_stock DECIMAL(12,3),
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
  NOTE: "stock" is the current on-hand quantity (kept up to date by inventory
  movements/purchases — do NOT recompute it from inventory_movements).
  "min_stock" is the reorder threshold (HU-05-10). An ingredient has LOW STOCK
  or is ABOUT TO RUN OUT when stock <= min_stock. There is no is_active,
  current_cost, unit_id, or category_id column — use unit_cost/unit/category.

TABLE ingredient_price_history
  id UUID, ingredient_id UUID, unit_cost DECIMAL, recorded_at TIMESTAMPTZ,
  source TEXT (default 'purchase_order')

TABLE inventory_movements
  id UUID, ingredient_id UUID, type TEXT ('purchase'|'sale'|'waste'|'adjustment'|'count'),
  qty DECIMAL(12,3) (SIGNED delta: positive=entrada/compra, negative=salida/venta/merma),
  note TEXT nullable, reason TEXT nullable, user_id UUID nullable, created_at TIMESTAMPTZ
  NOTE: there is no source/unit_cost/moved_at column. To know CURRENT stock,
  read ingredients.stock directly — do not sum this table.

TABLE purchase_orders
  id UUID, supplier_id UUID, status TEXT ('draft'|'sent'|'partially_received'|'received'|'cancelled'),
  notes TEXT nullable, expected_at TIMESTAMPTZ nullable, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
  NOTE: there is no total/ordered_at/received_at column. The order total is
  SUM(purchase_order_items.qty_ordered * purchase_order_items.unit_cost).

TABLE purchase_order_items
  id UUID, purchase_order_id UUID, ingredient_id UUID, qty_ordered DECIMAL,
  qty_received DECIMAL (default 0, accumulates on partial receptions), unit_cost DECIMAL

TABLE overhead_costs
  id UUID, period TEXT ('YYYY-MM'), concept TEXT, amount DECIMAL,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
  NOTE: the column is "concept" (not "name"); there is no category/is_active column.

TABLE costing_closes
  id UUID, period TEXT ('YYYY-MM'), total_cif DECIMAL, total_units INT,
  total_ingredient_cost DECIMAL, total_revenue DECIMAL, total_contribution DECIMAL,
  closed_at TIMESTAMPTZ
  NOTE: period is a single 'YYYY-MM' string, not period_start/period_end.
  There is no total_cogs/gross_margin column — use total_ingredient_cost and
  total_contribution (= total_revenue - total_ingredient_cost - total_cif).

TABLE employees
  id UUID, first_name TEXT, last_name TEXT, dni TEXT, position TEXT
  ('mozo'|'cocina'|'caja'|'otro'), phone TEXT nullable,
  hired_at DATE nullable, active BOOLEAN, created_at TIMESTAMPTZ
  NOTE: salary column is NOT available through this interface

TABLE forecast_runs
  id UUID, scope TEXT ('total'|'menuItem'), menu_item_id UUID nullable, engine TEXT nullable,
  model TEXT nullable, horizon INT, status TEXT ('running'|'completed'|'failed'),
  created_at TIMESTAMPTZ, completed_at TIMESTAMPTZ nullable
  NOTE: there is no series_id/ran_at column — use menu_item_id and created_at/completed_at.

TABLE suppliers
  id UUID, name TEXT, ruc TEXT, contact_name TEXT nullable, contact_email TEXT nullable,
  contact_phone TEXT nullable, payment_terms TEXT nullable, lead_time_days INT nullable, active BOOLEAN
  NOTE: the boolean column is "active" (not "is_active"); phone/email are
  "contact_phone"/"contact_email".

TABLE product_suppliers
  id UUID, ingredient_id UUID, supplier_id UUID, supplier_sku TEXT nullable,
  last_price DECIMAL nullable, preferred BOOLEAN

TABLE units_of_measure
  id UUID, name TEXT, code TEXT, family TEXT ('mass'|'volume'|'count'), factor_to_base DECIMAL
  NOTE: the column is "family" (not "type").

TABLE categories
  id UUID, name TEXT, parent_id UUID nullable
  NOTE: categories is a self-referencing tree (ingredient categories), there
  is NO "type" column.

TABLE kitchen_stations
  id UUID, name TEXT, position INT

TABLE zones
  id UUID, name TEXT, position INT
  NOTE: the column is "position" (not "is_active").

TABLE dining_tables
  id UUID, zone_id UUID, code TEXT, capacity INT,
  status TEXT ('free'|'occupied'|'bill'|'reserved'), pos_x INT nullable, pos_y INT nullable
  NOTE: the free-table status literal is 'free' (not 'available'); there is
  no 'blocked' status.

TABLE cash_closes
  id UUID, opened_at TIMESTAMPTZ, closed_at TIMESTAMPTZ, sales_count INT, void_count INT,
  total_gross DECIMAL, by_method JSONB (keys: cash, card, yape, plin — amounts as strings),
  user_id UUID nullable
  NOTE: there are no total_cash/total_card/total_digital/total columns — use
  total_gross for the grand total and by_method->>'cash' etc. for the
  per-method breakdown (JSONB text extraction).

TABLE notifications
  id UUID, user_id UUID nullable (null = broadcast to the whole tenant),
  type TEXT ('low_stock'|'order_ready'|'bill_requested'|'system'), title TEXT, body TEXT,
  read_at TIMESTAMPTZ nullable, created_at TIMESTAMPTZ
`.trim();
