-- OmniBot SaaS — Advanced Features Migration (v2)
-- Run in Supabase SQL Editor AFTER 001_new_features.sql

-- ── Order Management Settings ─────────────────────────────────────────────────
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS min_order_amount       NUMERIC(12,2) DEFAULT 0;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS max_order_qty_per_customer INTEGER DEFAULT 0;   -- 0 = unlimited
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS preorder_enabled       BOOLEAN DEFAULT FALSE;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS waitlist_enabled       BOOLEAN DEFAULT FALSE;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS partial_payment_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS partial_payment_advance_pct NUMERIC(5,2) DEFAULT 50;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS payment_deadline_hours INTEGER DEFAULT 24;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS installment_enabled    BOOLEAN DEFAULT FALSE;

-- ── Message Templates ─────────────────────────────────────────────────────────
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS tpl_shipping_confirm   TEXT;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS tpl_delay_notify       TEXT;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS tpl_out_of_stock       TEXT;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS tpl_wrong_item         TEXT;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS tpl_review_request     TEXT;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS tpl_referral           TEXT;

-- ── Smart AI Responses ────────────────────────────────────────────────────────
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS price_range_filter_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS product_image_auto_send   BOOLEAN DEFAULT FALSE;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS catalog_pdf_auto_send     BOOLEAN DEFAULT FALSE;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS competitor_response_template TEXT;

-- ── Bangladesh Specific ───────────────────────────────────────────────────────
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS pathao_store_id        TEXT;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS pathao_client_id       TEXT;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS pathao_client_secret   TEXT;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS steadfast_api_key      TEXT;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS steadfast_api_secret   TEXT;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS sundarban_enabled      BOOLEAN DEFAULT FALSE;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS hartal_mode            BOOLEAN DEFAULT FALSE;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS hartal_message         TEXT DEFAULT 'আমরা বর্তমানে হরতাল/ধর্মঘটের কারণে ডেলিভারি বন্ধ রেখেছি। পরে যোগাযোগ করুন।';
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS friday_offline_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS ramadan_mode           BOOLEAN DEFAULT FALSE;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS ramadan_start_time     TEXT DEFAULT '09:00';
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS ramadan_end_time       TEXT DEFAULT '17:00';
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS eid_greeting_enabled   BOOLEAN DEFAULT FALSE;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS eid_greeting_date      DATE;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS eid_greeting_message   TEXT DEFAULT 'ঈদ মোবারক! 🌙 আমাদের সকল গ্রাহকদের জানাই ঈদের শুভেচ্ছা ও ভালোবাসা।';

-- ── Loyalty & Referral ────────────────────────────────────────────────────────
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS loyalty_enabled        BOOLEAN DEFAULT FALSE;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS loyalty_points_per_taka NUMERIC(8,4) DEFAULT 1;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS loyalty_min_redeem     INTEGER DEFAULT 100;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS loyalty_point_value    NUMERIC(8,4) DEFAULT 1;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS referral_enabled       BOOLEAN DEFAULT FALSE;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS referral_discount_pct  NUMERIC(5,2) DEFAULT 10;
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS referral_reward_pct    NUMERIC(5,2) DEFAULT 5;

-- ── District Delivery Charges ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_charges (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL,
  district   TEXT NOT NULL,
  charge     NUMERIC(10,2) DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, district)
);

-- ── Bulk Discount Rules ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bulk_discount_rules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  min_quantity INTEGER NOT NULL,
  discount_pct NUMERIC(5,2) NOT NULL,
  product_id   UUID,
  product_name TEXT,
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Loyalty Points Ledger ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loyalty_points (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  customer_id     TEXT NOT NULL,
  customer_name   TEXT,
  points          INTEGER DEFAULT 0,
  total_earned    INTEGER DEFAULT 0,
  total_redeemed  INTEGER DEFAULT 0,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, customer_id)
);

-- ── Tracking fields in orders ─────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number     TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_name        TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_sent_at    TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS advance_paid        NUMERIC(12,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_deadline_at TIMESTAMPTZ;
