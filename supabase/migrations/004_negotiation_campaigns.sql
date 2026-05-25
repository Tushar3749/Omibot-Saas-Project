-- ════════════════════════════════════════════════════════════════════════════
--  OmniBot SaaS — Migration 004: Negotiation + Campaigns
--  Run in: Supabase Dashboard → SQL Editor → Run
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Per-product negotiation fields ────────────────────────────────────────
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS min_price         NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS negotiation_style TEXT
    CHECK (negotiation_style IN ('aggressive', 'moderate', 'soft'));

-- ── 2. Global negotiation fields on ai_config ─────────────────────────────────
ALTER TABLE ai_config
  ADD COLUMN IF NOT EXISTS max_discount_pct   NUMERIC(5,2)  DEFAULT 15,
  ADD COLUMN IF NOT EXISTS negotiation_style  TEXT          DEFAULT 'moderate'
    CHECK (negotiation_style IN ('aggressive', 'moderate', 'soft')),
  ADD COLUMN IF NOT EXISTS negotiation_phrases TEXT[]       DEFAULT '{}';

-- ── 3. Campaigns table ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaigns (
    campaign_id  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID          NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    name         TEXT          NOT NULL,
    description  TEXT,
    type         TEXT          NOT NULL DEFAULT 'percentage'
                                   CHECK (type IN ('percentage', 'flat', 'bonus')),
    amount       NUMERIC(10,2) NOT NULL CHECK (amount > 0),
    start_date   TIMESTAMPTZ,
    end_date     TIMESTAMPTZ,
    apply_to     TEXT          NOT NULL DEFAULT 'all'
                                   CHECK (apply_to IN ('all', 'specific')),
    product_ids  TEXT[]        DEFAULT '{}',  -- product_id strings for 'specific' mode
    is_active    BOOLEAN       NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON campaigns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_active ON campaigns(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_campaigns_dates  ON campaigns(tenant_id, start_date, end_date);

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaigns_own"
    ON campaigns FOR ALL
    USING (tenant_id = auth.uid());

-- ── 4. Auto-update trigger for campaigns ─────────────────────────────────────
DO $$
BEGIN
    EXECUTE '
        DROP TRIGGER IF EXISTS set_updated_at ON campaigns;
        CREATE TRIGGER set_updated_at
        BEFORE UPDATE ON campaigns
        FOR EACH ROW EXECUTE FUNCTION update_updated_at();';
END;
$$;
