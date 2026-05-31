-- ── 006: Add lifetime_value rule type ───────────────────────────────────────

-- Drop old CHECK constraint, add new one with lifetime_value
ALTER TABLE discount_rules DROP CONSTRAINT IF EXISTS discount_rules_rule_type_check;

ALTER TABLE discount_rules
    ADD CONSTRAINT discount_rules_rule_type_check
    CHECK (rule_type IN (
        'cart_value', 'repeated_customer', 'new_customer',
        'specific_product', 'specific_category', 'bulk_quantity',
        'district', 'time_based', 'seasonal', 'lifetime_value'
    ));
