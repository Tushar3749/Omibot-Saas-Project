-- ─────────────────────────────────────────────────────────────────────────────
--  Migration 003 — Password Reset Tokens
--  Adds reset_token and reset_token_expires_at columns to tenants table.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS reset_token           TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMPTZ DEFAULT NULL;

-- Partial index: fast lookup by token (only rows that have an active token)
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_reset_token
  ON tenants (reset_token)
  WHERE reset_token IS NOT NULL;
