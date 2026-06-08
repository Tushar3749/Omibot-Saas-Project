-- OmniBot SaaS — Migration 015: Orders order_ref column
-- Adds human-readable order reference (ORD-YYYYMMDD-XXXX).
-- The UUID order_id remains the primary key; order_ref is for customer display.
-- Run this in the Supabase SQL Editor.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_ref TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_ref ON orders(tenant_id, order_ref);
