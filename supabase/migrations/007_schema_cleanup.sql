-- ============================================================
-- OmniBot SaaS — Migration 007: Schema Cleanup
-- Separates stock and product_images into dedicated tables.
-- Removes deprecated discount/negotiation columns.
-- ============================================================

-- STEP 1: Create stock table
CREATE TABLE IF NOT EXISTS stock (
    stock_id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    product_id          UUID        NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    current_stock       INTEGER     NOT NULL DEFAULT 0,
    reserved_stock      INTEGER     NOT NULL DEFAULT 0,
    low_stock_threshold INTEGER     NOT NULL DEFAULT 10,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, product_id)
);
ALTER TABLE stock ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stock_own" ON stock FOR ALL USING (tenant_id = auth.uid());

-- STEP 2: Create product_images table
CREATE TABLE IF NOT EXISTS product_images (
    image_id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    product_id          UUID        NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
    image_url           TEXT        NOT NULL,
    image_description   TEXT,
    embedding           vector(768),
    is_primary          BOOLEAN     NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE product_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "product_images_own" ON product_images FOR ALL USING (tenant_id = auth.uid());

-- STEP 3: Migrate stock values from products → stock table
INSERT INTO stock (tenant_id, product_id, current_stock)
SELECT tenant_id, product_id, COALESCE(stock, 0)
FROM products
WHERE is_active = true
ON CONFLICT (tenant_id, product_id) DO NOTHING;

-- STEP 4: Remove deprecated columns from products
ALTER TABLE products DROP COLUMN IF EXISTS stock;
ALTER TABLE products DROP COLUMN IF EXISTS discount_price;
ALTER TABLE products DROP COLUMN IF EXISTS discount_category;
ALTER TABLE products DROP COLUMN IF EXISTS min_price;
ALTER TABLE products DROP COLUMN IF EXISTS negotiation_style;

-- STEP 5: Remove deprecated columns from ai_config
ALTER TABLE ai_config DROP COLUMN IF EXISTS max_discount_pct;
ALTER TABLE ai_config DROP COLUMN IF EXISTS negotiation_style;
ALTER TABLE ai_config DROP COLUMN IF EXISTS allow_negotiation;
ALTER TABLE ai_config DROP COLUMN IF EXISTS negotiation_phrases;

-- STEP 6: Indexes for performance
CREATE INDEX IF NOT EXISTS idx_stock_tenant_product ON stock(tenant_id, product_id);
CREATE INDEX IF NOT EXISTS idx_stock_low  ON stock(tenant_id, current_stock);
CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(tenant_id, product_id);
