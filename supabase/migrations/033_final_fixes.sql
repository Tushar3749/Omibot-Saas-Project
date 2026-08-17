-- OmniBot SaaS — Migration 033: Final Fixes
-- Adds business_type, payment_methods, custom_order_fields, return_enabled to ai_config,
-- and unit_type to products, so the bot is no longer hardcoded to a single business type/unit.

ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS business_type TEXT DEFAULT 'general';
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS payment_methods TEXT[] DEFAULT ARRAY['bkash','nagad','cod'];
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS custom_order_fields JSONB DEFAULT '[]';
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS return_enabled BOOLEAN DEFAULT true;
ALTER TABLE products ADD COLUMN IF NOT EXISTS unit_type TEXT DEFAULT 'piece';
