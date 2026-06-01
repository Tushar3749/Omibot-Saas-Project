-- ============================================================
-- OmniBot SaaS — Migration 008: Returns System v2 + Weight
-- - Drops old returns table, creates new schema
-- - Adds weight column to products
-- - Adds return_window_days to ai_config
-- ============================================================

-- STEP 1: Add weight to products
ALTER TABLE products ADD COLUMN IF NOT EXISTS weight TEXT;

-- STEP 2: Add return_window_days to ai_config (default 7 days)
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS return_window_days INTEGER NOT NULL DEFAULT 7;

-- STEP 3: Drop old returns table and recreate
DROP TABLE IF EXISTS returns CASCADE;

CREATE TABLE returns (
    return_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    order_id        TEXT,
    customer_phone  TEXT,
    return_type     TEXT        NOT NULL DEFAULT 'full'
                    CHECK (return_type IN ('full', 'partial')),
    status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    items           JSONB       NOT NULL DEFAULT '[]',
    owner_note      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (order_id)   -- one return per order; NULLs are exempt
);

ALTER TABLE returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "returns_own" ON returns FOR ALL USING (tenant_id = auth.uid());

-- STEP 4: Index for fast tenant queries
CREATE INDEX IF NOT EXISTS idx_returns_tenant_status ON returns(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_returns_order ON returns(order_id);
