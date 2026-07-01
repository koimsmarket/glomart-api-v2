-- 04_gm_order_item.sql
-- Source sheet: 주문상품DB_최소구조
-- Column structure is preserved from the uploaded workbook.

CREATE TABLE IF NOT EXISTS gm_order_item (
  order_no TEXT NOT NULL,
  cafe24_order_no TEXT,
  pi_ii_vi TEXT NOT NULL,
  product_name TEXT NOT NULL,
  option_name TEXT,
  option_value TEXT,
  quantity INTEGER NOT NULL,
  mall_sale_price INTEGER NOT NULL,
  customer_order_price INTEGER NOT NULL,
  final_supply_price INTEGER,
  product_amount INTEGER NOT NULL,
  delivery_type TEXT,
  delivery_fee INTEGER,
  extra_area_delivery_fee INTEGER,
  mall_code TEXT NOT NULL,
  source_mall TEXT,
  source_uid TEXT,
  supplier_id TEXT,
  supplier_name TEXT,
  product_url TEXT NOT NULL,
  thumb_file_name TEXT NOT NULL,
  hs_code TEXT,
  origin_country TEXT,
  carrier_name TEXT,
  tracking_number TEXT,
  shipping_started_at TIMESTAMP,
  shipping_completed_at TIMESTAMP,
  item_order_status TEXT NOT NULL,
  item_shipping_status TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP,
  PRIMARY KEY (order_no, pi_ii_vi)
);
