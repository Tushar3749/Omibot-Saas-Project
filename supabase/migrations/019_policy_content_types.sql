-- ═══════════════════════════════════════════════════════════════════════════
--  OmniBot SaaS — Migration 019: Policy Content Types
--  Extends knowledge_base CHECK constraint to include bot-accessible policy
--  document categories used by the RAG Policy Doc Upload system.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE knowledge_base
  DROP CONSTRAINT IF EXISTS knowledge_base_content_type_check;

ALTER TABLE knowledge_base
  ADD CONSTRAINT knowledge_base_content_type_check
  CHECK (content_type IN (
    'product', 'policy', 'faq', 'general',
    'return_policy', 'bonus_policy', 'company_desc',
    'discount_policy', 'delivery_policy', 'order_policy'
  ));
