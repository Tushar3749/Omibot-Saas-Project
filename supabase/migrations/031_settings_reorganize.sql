-- ════════════════════════════════════════════════════════════════════════════
--  OmniBot SaaS — Migration 031: Settings Reorganization
--
--  Adds all ai_config columns that the UI writes to but were never formally
--  migrated. Safe to run multiple times (IF NOT EXISTS).
--
--  UI changes (no DB changes needed):
--    • greeting_message  → moved from পরিচয় tab  to টেমপ্লেট tab
--    • hartal_message    → moved from স্থানীয় tab to টেমপ্লেট tab
--    • eid_greeting_*    → moved from স্থানীয় tab to টেমপ্লেট tab
--    • delivery_charges  → moved from স্থানীয় tab to অর্ডার   tab
--    • sms_*             → moved from ইন্টিগ্রেশন to সিকিউরিটি tab
--    • use_emoji etc.    → removed from AI আচরণ  tab (bot ব্যক্তিত্ব section)
-- ════════════════════════════════════════════════════════════════════════════

-- ── স্থানীয় সেটিংস: local operational modes ────────────────────────────────
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS hartal_mode             BOOLEAN  DEFAULT false;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS hartal_message          TEXT;

ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS friday_offline_enabled  BOOLEAN  DEFAULT false;
-- friday_offline_start / friday_offline_end already added in migration 020

ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS ramadan_mode            BOOLEAN  DEFAULT false;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS ramadan_start_time      TEXT     DEFAULT '09:00';
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS ramadan_end_time        TEXT     DEFAULT '17:00';

ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS eid_greeting_enabled    BOOLEAN  DEFAULT false;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS eid_greeting_date       TEXT;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS eid_greeting_message    TEXT;

-- ── AI আচরণ: product image auto-send ────────────────────────────────────────
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS product_image_auto_send BOOLEAN  DEFAULT true;

-- ── SMS OTP: verification for order tracking ─────────────────────────────────
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS sms_enabled             BOOLEAN  DEFAULT false;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS sms_provider            TEXT     DEFAULT 'ssl_wireless';
-- SSL Wireless credentials
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS ssl_wireless_api_key    TEXT;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS ssl_wireless_sid        TEXT;
-- Twilio credentials
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS twilio_account_sid      TEXT;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS twilio_auth_token       TEXT;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS twilio_from_number      TEXT;

-- ── টেমপ্লেট: message templates (coming soon — columns ready now) ────────────
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS tpl_shipping_confirm    TEXT;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS tpl_delay_notify        TEXT;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS tpl_out_of_stock        TEXT;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS tpl_wrong_item          TEXT;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS tpl_review_request      TEXT;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS tpl_referral            TEXT;
