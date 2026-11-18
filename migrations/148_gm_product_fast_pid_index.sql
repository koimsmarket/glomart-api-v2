-- 148_gm_product_fast_pid_index.sql / GM_CPKR_URL_V020_INDEX
-- Source baseline: glomart-api-v2_20261117_1330.zip
-- MANUAL APPLY ONLY on the existing production DB. No migration auto-execution.
-- This is a NON-UNIQUE performance index. Do not change existing product identity rules.
-- PostgreSQL: matches detail-fast product lookup by mall_code, product_id,
-- ORDER BY updated_at DESC NULLS LAST LIMIT 1.
-- Existing gm_product_option product/active indexes are sufficient; no new option index.
CREATE INDEX IF NOT EXISTS idx_gm_product_mall_pid_updated
  ON public.gm_product (mall_code, product_id, updated_at DESC NULLS LAST);
