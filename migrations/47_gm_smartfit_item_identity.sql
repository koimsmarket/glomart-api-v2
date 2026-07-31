-- SmartFit item identity only. Mutable price/stock/delivery values are intentionally excluded.
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS source_mall VARCHAR(20) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS source_uid VARCHAR(180) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS internal_product_code VARCHAR(120) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS cafe24_product_no VARCHAR(40) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS pi_ii_vi VARCHAR(180) NOT NULL DEFAULT '';
