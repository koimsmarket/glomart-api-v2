-- 901_gm_product_identity_schema_reconcile.sql
-- Schema reconciliation from current runtime references vs production schema.
-- SAFE ONLY: no TRUNCATE, DROP, DELETE, or destructive data reset.

BEGIN;

-- services/event_service.js reads gm_product.category_code in RETURNING/SELECT.
-- Current gm_product schema does not define it.
ALTER TABLE gm_product
  ADD COLUMN IF NOT EXISTS category_code TEXT NOT NULL DEFAULT '';

-- Backfill only from already-existing category identity fields.
-- Do not overwrite an existing category_code.
UPDATE gm_product
SET category_code = COALESCE(NULLIF(cp_fix_code,''), NULLIF(cp_selected_code,''), '')
WHERE COALESCE(category_code,'') = '';

-- routes/smartfit.js resolves internal GMKR products from gm_product.cafe24_product_no.
-- Migration 47 added this field to gm_smartfit_item, but not to gm_product.
ALTER TABLE gm_product
  ADD COLUMN IF NOT EXISTS cafe24_product_no VARCHAR(40) NOT NULL DEFAULT '';

-- Lookup path used by SmartFit internal-product identity resolution.
CREATE INDEX IF NOT EXISTS idx_gm_product_gmkr_cafe24_product_no
  ON gm_product(source_mall, cafe24_product_no)
  WHERE source_mall='GMKR' AND cafe24_product_no <> '';

COMMIT;
