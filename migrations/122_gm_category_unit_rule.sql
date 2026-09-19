-- GM_CATEGORY_V035_UNIT_RULE
-- Additive only. No DROP/DELETE/TRUNCATE.
ALTER TABLE gm_category ADD COLUMN IF NOT EXISTS unit_rule_qty NUMERIC;
ALTER TABLE gm_category ADD COLUMN IF NOT EXISTS unit_rule_unit TEXT;

-- Legacy product unit-price columns are part of preserved schema; restore only if absent.
ALTER TABLE gm_product ADD COLUMN IF NOT EXISTS unit_price_text TEXT;
ALTER TABLE gm_product ADD COLUMN IF NOT EXISTS unit_price_value NUMERIC;
ALTER TABLE gm_product ADD COLUMN IF NOT EXISTS unit_base_qty NUMERIC;
ALTER TABLE gm_product ADD COLUMN IF NOT EXISTS unit_base_unit TEXT;

ALTER TABLE gm_product ADD COLUMN IF NOT EXISTS total_unit_qty NUMERIC;
ALTER TABLE gm_product ADD COLUMN IF NOT EXISTS total_unit_unit TEXT;
ALTER TABLE gm_product ADD COLUMN IF NOT EXISTS unit_calc_basis TEXT;

ALTER TABLE gm_product_option ADD COLUMN IF NOT EXISTS unit_price_value NUMERIC;
ALTER TABLE gm_product_option ADD COLUMN IF NOT EXISTS unit_base_qty NUMERIC;
ALTER TABLE gm_product_option ADD COLUMN IF NOT EXISTS unit_base_unit TEXT;
ALTER TABLE gm_product_option ADD COLUMN IF NOT EXISTS total_unit_qty NUMERIC;
ALTER TABLE gm_product_option ADD COLUMN IF NOT EXISTS total_unit_unit TEXT;
ALTER TABLE gm_product_option ADD COLUMN IF NOT EXISTS unit_calc_basis TEXT;

CREATE INDEX IF NOT EXISTS idx_gm_category_unit_rule ON gm_category(unit_rule_unit, unit_rule_qty);
