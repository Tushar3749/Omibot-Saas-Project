-- OmniBot SaaS — Product Images Migration (v4)
-- Run AFTER 003_otp_system.sql

-- Ensure pgvector is enabled (safe if already exists)
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Product Images ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_images (
  image_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  product_id        UUID NOT NULL,
  image_url         TEXT NOT NULL,
  image_description TEXT,
  embedding         vector(768),        -- text-embedding-004 of description
  is_primary        BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_images_product   ON product_images(product_id);
CREATE INDEX IF NOT EXISTS idx_product_images_tenant    ON product_images(tenant_id);
CREATE INDEX IF NOT EXISTS idx_product_images_primary   ON product_images(tenant_id, is_primary) WHERE is_primary = TRUE;

-- Vector search function (cosine similarity, tenant-scoped)
CREATE OR REPLACE FUNCTION match_product_images(
  query_embedding   vector(768),
  match_threshold   float,
  match_count       int,
  p_tenant_id       uuid
)
RETURNS TABLE (
  image_id          uuid,
  product_id        uuid,
  image_url         text,
  image_description text,
  is_primary        boolean,
  similarity        float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    pi.image_id,
    pi.product_id,
    pi.image_url,
    pi.image_description,
    pi.is_primary,
    1 - (pi.embedding <=> query_embedding) AS similarity
  FROM product_images pi
  WHERE
    pi.tenant_id   = p_tenant_id
    AND pi.embedding IS NOT NULL
    AND 1 - (pi.embedding <=> query_embedding) > match_threshold
  ORDER BY pi.embedding <=> query_embedding
  LIMIT match_count;
$$;
