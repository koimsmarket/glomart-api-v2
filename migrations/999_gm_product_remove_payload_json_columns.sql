-- GM_ORDER_V056: remove payload JSON dump columns from product CSV/storage
-- 운영 컬럼에 분리 저장하는 원칙으로 되돌린다.

ALTER TABLE IF EXISTS gm_product
  DROP COLUMN IF EXISTS option_json,
  DROP COLUMN IF EXISTS shipping_json,
  DROP COLUMN IF EXISTS supplier_json,
  DROP COLUMN IF EXISTS product_raw_json;

ALTER TABLE IF EXISTS gm_product_archive
  DROP COLUMN IF EXISTS option_json,
  DROP COLUMN IF EXISTS shipping_json,
  DROP COLUMN IF EXISTS supplier_json,
  DROP COLUMN IF EXISTS product_raw_json;
