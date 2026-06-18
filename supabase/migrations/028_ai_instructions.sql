-- Migration 028: ai_instructions table + ai_config personality columns

CREATE TABLE IF NOT EXISTS ai_instructions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  title       TEXT        NOT NULL,
  body        TEXT        NOT NULL,
  sort_order  INT         NOT NULL DEFAULT 0,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_instructions_tenant
  ON ai_instructions(tenant_id, sort_order, created_at);

ALTER TABLE ai_instructions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_instructions_tenant_rls" ON ai_instructions
  FOR ALL USING (tenant_id = auth.uid());

-- Personality columns on ai_config
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS use_emoji        BOOLEAN DEFAULT true;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS response_length  TEXT    DEFAULT 'medium';
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS suggest_products BOOLEAN DEFAULT true;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS answer_general   BOOLEAN DEFAULT true;
