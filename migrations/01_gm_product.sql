-- 01_gm_product.sql
-- DEV reset schema for gm_product.
-- 개발 중에는 DROP/CREATE 기준. 운영 전 migration_operating에서 확정본으로 보관한다.

DROP TABLE IF EXISTS gm_product CASCADE;

CREATE TABLE gm_product (
  product_uid TEXT NOT NULL,
  glomart_code TEXT,
  gm_category TEXT,
  category_keyword TEXT,
  keyword TEXT,
  mall_code TEXT NOT NULL,
  source_mall TEXT,
  source_uid TEXT,

  -- Category: 상품은 cp_code(No)를 기준으로 관리하고, cp_id는 검색 categoryId 학습키로 보관한다.
  cp_id TEXT,
  cp_code TEXT,

  product_id TEXT NOT NULL,
  item_id TEXT,
  vendor_item_id TEXT NOT NULL,
  pi_ii_vi TEXT,
  internal_product_code TEXT,
  product_name TEXT NOT NULL,
  mall_product_name TEXT,

  option_count INTEGER,
  option_json JSONB NOT NULL DEFAULT '{"headers":[],"rows":[]}'::jsonb,
  thumb_json JSONB NOT NULL DEFAULT '[]'::jsonb,

  origin_country TEXT,
  storage_type TEXT,
  storage_method TEXT,
  shelf_life_text TEXT,
  seasonal_text TEXT,

  mall_sale_price INTEGER NOT NULL DEFAULT 0,
  final_supply_price INTEGER,
  normal_price INTEGER,
  discount_price INTEGER,
  delivery_fee INTEGER,
  delivery_eta_text TEXT,
  delivery_days_range TEXT,
  delivery_type TEXT,
  tax_type TEXT,
  overseas_direct_yn TEXT,
  review_count INTEGER,
  mall_sales_count TEXT,
  certification_no_1 TEXT,
  certification_no_2 TEXT,

  supplier_id TEXT,
  supplier_name TEXT,
  business_number TEXT,
  online_sales_number TEXT,
  ceo_name TEXT,
  supplier_mobile TEXT,
  supplier_phone TEXT,
  supplier_email TEXT,
  supplier_address TEXT,

  product_url TEXT NOT NULL,
  thumb_origin_url TEXT,
  soldout_yn TEXT,
  hit_count INTEGER NOT NULL DEFAULT 0,
  detail_view_count INTEGER NOT NULL DEFAULT 0,
  cart_count INTEGER NOT NULL DEFAULT 0,
  wish_count INTEGER NOT NULL DEFAULT 0,
  order_count INTEGER NOT NULL DEFAULT 0,
  order_qty_total INTEGER NOT NULL DEFAULT 0,
  product_grade TEXT,

  last_seen_at TIMESTAMP,
  last_cart_at TIMESTAMP,
  last_wish_at TIMESTAMP,
  last_order_at TIMESTAMP,
  registered_our_product_yn TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP,
  sale_status TEXT,
  collect_status TEXT,
  collect_error TEXT,

  buyable_qty INTEGER,
  min_order_qty INTEGER,
  max_order_qty INTEGER,

  return_available_yn TEXT,
  exchange_available_yn TEXT,
  return_policy_text TEXT,
  exchange_policy_text TEXT,
  return_shipping_fee INTEGER,
  exchange_shipping_fee INTEGER,
  return_period_days INTEGER,
  exchange_period_days INTEGER,

  PRIMARY KEY (product_uid)
);

CREATE INDEX IF NOT EXISTS idx_gm_product_cp_id ON gm_product(cp_id);
CREATE INDEX IF NOT EXISTS idx_gm_product_cp_code ON gm_product(cp_code);
CREATE INDEX IF NOT EXISTS idx_gm_product_mall_pi ON gm_product(mall_code, pi_ii_vi);
CREATE INDEX IF NOT EXISTS idx_gm_product_keyword ON gm_product(keyword);
