-- OmniBot SaaS — Migration 013: Orders missing columns
-- Adds columns required by the order-save code but absent from the schema.
-- Run this in the Supabase SQL Editor.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name   TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_code   TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS original_amount NUMERIC(10, 2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS net_amount      NUMERIC(10, 2);
