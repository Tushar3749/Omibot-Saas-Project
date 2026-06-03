-- ============================================================
-- OmniBot SaaS -- Migration 011: Discounts Report Fields
-- Add effective_from, effective_to, is_active to discounts
-- ============================================================

ALTER TABLE discounts
    ADD COLUMN IF NOT EXISTS effective_from TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS effective_to   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS is_active      BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_discounts_active
    ON discounts(tenant_id, is_active);

CREATE INDEX IF NOT EXISTS idx_discounts_effective
    ON discounts(tenant_id, effective_from, effective_to);
