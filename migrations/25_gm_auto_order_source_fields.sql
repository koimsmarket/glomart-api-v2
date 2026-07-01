-- 25_gm_auto_order_source_fields.sql
-- Auto order V005: Cloud 주문번호를 기준으로 운영하고 Cafe24 주문번호/내부상품 원본몰을 보관한다.
-- order_no = Glomart Cloud 자동 주문번호
-- cafe24_order_no = Cafe24 주문번호(내부상품 또는 내외부 혼합 주문 참조번호)
-- source_mall/source_uid = mall_code=CAFE24 내부상품의 실제 구매처/구매키

ALTER TABLE gm_order
  ADD COLUMN IF NOT EXISTS cafe24_order_no TEXT;

ALTER TABLE gm_order_item
  ADD COLUMN IF NOT EXISTS cafe24_order_no TEXT;

ALTER TABLE gm_order_item
  ADD COLUMN IF NOT EXISTS source_mall TEXT;

ALTER TABLE gm_order_item
  ADD COLUMN IF NOT EXISTS source_uid TEXT;

ALTER TABLE gm_product
  ADD COLUMN IF NOT EXISTS source_mall TEXT;

ALTER TABLE gm_product
  ADD COLUMN IF NOT EXISTS source_uid TEXT;

CREATE INDEX IF NOT EXISTS idx_gm_order_cafe24_order_no
  ON gm_order (cafe24_order_no);

CREATE INDEX IF NOT EXISTS idx_gm_order_item_cafe24_order_no
  ON gm_order_item (cafe24_order_no);

CREATE INDEX IF NOT EXISTS idx_gm_order_item_source_mall_uid
  ON gm_order_item (source_mall, source_uid);

CREATE INDEX IF NOT EXISTS idx_gm_product_source_mall_uid
  ON gm_product (source_mall, source_uid);
