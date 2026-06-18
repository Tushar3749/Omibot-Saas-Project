-- Migration 027: Ensure all orders columns exist
-- Run this in Supabase SQL Editor if order save is failing.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name    TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS items            JSONB DEFAULT '[]';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_code    TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS original_amount  NUMERIC(10,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS net_amount       NUMERIC(10,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS district         TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_charge  NUMERIC(10,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_ref        TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_ref ON orders(tenant_id, order_ref);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(tenant_id, customer_phone);
