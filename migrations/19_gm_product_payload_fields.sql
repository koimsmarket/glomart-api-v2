-- GM_ORDER_V055: store representative option/shipping/supplier/raw payload fields
-- Runtime/Collector 수정 없이 서버 저장 컬럼만 보강한다.

ALTER TABLE IF EXISTS gm_product
  ADD COLUMN IF NOT EXISTS option_json JSONB,
  ADD COLUMN IF NOT EXISTS shipping_json JSONB,
  ADD COLUMN IF NOT EXISTS supplier_json JSONB,
  ADD COLUMN IF NOT EXISTS product_raw_json JSONB;

ALTER TABLE IF EXISTS gm_product_archive
  ADD COLUMN IF NOT EXISTS option_json JSONB,
  ADD COLUMN IF NOT EXISTS shipping_json JSONB,
  ADD COLUMN IF NOT EXISTS supplier_json JSONB,
  ADD COLUMN IF NOT EXISTS product_raw_json JSONB;
