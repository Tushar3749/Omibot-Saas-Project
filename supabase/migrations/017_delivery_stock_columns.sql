-- Add district and delivery_charge to orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS district TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_charge NUMERIC(10,2) DEFAULT 0;

-- Add physical_stock and issued_stock to stock table
ALTER TABLE stock ADD COLUMN IF NOT EXISTS physical_stock INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stock ADD COLUMN IF NOT EXISTS issued_stock INTEGER NOT NULL DEFAULT 0;

-- Seed physical_stock from existing current_stock so available = physical - issued = current
UPDATE stock
SET physical_stock = COALESCE(current_stock, 0)
WHERE physical_stock = 0 AND COALESCE(current_stock, 0) > 0;
