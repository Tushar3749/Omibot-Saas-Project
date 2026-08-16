-- ════════════════════════════════════════════════════════════════════════════
--  OmniBot SaaS — Migration 032: Per-Tenant Gemini API Key
--
--  Each tenant can set their own Gemini API key from the dashboard
--  (AI Settings → ইন্টিগ্রেশন → 🤖 Gemini AI API). The key is validated live
--  via a real Gemini call before saving, encrypted at rest (AES-256, same
--  scheme as Facebook/Instagram page tokens), and used for that tenant's
--  bot instead of the platform default GEMINI_API_KEY.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS gemini_api_key          TEXT;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS gemini_model            TEXT        DEFAULT 'gemini-2.5-flash';
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS gemini_key_valid        BOOLEAN     DEFAULT false;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS gemini_key_last_checked TIMESTAMPTZ;
