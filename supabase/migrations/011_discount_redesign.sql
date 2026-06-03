-- ============================================================
-- OmniBot SaaS -- Migration 011: Discount System Redesign
-- Replaces old discount_rules + discount_categories + discounts
-- with normalized discount_rules, discounts (named offers),
-- and order_discounts (applied log).
-- ============================================================

-- ── Drop old tables (CASCADE removes dependent policies/indexes)
DROP TABLE IF EXISTS discounts           CASCADE;
DROP TABLE IF EXISTS discount_categories CASCADE;
DROP TABLE IF EXISTS discount_rules      CASCADE;

-- ── 1. discount_rules — pure logic, no priority/is_active/dates ──
CREATE TABLE discount_rules (
    rule_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID        NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    rule_name  TEXT        NOT NULL,
    rule_type  TEXT        NOT NULL,
    conditions JSONB       NOT NULL DEFAULT '{}',
    reward     JSONB       NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT dr_rule_type_check CHECK (rule_type IN (
        'cart_value', 'repeated_customer', 'new_customer',
        'specific_product', 'specific_category', 'bulk_quantity',
        'district', 'time_based', 'seasonal', 'lifetime_value'
    ))
);

ALTER TABLE discount_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dr_own" ON discount_rules
    FOR ALL USING (tenant_id = auth.uid());
CREATE INDEX idx_dr_tenant ON discount_rules(tenant_id);


-- ── 2. discounts — named offers with rule arrays ──────────────
CREATE TABLE discounts (
    discount_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID        NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    discount_name  TEXT        NOT NULL,
    discount_code  TEXT        NOT NULL UNIQUE,
    rule_ids       UUID[]      NOT NULL DEFAULT '{}',
    effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_to   TIMESTAMPTZ,
    is_lifetime    BOOLEAN     NOT NULL DEFAULT false,
    is_active      BOOLEAN     NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE discounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "disc_own" ON discounts
    FOR ALL USING (tenant_id = auth.uid());
CREATE INDEX idx_disc_tenant ON discounts(tenant_id);
CREATE INDEX idx_disc_active ON discounts(tenant_id, is_active);
CREATE INDEX idx_disc_code   ON discounts(discount_code);


-- ── 3. order_discounts — per-order applied discount log ───────
CREATE TABLE order_discounts (
    id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID          NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    order_id        UUID          NOT NULL REFERENCES orders(order_id)   ON DELETE CASCADE,
    discount_id     UUID          NOT NULL REFERENCES discounts(discount_id),
    discount_code   TEXT          NOT NULL,
    discount_name   TEXT          NOT NULL,
    rule_id         UUID          NOT NULL REFERENCES discount_rules(rule_id),
    rule_name       TEXT          NOT NULL,
    rule_type       TEXT          NOT NULL,
    product_id      UUID          REFERENCES products(product_id),
    sku             TEXT,
    product_name    TEXT,
    reward_type     TEXT          NOT NULL,
    discount_pct    NUMERIC(5,2)  NOT NULL DEFAULT 0,
    discount_flat   NUMERIC(10,2) NOT NULL DEFAULT 0,
    bonus_items     JSONB         NOT NULL DEFAULT '[]',
    original_price  NUMERIC(10,2),
    discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    final_price     NUMERIC(10,2),
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

ALTER TABLE order_discounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "od_own" ON order_discounts
    FOR ALL USING (tenant_id = auth.uid());
CREATE INDEX idx_od_tenant   ON order_discounts(tenant_id);
CREATE INDEX idx_od_order    ON order_discounts(order_id);
CREATE INDEX idx_od_discount ON order_discounts(discount_id);
CREATE INDEX idx_od_code     ON order_discounts(discount_code);


-- ── 4. Update orders table ────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_code   TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS original_amount NUMERIC(10,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS net_amount      NUMERIC(10,2);

CREATE INDEX IF NOT EXISTS idx_orders_discount_code ON orders(discount_code);

-- Drop legacy one-off discount columns (safe no-op if absent)
ALTER TABLE orders DROP COLUMN IF EXISTS discount_type;
ALTER TABLE orders DROP COLUMN IF EXISTS discount_rule_type;
ALTER TABLE orders DROP COLUMN IF EXISTS discount_rule_name;
ALTER TABLE orders DROP COLUMN IF EXISTS discount_value;
ALTER TABLE orders DROP COLUMN IF EXISTS discount_pct;
ALTER TABLE orders DROP COLUMN IF EXISTS bonus_items;
ALTER TABLE orders DROP COLUMN IF EXISTS original_price;
ALTER TABLE orders DROP COLUMN IF EXISTS final_price;
