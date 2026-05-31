-- ── 007: discount_priority_settings column on ai_config ─────────────────────

ALTER TABLE ai_config
    ADD COLUMN IF NOT EXISTS discount_priority_settings JSONB NOT NULL DEFAULT '{}';
