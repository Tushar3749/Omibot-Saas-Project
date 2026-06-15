-- ═══════════════════════════════════════════════════════════════════════════
--  OmniBot SaaS — Migration 025: Stock table sync
--
--  Fixes three issues:
--    1. Products imported via CSV had no stock rows → all show 0 in Stock page
--    2. physical_stock exists but current_stock is stale (not updated when
--       issued_stock grew after orders) → Products page shows wrong high value
--    3. Ensures both pages use consistent available = physical - issued
-- ═══════════════════════════════════════════════════════════════════════════

-- Step 1: Create missing stock rows for every active product
INSERT INTO stock (tenant_id, product_id, current_stock, physical_stock, issued_stock)
SELECT p.tenant_id, p.product_id, 0, 0, 0
FROM products p
WHERE p.is_active = true
  AND NOT EXISTS (
      SELECT 1 FROM stock s
      WHERE s.tenant_id = p.tenant_id
        AND s.product_id = p.product_id
  )
ON CONFLICT (tenant_id, product_id) DO NOTHING;

-- Step 2: Seed physical_stock from current_stock for rows that existed before
--         physical/issued tracking was introduced (migration 017).
--         These rows have physical=0 but current>0 and no issued activity.
UPDATE stock
SET physical_stock = current_stock
WHERE physical_stock = 0
  AND current_stock > 0
  AND issued_stock = 0;

-- Step 3: Recalculate current_stock = physical_stock - issued_stock for all
--         rows where physical tracking is active. This fixes stale current_stock
--         values that were not updated when issued_stock increased via orders.
UPDATE stock
SET current_stock = GREATEST(0, physical_stock - issued_stock)
WHERE physical_stock > 0;
