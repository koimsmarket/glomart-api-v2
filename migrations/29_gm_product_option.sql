-- 29_gm_product_option.sql
-- GM_PRODUCT_OPTION_TABLE_V001
-- 옵션 JSON 중복 저장 대신 실제 구매 가능 옵션 단위를 운영 컬럼으로 저장한다.

CREATE TABLE IF NOT EXISTS gm_product_option (
  mall_code TEXT NOT NULL,
  product_id TEXT NOT NULL,
  item_id TEXT,
  vendor_item_id TEXT,
  pi_ii_vi TEXT NOT NULL,

  option_name TEXT,
  option_image_url TEXT,
  option_sort_no INTEGER NOT NULL DEFAULT 0,

  mall_sale_price INTEGER NOT NULL DEFAULT 0,
  mall_discount_price INTEGER,
  final_supply_price INTEGER,
  normal_price INTEGER,
  discount_price INTEGER NOT NULL DEFAULT 0,

  delivery_fee INTEGER NOT NULL DEFAULT 0,
  delivery_eta_text TEXT,
  delivery_type TEXT,

  soldout_yn TEXT NOT NULL DEFAULT 'N',
  sale_status TEXT NOT NULL DEFAULT 'active',
  active_yn TEXT NOT NULL DEFAULT 'Y',

  buyable_qty INTEGER,
  min_order_qty INTEGER,
  max_order_qty INTEGER,

  sales_qty INTEGER NOT NULL DEFAULT 0,

  last_seen_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP,

  PRIMARY KEY (mall_code, pi_ii_vi)
);

CREATE INDEX IF NOT EXISTS idx_gm_product_option_product ON gm_product_option(mall_code, product_id);
CREATE INDEX IF NOT EXISTS idx_gm_product_option_active ON gm_product_option(mall_code, product_id, active_yn);
CREATE INDEX IF NOT EXISTS idx_gm_product_option_vendor ON gm_product_option(vendor_item_id);

ALTER TABLE gm_product_option ADD COLUMN IF NOT EXISTS mall_discount_price INTEGER;
