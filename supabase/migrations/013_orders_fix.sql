-- OmniBot SaaS — Migration 013: Orders table — all missing columns
-- Safe to run multiple times (IF NOT EXISTS on every column).
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run

ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name   TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS items           JSONB    DEFAULT '[]';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_code   TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS original_amount NUMERIC(10, 2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS net_amount      NUMERIC(10, 2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_ref       TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_ref ON orders(tenant_id, order_ref);
