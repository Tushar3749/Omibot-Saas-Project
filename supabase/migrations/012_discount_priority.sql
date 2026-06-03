-- OmniBot SaaS — Migration 012: Discount Priority
-- Adds priority column to discounts table.
-- Run this in Supabase SQL Editor.

ALTER TABLE discounts ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 99;

CREATE INDEX IF NOT EXISTS idx_disc_priority ON discounts(tenant_id, priority);

COMMENT ON COLUMN discounts.priority IS '1 = highest priority. Used when multiple discounts match a customer.';
