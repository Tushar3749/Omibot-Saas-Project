-- ============================================================
-- OmniBot SaaS -- Migration 010: Normalized Discount Architecture
-- 1. Create discounts table (normalized per-order breakdown)
-- 2. Add discount_code, net_amount, original_amount to orders
-- 3. Drop legacy discount columns from orders
-- ============================================================

-- STEP 1: Create discounts table
CREATE TABLE IF NOT EXISTS discounts (
    discount_id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID          NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    discount_code          TEXT          NOT NULL,
    discount_rule_type     TEXT          NOT NULL,
    discount_rule_id       UUID,
    discount_rule_name     TEXT          NOT NULL DEFAULT '',
    discount_category_id   UUID          REFERENCES discount_categories(category_id),
    discount_category_name TEXT,
    product_id             UUID          REFERENCES products(product_id),
    sku                    TEXT,
    product_name           TEXT,
    reward_type            TEXT          NOT NULL DEFAULT 'percentage',
    discount_pct           NUMERIC(5,2)  NOT NULL DEFAULT 0,
    discount_flat          NUMERIC(10,2) NOT NULL DEFAULT 0,
    bonus_items            JSONB         NOT NULL DEFAULT '[]',
    original_price         NUMERIC(10,2),
    discount_amount        NUMERIC(10,2) NOT NULL DEFAULT 0,
    final_price            NUMERIC(10,2),
    created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT discounts_reward_type_check
        CHECK (reward_type IN ('percentage','flat','bonus','free_delivery')),
    CONSTRAINT discounts_unique_code_product
        UNIQUE (discount_code, product_id)
);

ALTER TABLE discounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "discounts_own" ON discounts
    FOR ALL USING (tenant_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_discounts_tenant ON discounts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_discounts_code   ON discounts(discount_code);
CREATE INDEX IF NOT EXISTS idx_discounts_order  ON discounts(tenant_id, discount_code);


-- STEP 2: Add discount_code + amount columns to orders
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS discount_code   TEXT,
    ADD COLUMN IF NOT EXISTS original_amount NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS net_amount      NUMERIC(10,2);

CREATE INDEX IF NOT EXISTS idx_orders_discount_code ON orders(discount_code);


-- STEP 3: Drop legacy discount columns from orders (IF EXISTS -- safe no-op if absent)
ALTER TABLE orders DROP COLUMN IF EXISTS discount_type;
ALTER TABLE orders DROP COLUMN IF EXISTS discount_rule_type;
ALTER TABLE orders DROP COLUMN IF EXISTS discount_rule_name;
ALTER TABLE orders DROP COLUMN IF EXISTS discount_value;
ALTER TABLE orders DROP COLUMN IF EXISTS discount_pct;
ALTER TABLE orders DROP COLUMN IF EXISTS bonus_items;
ALTER TABLE orders DROP COLUMN IF EXISTS original_price;
ALTER TABLE orders DROP COLUMN IF EXISTS final_price;
