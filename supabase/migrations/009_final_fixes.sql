-- ============================================================
-- OmniBot SaaS — Migration 009: Final System Fixes
-- 1. Drop bulk_discount_rules (moved to discount_rules)
-- 2. Create discount_categories table
-- 3. Add reward JSONB + discount_category_id to campaigns
-- 4. Migrate old campaign type/amount to reward JSONB
-- 5. Ensure reward JSONB on discount_rules
-- 6. Clean combos table (remove offer_price, stock)
-- 7. Clean combo_products (remove denormalized columns)
-- ============================================================

-- STEP 1: Drop legacy bulk_discount_rules table
DROP TABLE IF EXISTS bulk_discount_rules CASCADE;

-- STEP 2: Create discount_categories table
CREATE TABLE IF NOT EXISTS discount_categories (
    category_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    category_name TEXT        NOT NULL,
    description   TEXT,
    is_active     BOOLEAN     NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, category_name)
);
ALTER TABLE discount_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "discount_categories_own" ON discount_categories
    FOR ALL USING (tenant_id = auth.uid());
CREATE INDEX IF NOT EXISTS idx_discount_categories_tenant
    ON discount_categories(tenant_id);

-- STEP 3: Add reward JSONB and discount_category_id to campaigns
ALTER TABLE campaigns
    ADD COLUMN IF NOT EXISTS reward               JSONB DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS discount_category_id UUID  REFERENCES discount_categories(category_id);

-- STEP 4: Migrate old campaign type/amount → reward JSONB
UPDATE campaigns
SET reward = jsonb_build_object(
    'reward_type',    COALESCE(type, 'percentage'),
    'discount_value', COALESCE(amount, 0),
    'bonus_items',    '[]'::jsonb
)
WHERE reward IS NULL OR reward = '{}'::jsonb;

-- STEP 5: Ensure reward JSONB exists on discount_rules
ALTER TABLE discount_rules
    ADD COLUMN IF NOT EXISTS reward JSONB DEFAULT '{}';

-- STEP 6: Clean combos table — remove offer_price and stock
--         Stock is now managed through combo_products → stock table
ALTER TABLE combos DROP COLUMN IF EXISTS offer_price;
ALTER TABLE combos DROP COLUMN IF EXISTS stock;

-- STEP 7: Clean combo_products — remove denormalized product data
--         Product info fetched via join with products table
ALTER TABLE combo_products DROP COLUMN IF EXISTS sku;
ALTER TABLE combo_products DROP COLUMN IF EXISTS name;
ALTER TABLE combo_products DROP COLUMN IF EXISTS mrp;

-- Add FK on combo_products.product_id if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_combo_products_product'
          AND table_name = 'combo_products'
    ) THEN
        ALTER TABLE combo_products
            ADD CONSTRAINT fk_combo_products_product
            FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE;
    END IF;
END$$;

-- STEP 8: Indexes
CREATE INDEX IF NOT EXISTS idx_campaigns_reward      ON campaigns USING gin(reward);
CREATE INDEX IF NOT EXISTS idx_campaigns_category    ON campaigns(discount_category_id);
CREATE INDEX IF NOT EXISTS idx_discount_rules_reward ON discount_rules USING gin(reward);
