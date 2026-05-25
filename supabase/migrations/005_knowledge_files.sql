-- ════════════════════════════════════════════════════════════════════════════
--  OmniBot SaaS — Migration 005: Knowledge Base File Uploads
--  Extends knowledge_base to track uploaded policy/document files
-- ════════════════════════════════════════════════════════════════════════════

-- Add file-tracking columns to knowledge_base
ALTER TABLE knowledge_base
  ADD COLUMN IF NOT EXISTS file_name  TEXT,
  ADD COLUMN IF NOT EXISTS file_type  TEXT,   -- 'pdf' | 'docx' | 'txt' | 'manual'
  ADD COLUMN IF NOT EXISTS file_size  INTEGER,
  ADD COLUMN IF NOT EXISTS chunk_index INTEGER DEFAULT 0;  -- for multi-chunk docs

-- Extend content_type to include document-specific types
-- Drop existing constraint first, then add the expanded one
ALTER TABLE knowledge_base
  DROP CONSTRAINT IF EXISTS knowledge_base_content_type_check;

ALTER TABLE knowledge_base
  ADD CONSTRAINT knowledge_base_content_type_check
  CHECK (content_type IN (
    'product', 'policy', 'faq', 'general',
    'return_policy', 'bonus_policy', 'company_desc'
  ));

-- Index for file lookups
CREATE INDEX IF NOT EXISTS idx_kb_file_name ON knowledge_base(tenant_id, file_name)
  WHERE file_name IS NOT NULL;
