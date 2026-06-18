-- ═══════════════════════════════════════════════════════════════════════════
--  OmniBot SaaS — Migration 020: AI Settings Cleanup
--  Adds new columns for settings reorganisation:
--    • store_name              — branded shop name shown in bot identity
--    • return_window_days      — order return window (days)
--    • friday_offline_start    — configurable Friday offline start time
--    • friday_offline_end      — configurable Friday offline end time
--    • conflict_resolution     — discount conflict resolution mode
--    • discount_stack_cap      — max stack % when mode = stack_with_cap
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE ai_config
  ADD COLUMN IF NOT EXISTS store_name            TEXT,
  ADD COLUMN IF NOT EXISTS return_window_days    INTEGER       DEFAULT 7,
  ADD COLUMN IF NOT EXISTS friday_offline_start  TEXT          DEFAULT '13:00',
  ADD COLUMN IF NOT EXISTS friday_offline_end    TEXT          DEFAULT '15:00',
  ADD COLUMN IF NOT EXISTS conflict_resolution   TEXT          DEFAULT 'best_deal',
  ADD COLUMN IF NOT EXISTS discount_stack_cap    NUMERIC(5,2)  DEFAULT 30.00;

-- Enforce valid conflict-resolution values
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_config_conflict_resolution_check'
      AND conrelid = 'ai_config'::regclass
  ) THEN
    ALTER TABLE ai_config
      ADD CONSTRAINT ai_config_conflict_resolution_check
      CHECK (conflict_resolution IN ('best_deal','priority_wins','stack_all','stack_with_cap'));
  END IF;
END $$;
