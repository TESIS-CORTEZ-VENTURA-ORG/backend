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
 * Note: tenant_id columns are present in every table but the LLM is instructed
 * NOT to add tenant_id filters — RLS FORCE handles tenant isolation.
 */
export const ANALYTICS_SCHEMA_CONTEXT = `
PostgreSQL analytics schema for a Peruvian restaurant (money in PEN, timezone America/Lima).
All monetary columns are DECIMAL(12,2). RLS is enforced — never add a tenant_id filter.

TABLE sales_history
  id UUID, sold_on TIMESTAMPTZ, dish_name TEXT, menu_item_id UUID nullable,
  qty INT, unit_price DECIMAL, total DECIMAL, external_ref TEXT nullable, created_at TIMESTAMPTZ

TABLE sales
  id UUID, order_id UUID, serie TEXT, number INT, doc_type TEXT,
  customer TEXT nullable, subtotal DECIMAL, igv DECIMAL, total DECIMAL,
  status TEXT ('issued'|'voided'), issued_at TIMESTAMPTZ

TABLE payments
  id UUID, sale_id UUID, method TEXT ('cash'|'card'|'yape'|'plin'),
  amount DECIMAL, paid_at TIMESTAMPTZ

TABLE orders
  id UUID, table_id UUID nullable, status TEXT, total DECIMAL, notes TEXT nullable,
  opened_at TIMESTAMPTZ, closed_at TIMESTAMPTZ nullable, created_at TIMESTAMPTZ

TABLE order_items
  id UUID, order_id UUID, menu_item_id UUID, name TEXT, qty INT,
  unit_price DECIMAL, status TEXT, created_at TIMESTAMPTZ

TABLE menu_items
  id UUID, recipe_id UUID, menu_category_id UUID nullable, name TEXT,
  price DECIMAL, is_active BOOLEAN, created_at TIMESTAMPTZ

TABLE menu_categories
  id UUID, name TEXT, display_order INT, is_active BOOLEAN

TABLE recipes
  id UUID, name TEXT, kind TEXT ('dish'|'sub_recipe'), yield DECIMAL nullable,
  yield_unit TEXT nullable, sell_price DECIMAL nullable, notes TEXT nullable

TABLE recipe_items
  id UUID, recipe_id UUID, ingredient_id UUID nullable, sub_recipe_id UUID nullable,
  qty DECIMAL, waste_pct DECIMAL, unit_id UUID

TABLE ingredients
  id UUID, name TEXT, current_cost DECIMAL, unit_id UUID, category_id UUID nullable,
  is_active BOOLEAN

TABLE ingredient_price_history
  id UUID, ingredient_id UUID, unit_cost DECIMAL, recorded_at TIMESTAMPTZ, source TEXT

TABLE inventory_movements
  id UUID, ingredient_id UUID, type TEXT ('in'|'out'), source TEXT
  ('purchase'|'sale'|'waste'|'adjustment'|'count_recon'),
  qty DECIMAL, unit_cost DECIMAL nullable, notes TEXT nullable, moved_at TIMESTAMPTZ

TABLE purchase_orders
  id UUID, supplier_id UUID nullable, status TEXT ('draft'|'sent'|'received'|'cancelled'),
  total DECIMAL, ordered_at DATE nullable, received_at DATE nullable

TABLE purchase_order_items
  id UUID, purchase_order_id UUID, ingredient_id UUID, qty DECIMAL,
  unit_cost DECIMAL, total DECIMAL

TABLE overhead_costs
  id UUID, name TEXT, amount DECIMAL, period TEXT ('monthly'|'weekly'|'daily'),
  category TEXT, is_active BOOLEAN

TABLE costing_closes
  id UUID, period_start DATE, period_end DATE, total_revenue DECIMAL,
  total_cogs DECIMAL, gross_margin DECIMAL, closed_at TIMESTAMPTZ

TABLE employees
  id UUID, first_name TEXT, last_name TEXT, dni TEXT, position TEXT
  ('mozo'|'cocina'|'caja'|'otro'), phone TEXT nullable,
  hired_at DATE nullable, active BOOLEAN
  NOTE: salary column is NOT available through this interface

TABLE forecast_runs
  id UUID, scope TEXT, series_id TEXT, engine TEXT, model TEXT,
  horizon INT, status TEXT ('running'|'completed'|'failed'), ran_at TIMESTAMPTZ

TABLE suppliers
  id UUID, name TEXT, ruc TEXT nullable, contact_name TEXT nullable,
  phone TEXT nullable, email TEXT nullable, is_active BOOLEAN

TABLE units_of_measure
  id UUID, name TEXT, code TEXT, type TEXT ('weight'|'volume'|'unit'|'length')

TABLE categories
  id UUID, name TEXT, type TEXT ('ingredient'|'product')

TABLE zones
  id UUID, name TEXT, is_active BOOLEAN

TABLE dining_tables
  id UUID, zone_id UUID, code TEXT, capacity INT, status TEXT
  ('available'|'occupied'|'reserved'|'blocked')

TABLE cash_closes
  id UUID, opened_at TIMESTAMPTZ, closed_at TIMESTAMPTZ nullable,
  total_cash DECIMAL, total_card DECIMAL, total_digital DECIMAL, total DECIMAL
`.trim();
