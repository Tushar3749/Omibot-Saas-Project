-- Migration 030: ai_summary columns on ai_config
-- Stores the Gemini-generated summary of owner instructions + KB docs.
-- Safe to run multiple times (IF NOT EXISTS).

ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS ai_summary             TEXT;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS ai_summary_points      JSONB DEFAULT '[]';
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS ai_summary_updated_at  TIMESTAMPTZ;
