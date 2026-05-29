-- OmniBot SaaS — New Features Migration
-- Run this in your Supabase SQL Editor

-- Combo offers
CREATE TABLE IF NOT EXISTS combos (
  combo_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  combo_sku TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(12,2) NOT NULL,
  offer_price NUMERIC(12,2) NOT NULL,
  stock INTEGER DEFAULT 0,
  image_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, combo_sku)
);

-- Products in each combo
CREATE TABLE IF NOT EXISTS combo_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_id UUID NOT NULL REFERENCES combos(combo_id) ON DELETE CASCADE,
  product_id UUID NOT NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  mrp NUMERIC(12,2),
  quantity INTEGER DEFAULT 1
);

-- Stock history log
CREATE TABLE IF NOT EXISTS stock_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  product_id UUID,
  combo_id UUID,
  sku TEXT NOT NULL,
  change_type TEXT NOT NULL, -- manual | order_placed | order_cancelled | return | damage | expiry | import
  quantity_change INTEGER NOT NULL, -- positive = increase, negative = decrease
  quantity_before INTEGER,
  quantity_after INTEGER,
  reference_id TEXT, -- order_id, return_id, etc.
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Returns / damage / expiry
CREATE TABLE IF NOT EXISTS returns (
  return_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  product_id UUID,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  return_type TEXT NOT NULL DEFAULT 'return', -- return | damage | expiry
  reason TEXT,
  order_id TEXT,
  customer_name TEXT,
  status TEXT DEFAULT 'pending', -- pending | processed | rejected
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- Complaints (AI-detected + manual)
CREATE TABLE IF NOT EXISTS complaints (
  complaint_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  conversation_id TEXT,
  customer_name TEXT,
  customer_id TEXT,
  product_mentioned TEXT,
  complaint_text TEXT NOT NULL,
  complaint_type TEXT DEFAULT 'general', -- delivery | product_quality | wrong_item | general | pricing
  status TEXT DEFAULT 'open', -- open | in_progress | resolved | dismissed
  priority TEXT DEFAULT 'medium', -- low | medium | high
  source TEXT DEFAULT 'ai', -- ai | manual
  resolution_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- Per-product negotiation rules
CREATE TABLE IF NOT EXISTS negotiation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  product_id UUID NOT NULL,
  sku TEXT NOT NULL,
  product_name TEXT,
  max_discount_pct NUMERIC(5,2) DEFAULT 15,
  min_price NUMERIC(12,2),
  negotiation_style TEXT DEFAULT 'moderate', -- aggressive | moderate | soft
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, product_id)
);

-- Add low_stock_threshold column to tenants if not exists
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER DEFAULT 5;

-- AI Config table (create if missing; safe to run even if it already exists)
CREATE TABLE IF NOT EXISTS ai_config (
  config_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE,   -- UNIQUE allows INSERT … ON CONFLICT
  bot_name TEXT DEFAULT 'OmniBot',
  system_prompt TEXT,
  language TEXT DEFAULT 'bangla',
  allow_negotiation BOOLEAN DEFAULT TRUE,
  escalation_keywords TEXT[] DEFAULT ARRAY[]::TEXT[],
  forbidden_topics TEXT[] DEFAULT ARRAY[]::TEXT[],
  negotiation_phrases TEXT[] DEFAULT ARRAY[]::TEXT[],
  prompt_injection_guard BOOLEAN DEFAULT TRUE,
  max_discount_pct NUMERIC(5,2) DEFAULT 15,
  negotiation_style TEXT DEFAULT 'moderate',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure the unique index exists for upsert support (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS ai_config_tenant_id_idx ON ai_config(tenant_id);
