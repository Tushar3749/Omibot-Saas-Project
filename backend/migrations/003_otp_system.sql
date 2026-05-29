-- OmniBot SaaS — OTP Order Tracking Migration (v3)
-- Run AFTER 002_advanced_features.sql

-- ── OTP Verifications ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS otp_verifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL,
  phone          TEXT NOT NULL,
  otp_hash       TEXT NOT NULL,         -- HMAC-SHA256, never plain text
  expires_at     TIMESTAMPTZ NOT NULL,
  attempts       INTEGER DEFAULT 0,
  is_used        BOOLEAN DEFAULT FALSE,
  blocked_until  TIMESTAMPTZ,           -- set when attempts >= 3
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Fast lookup: most recent OTP for a phone per tenant
CREATE INDEX IF NOT EXISTS idx_otp_tenant_phone ON otp_verifications(tenant_id, phone, created_at DESC);

-- ── SMS Settings in ai_config ─────────────────────────────────────────────────
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS sms_enabled          BOOLEAN DEFAULT FALSE;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS sms_provider         TEXT DEFAULT 'ssl_wireless'; -- ssl_wireless | twilio
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS ssl_wireless_api_key TEXT;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS ssl_wireless_sid     TEXT;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS twilio_account_sid   TEXT;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS twilio_auth_token    TEXT;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS twilio_from_number   TEXT;

-- Auto-clean expired OTPs older than 1 day (run periodically)
-- DELETE FROM otp_verifications WHERE expires_at < NOW() - INTERVAL '1 day';
