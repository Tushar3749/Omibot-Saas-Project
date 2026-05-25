-- ════════════════════════════════════════════════════════════════════════════
--  OmniBot SaaS — Migration 002: Products CSV Import System
--  Run AFTER 001_initial_schema.sql in Supabase Dashboard → SQL Editor
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
--  STEP 1: Alter products table → new product catalog schema
-- ─────────────────────────────────────────────────────────────────────────────

-- 1a. Add SKU column (we backfill before setting NOT NULL)
ALTER TABLE products ADD COLUMN IF NOT EXISTS sku TEXT;

-- 1b. Backfill SKU for any pre-existing rows
UPDATE products
   SET sku = 'SKU-' || UPPER(SUBSTRING(product_id::TEXT, 1, 8))
 WHERE sku IS NULL;

-- 1c. Now enforce NOT NULL
ALTER TABLE products ALTER COLUMN sku SET NOT NULL;

-- 1d. Unique SKU per tenant
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_tenant_sku_unique;
ALTER TABLE products ADD  CONSTRAINT products_tenant_sku_unique UNIQUE (tenant_id, sku);

-- 1e. Rename price → mrp (only if 'price' column still exists)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE  table_name = 'products' AND column_name = 'price'
    ) THEN
        ALTER TABLE products RENAME COLUMN price TO mrp;
    END IF;
END $$;

-- 1f. Fix CHECK constraint name after rename
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_price_check;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_mrp_check;
ALTER TABLE products ADD  CONSTRAINT products_mrp_check CHECK (mrp > 0);

-- 1g. New optional top-level columns
ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_price    NUMERIC(10, 2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_category TEXT;

-- 1h. Migrate `description` → extra_fields then drop
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE  table_name = 'products' AND column_name = 'description'
    ) THEN
        UPDATE products
           SET extra_fields = extra_fields || JSONB_BUILD_OBJECT('description', description)
         WHERE description IS NOT NULL AND description <> '';

        ALTER TABLE products DROP COLUMN description;
    END IF;
END $$;

-- 1i. Migrate `min_price` → extra_fields then drop
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE  table_name = 'products' AND column_name = 'min_price'
    ) THEN
        UPDATE products
           SET extra_fields = extra_fields || JSONB_BUILD_OBJECT('min_price', min_price)
         WHERE min_price IS NOT NULL;

        ALTER TABLE products DROP COLUMN min_price;
    END IF;
END $$;

-- 1j. GIN index on extra_fields for fast JSONB queries
CREATE INDEX IF NOT EXISTS idx_products_extra ON products USING gin(extra_fields);
CREATE INDEX IF NOT EXISTS idx_products_sku   ON products(tenant_id, sku);

-- ─────────────────────────────────────────────────────────────────────────────
--  STEP 2: Owner-defined custom product columns
--          Values live in products.extra_fields JSONB.
--          This table just stores the *schema* (what keys exist, their types).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_custom_columns (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    column_name  TEXT NOT NULL,        -- snake_case key stored in extra_fields
    display_name TEXT NOT NULL,        -- Human label shown in UI / CSV header
    column_type  TEXT NOT NULL DEFAULT 'text'
                     CHECK (column_type IN ('text', 'number', 'boolean', 'url')),
    is_required  BOOLEAN NOT NULL DEFAULT false,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, column_name)
);

CREATE INDEX IF NOT EXISTS idx_custom_cols_tenant ON product_custom_columns(tenant_id, sort_order);

ALTER TABLE product_custom_columns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "custom_cols_own"
    ON product_custom_columns FOR ALL
    USING (tenant_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
--  STEP 3: CSV import audit log
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS csv_import_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    import_type   TEXT NOT NULL DEFAULT 'products'
                      CHECK (import_type IN ('products', 'stock', 'campaign')),
    filename      TEXT,
    total_rows    INTEGER NOT NULL DEFAULT 0,
    imported      INTEGER NOT NULL DEFAULT 0,
    skipped       INTEGER NOT NULL DEFAULT 0,
    errors        INTEGER NOT NULL DEFAULT 0,
    error_details JSONB   NOT NULL DEFAULT '[]',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_csv_logs_tenant ON csv_import_logs(tenant_id, created_at DESC);

ALTER TABLE csv_import_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "csv_logs_own"
    ON csv_import_logs FOR ALL
    USING (tenant_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
--  DONE — Migration 002 complete
-- ─────────────────────────────────────────────────────────────────────────────
