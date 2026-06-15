-- ═══════════════════════════════════════════════════════════════════════════
--  OmniBot SaaS — Migration 024: returns table — complete schema
--  Adds photo_verified, gemini_analysis, owner_note, updated_at,
--  conversation_id and a partial unique index (one active return per order).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE returns
  ADD COLUMN IF NOT EXISTS photo_verified   BOOLEAN          DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS gemini_analysis  JSONB,
  ADD COLUMN IF NOT EXISTS owner_note       TEXT,
  ADD COLUMN IF NOT EXISTS conversation_id  UUID,
  ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ      DEFAULT NOW();

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION set_returns_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_returns_updated_at ON returns;
CREATE TRIGGER trg_returns_updated_at
  BEFORE UPDATE ON returns
  FOR EACH ROW EXECUTE FUNCTION set_returns_updated_at();

-- One active (pending/approved) return per order per tenant
-- Rejected returns don't block a re-submission
CREATE UNIQUE INDEX IF NOT EXISTS returns_order_active_unique
  ON returns (tenant_id, order_id)
  WHERE status IN ('pending', 'approved');
