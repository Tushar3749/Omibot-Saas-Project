-- ── 005: Smart Discount Rules ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS discount_rules (
    rule_id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    rule_type           TEXT        NOT NULL CHECK (rule_type IN (
                            'cart_value', 'repeated_customer', 'new_customer',
                            'specific_product', 'specific_category', 'bulk_quantity',
                            'district', 'time_based', 'seasonal'
                        )),
    rule_name           TEXT        NOT NULL DEFAULT '',
    conditions          JSONB       NOT NULL DEFAULT '{}',
    reward              JSONB       NOT NULL DEFAULT '{}',
    priority            INTEGER     NOT NULL DEFAULT 99,
    is_active           BOOLEAN     NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add conflict resolution config to ai_config
ALTER TABLE ai_config
    ADD COLUMN IF NOT EXISTS conflict_resolution TEXT NOT NULL DEFAULT 'best_deal'
        CHECK (conflict_resolution IN ('best_deal', 'priority_wins', 'stack_all', 'stack_with_cap')),
    ADD COLUMN IF NOT EXISTS discount_stack_cap  NUMERIC NOT NULL DEFAULT 30,
    ADD COLUMN IF NOT EXISTS greeting_message    TEXT    NOT NULL DEFAULT '';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_discount_rules_tenant   ON discount_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_discount_rules_priority ON discount_rules(tenant_id, priority);
CREATE INDEX IF NOT EXISTS idx_discount_rules_type     ON discount_rules(tenant_id, rule_type);

-- RLS (service role bypasses this; added for completeness)
ALTER TABLE discount_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "discount_rules_service_role"
    ON discount_rules FOR ALL TO service_role USING (true);
