-- GM_PRODUCT_OPTION_DISPLAY_V005 | additive migration; ADMIN MANUAL ONLY.
-- Retain 01_gm_product.sql and 29_gm_product_option.sql unchanged.
-- For full disaster recovery run migrations sequentially through 143.
-- This SQL changes schema only; no existing options or counts are rewritten.
BEGIN;
ALTER TABLE public.gm_product_option
  ADD COLUMN IF NOT EXISTS option_display_name TEXT;
ALTER TABLE public.gm_product
  ADD COLUMN IF NOT EXISTS option_count_verified_at TIMESTAMPTZ;
COMMIT;
