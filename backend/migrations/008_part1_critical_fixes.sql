-- OmniBot SaaS — Part 1 Critical Fixes Migration
-- Run in Supabase SQL Editor AFTER 007_discount_priority_settings.sql

-- ── CRITICAL FIX 1: store_name ────────────────────────────────────────────────
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS store_name TEXT DEFAULT 'আমাদের স্টোর';

-- Set store name for the primary tenant
UPDATE ai_config
SET store_name = 'Learn BI with Tushar'
WHERE tenant_id = 'c951f683-4332-4f5a-aa0a-040e8740e8d4';

-- ── CRITICAL FIX 2: return_window_days ───────────────────────────────────────
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS return_window_days INTEGER DEFAULT 7;

-- ── CRITICAL FIX 3: friday prayer time configurable ──────────────────────────
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS friday_start_hour INTEGER DEFAULT 13;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS friday_end_hour   INTEGER DEFAULT 15;

-- ── REMOVE: Orphan columns never used by bot ─────────────────────────────────
ALTER TABLE ai_config DROP COLUMN IF EXISTS allow_negotiation;
ALTER TABLE ai_config DROP COLUMN IF EXISTS negotiation_phrases;
ALTER TABLE ai_config DROP COLUMN IF EXISTS negotiation_style;
ALTER TABLE ai_config DROP COLUMN IF EXISTS max_discount_pct;
ALTER TABLE ai_config DROP COLUMN IF EXISTS discount_priority_settings;
ALTER TABLE ai_config DROP COLUMN IF EXISTS price_range_filter_enabled;
ALTER TABLE ai_config DROP COLUMN IF EXISTS catalog_pdf_auto_send;
ALTER TABLE ai_config DROP COLUMN IF EXISTS competitor_response_template;

-- ── REMOVE: Per-product negotiation rules table ───────────────────────────────
DROP TABLE IF EXISTS negotiation_rules CASCADE;
