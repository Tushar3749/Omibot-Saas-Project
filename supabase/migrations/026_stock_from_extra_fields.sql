-- ═══════════════════════════════════════════════════════════════════════════
--  OmniBot SaaS — Migration 026: Sync extra_fields.stock → stock table
--
--  Products imported via CSV with a "stock" column had their stock value
--  stored in products.extra_fields->>'stock' instead of the stock table.
--  This migration copies those values into stock.current_stock /
--  stock.physical_stock for any product whose stock row is still at 0.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE stock s
SET
    current_stock  = (p.extra_fields->>'stock')::INTEGER,
    physical_stock = (p.extra_fields->>'stock')::INTEGER
FROM products p
WHERE s.tenant_id    = p.tenant_id
  AND s.product_id   = p.product_id
  AND s.current_stock  = 0
  AND s.physical_stock = 0
  AND p.extra_fields ? 'stock'
  AND (p.extra_fields->>'stock') ~ '^\d+$'
  AND (p.extra_fields->>'stock')::INTEGER > 0;
