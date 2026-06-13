-- ═══════════════════════════════════════════════════════════════════════════
--  OmniBot SaaS — Migration 021: product_images vector search RPC
--  Creates the match_product_images function used by image_search_service.py
--  for pgvector cosine-similarity search over product image embeddings.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION match_product_images(
  query_embedding  vector(768),
  match_threshold  float,
  match_count      int,
  p_tenant_id      uuid
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
  WHERE pi.tenant_id = p_tenant_id
    AND pi.embedding  IS NOT NULL
    AND 1 - (pi.embedding <=> query_embedding) > match_threshold
  ORDER BY pi.embedding <=> query_embedding
  LIMIT match_count;
$$;
