-- ============================================================
-- Migration 029: All Fixes — Stock Sync + Catch-up Schema
-- Run this in Supabase SQL Editor.
-- Safe to run multiple times (IF NOT EXISTS / ON CONFLICT DO NOTHING).
-- ============================================================

-- ── 1. Orders: ensure all columns exist (from 027) ─────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name    TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS items            JSONB DEFAULT '[]';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_code    TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS original_amount  NUMERIC(10,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS net_amount       NUMERIC(10,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS district         TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_charge  NUMERIC(10,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_ref        TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_ref   ON orders(tenant_id, order_ref);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(tenant_id, customer_phone);

-- ── 2. AI Instructions table (from 028) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_instructions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  title       TEXT        NOT NULL,
  body        TEXT        NOT NULL,
  sort_order  INT         NOT NULL DEFAULT 0,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_instructions_tenant
  ON ai_instructions(tenant_id, sort_order, created_at);

ALTER TABLE ai_instructions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ai_instructions'
    AND policyname  = 'ai_instructions_tenant_rls'
  ) THEN
    CREATE POLICY "ai_instructions_tenant_rls" ON ai_instructions
      FOR ALL USING (tenant_id = auth.uid());
  END IF;
END $$;

-- ── 3. AI Config: personality columns (from 028) ───────────────────────────
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS use_emoji        BOOLEAN DEFAULT true;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS response_length  TEXT    DEFAULT 'medium';
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS suggest_products BOOLEAN DEFAULT true;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS answer_general   BOOLEAN DEFAULT true;

-- ── 4. Stock sync ───────────────────────────────────────────────────────────
-- Create missing stock rows for products that have no stock entry
INSERT INTO stock (tenant_id, product_id, current_stock, physical_stock, issued_stock)
SELECT p.tenant_id, p.product_id, 0, 0, 0
FROM products p
WHERE NOT EXISTS (
    SELECT 1 FROM stock s
    WHERE s.product_id = p.product_id
      AND s.tenant_id  = p.tenant_id
)
ON CONFLICT DO NOTHING;

-- Sync physical_stock ← current_stock where physical_stock is 0 but current_stock has a value
UPDATE stock
SET    physical_stock = current_stock
WHERE  physical_stock = 0
  AND  current_stock  > 0;

-- Recalculate current_stock = physical_stock - issued_stock (floor at 0)
UPDATE stock
SET    current_stock = GREATEST(0, physical_stock - issued_stock)
WHERE  physical_stock > 0;
