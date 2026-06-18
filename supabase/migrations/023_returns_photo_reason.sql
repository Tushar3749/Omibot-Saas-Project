-- ═══════════════════════════════════════════════════════════════════════════
--  OmniBot SaaS — Migration 023: returns photo and reason columns
--  Adds reason (free-text) and photo_url for the new return flow v2.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE returns
  ADD COLUMN IF NOT EXISTS reason    TEXT,
  ADD COLUMN IF NOT EXISTS photo_url TEXT;
