-- ============================================================
-- Migration 019: AI Settings Cleanup
-- Part 1 (schema changes) was applied via backend/migrations/008_part1_critical_fixes.sql
-- This file is the canonical Supabase-style record of all changes.
-- Run in Supabase SQL Editor. All statements are idempotent (IF NOT EXISTS / IF EXISTS).
-- ============================================================

-- ── NEW COLUMNS ──────────────────────────────────────────────────────────────

-- Store name shown in Gemini system prompt and bot identity
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS store_name TEXT DEFAULT 'আমাদের স্টোর';

-- Seed primary tenant store name
UPDATE ai_config
SET store_name = 'Learn BI with Tushar'
WHERE tenant_id = 'c951f683-4332-4f5a-aa0a-040e8740e8d4'
  AND (store_name IS NULL OR store_name = 'আমাদের স্টোর');

-- Return window for order returns (days)
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS return_window_days INTEGER DEFAULT 7;

-- Configurable Friday prayer offline window (hour of day, 24h)
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS friday_start_hour INTEGER DEFAULT 13;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS friday_end_hour   INTEGER DEFAULT 15;

-- ── DROPPED ORPHAN COLUMNS ───────────────────────────────────────────────────
-- These were in ai_config but never read or written by bot or UI.

ALTER TABLE ai_config DROP COLUMN IF EXISTS allow_negotiation;
ALTER TABLE ai_config DROP COLUMN IF EXISTS negotiation_phrases;
ALTER TABLE ai_config DROP COLUMN IF EXISTS negotiation_style;
ALTER TABLE ai_config DROP COLUMN IF EXISTS max_discount_pct;
ALTER TABLE ai_config DROP COLUMN IF EXISTS discount_priority_settings;
ALTER TABLE ai_config DROP COLUMN IF EXISTS price_range_filter_enabled;
ALTER TABLE ai_config DROP COLUMN IF EXISTS catalog_pdf_auto_send;
ALTER TABLE ai_config DROP COLUMN IF EXISTS competitor_response_template;

-- ── DROPPED TABLES ───────────────────────────────────────────────────────────
-- Per-product negotiation rules table — UI removed, bot never used this table.
-- Negotiation happens purely through Gemini system prompt.

DROP TABLE IF EXISTS negotiation_rules CASCADE;
