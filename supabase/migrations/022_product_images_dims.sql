-- ═══════════════════════════════════════════════════════════════════════════
--  OmniBot SaaS — Migration 022: product_images dimension columns
--  Adds file_size, width, height for future image metadata tracking.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE product_images
  ADD COLUMN IF NOT EXISTS file_size  INTEGER,
  ADD COLUMN IF NOT EXISTS width      INTEGER,
  ADD COLUMN IF NOT EXISTS height     INTEGER;
