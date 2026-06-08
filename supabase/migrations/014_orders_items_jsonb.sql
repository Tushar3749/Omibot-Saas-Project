-- OmniBot SaaS — Migration 014: Orders items JSONB
-- Adds items column so multi-product checkouts are stored in one order row.
-- Run this in the Supabase SQL Editor.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS items JSONB DEFAULT '[]';
