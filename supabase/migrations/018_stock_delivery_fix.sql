-- stock_movements: audit trail for every stock change
CREATE TABLE IF NOT EXISTS stock_movements (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID        NOT NULL REFERENCES tenants(tenant_id),
    product_id       UUID        NOT NULL REFERENCES products(product_id),
    order_id         UUID        REFERENCES orders(order_id),
    movement_type    TEXT        NOT NULL CHECK (movement_type IN (
                                    'issue','ship','cancel','return',
                                    'manual_add','manual_remove')),
    quantity         INTEGER     NOT NULL,
    physical_before  INTEGER,
    physical_after   INTEGER,
    issued_before    INTEGER,
    issued_after     INTEGER,
    note             TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stock_movements_own" ON stock_movements
    FOR ALL USING (tenant_id = auth.uid());

CREATE INDEX IF NOT EXISTS stock_movements_tenant_product
    ON stock_movements (tenant_id, product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_movements_order
    ON stock_movements (order_id) WHERE order_id IS NOT NULL;
