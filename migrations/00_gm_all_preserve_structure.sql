-- 01_gm_product.sql
-- Source sheet: product_db
-- Column structure is preserved from the uploaded workbook.

CREATE TABLE IF NOT EXISTS gm_product (
  product_uid TEXT NOT NULL,
  glomart_code TEXT NOT NULL,
  gm_category TEXT NOT NULL,
  category_keyword TEXT,
  mall_code TEXT NOT NULL,
  mall_category TEXT,
  product_id TEXT NOT NULL,
  item_id TEXT,
  vendor_item_id TEXT NOT NULL,
  pi_ii_vi TEXT,
  internal_product_code TEXT,
  product_name TEXT NOT NULL,
  mall_product_name TEXT,
  option_count INTEGER,
  option_name TEXT,
  option_value TEXT,
  origin_country TEXT,
  storage_type TEXT,
  storage_method TEXT,
  shelf_life_text TEXT,
  seasonal_yn TEXT,
  mall_sale_price INTEGER NOT NULL,
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
  certification_no_1 TEXT,
  certification_no_2 TEXT,
  supplier_id TEXT,
  supplier_name_snapshot TEXT,
  business_number_snapshot TEXT,
  online_sales_number_snapshot TEXT,
  ceo_name_snapshot TEXT,
  supplier_mobile_snapshot TEXT,
  supplier_phone_snapshot TEXT,
  supplier_email_snapshot TEXT,
  supplier_address_snapshot TEXT,
  product_url TEXT NOT NULL,
  thumb_origin_url TEXT NOT NULL,
  thumb_file_name TEXT NOT NULL,
  soldout_yn TEXT,
  hit_count INTEGER,
  detail_view_count INTEGER,
  cart_count INTEGER,
  order_count INTEGER,
  product_grade TEXT,
  last_seen_at TIMESTAMP,
  last_cart_at TIMESTAMP,
  last_order_at TIMESTAMP,
  expire_at TIMESTAMP,
  registered_our_product_yn TEXT,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP,
  sale_status TEXT,
  collect_status TEXT,
  collect_error TEXT,
  sale_unit_text TEXT,
  unit_price_text TEXT,
  unit_price_value NUMERIC,
  unit_base_qty NUMERIC,
  unit_base_unit TEXT,
  unit_norm_qty NUMERIC,
  unit_norm_unit TEXT,
  unit_norm_price NUMERIC,
  unit_parse_status TEXT,
  unit_sortable_yn TEXT,
  PRIMARY KEY (product_uid)
);


-- 02_gm_cart.sql
-- Source sheet: glomart_basket_db_minimal_revis
-- Column structure is preserved from the uploaded workbook.

CREATE TABLE IF NOT EXISTS gm_cart (
  member_id TEXT,
  guest_key TEXT,
  pi_ii_vi TEXT NOT NULL,
  product_name TEXT NOT NULL,
  option_name TEXT,
  option_value TEXT,
  quantity INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  amount_type TEXT,
  delivery_type TEXT,
  delivery_fee INTEGER,
  added_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP
);


-- 03_gm_order.sql
-- Source sheet: 주문서DB_최소구조
-- Column structure is preserved from the uploaded workbook.

CREATE TABLE IF NOT EXISTS gm_order (
  order_no TEXT NOT NULL,
  member_id TEXT,
  guest_key TEXT,
  orderer_name TEXT NOT NULL,
  orderer_phone TEXT,
  orderer_mobile TEXT NOT NULL,
  orderer_email TEXT,
  receiver_name TEXT NOT NULL,
  receiver_phone TEXT,
  receiver_mobile TEXT NOT NULL,
  receiver_safe_phone TEXT,
  receiver_zipcode TEXT NOT NULL,
  receiver_address1 TEXT NOT NULL,
  receiver_address2 TEXT,
  delivery_memo TEXT,
  customs_required_yn TEXT,
  customs_clearance_code TEXT,
  customs_name TEXT,
  customs_mobile TEXT,
  payment_method TEXT NOT NULL,
  payment_method_display TEXT NOT NULL,
  payment_bank_name TEXT,
  payment_account_number TEXT,
  depositor_name TEXT,
  depositor_phone TEXT,
  expected_payment_amount INTEGER NOT NULL,
  actual_payment_amount INTEGER,
  payment_difference_amount INTEGER,
  total_product_price INTEGER NOT NULL,
  total_delivery_fee INTEGER NOT NULL,
  extra_area_delivery_fee INTEGER,
  estimated_customs_fee INTEGER,
  estimated_import_vat INTEGER,
  total_payment_price INTEGER NOT NULL,
  order_status TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  shipping_status TEXT NOT NULL,
  delivered_at TIMESTAMP,
  cs_status TEXT,
  ordered_at TIMESTAMP NOT NULL,
  payment_requested_at TIMESTAMP,
  payment_completed_at TIMESTAMP,
  payment_confirmed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP,
  cancel_status TEXT,
  cancel_requested_at TIMESTAMP,
  cancel_completed_at TIMESTAMP,
  purchase_confirmed_yn TEXT,
  purchase_confirmed_at TIMESTAMP,
  PRIMARY KEY (order_no)
);


-- 04_gm_order_item.sql
-- Source sheet: 주문상품DB_최소구조
-- Column structure is preserved from the uploaded workbook.

CREATE TABLE IF NOT EXISTS gm_order_item (
  order_no TEXT NOT NULL,
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


-- 05_gm_cs.sql
-- Source sheet: CS_DB_최소구조
-- Column structure is preserved from the uploaded workbook.

CREATE TABLE IF NOT EXISTS gm_cs (
  cs_no TEXT NOT NULL,
  request_at TIMESTAMP NOT NULL,
  order_no TEXT,
  pi_ii_vi TEXT,
  cs_type TEXT NOT NULL,
  cs_status TEXT NOT NULL,
  message_summary TEXT,
  return_at TIMESTAMP,
  return_carrier TEXT,
  return_invoice_no TEXT,
  return_received_at TIMESTAMP,
  return_confirm_yn TEXT,
  reship_at TIMESTAMP,
  reship_carrier TEXT,
  reship_invoice_no TEXT,
  reship_received_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP,
  PRIMARY KEY (cs_no)
);


-- 06_gm_cs_message.sql
-- Source sheet: CS_MESSAGE_DB_최소구조
-- Column structure is preserved from the uploaded workbook.

CREATE TABLE IF NOT EXISTS gm_cs_message (
  message_id INTEGER NOT NULL,
  cs_no TEXT,
  order_no TEXT,
  sender_type TEXT NOT NULL,
  message_type TEXT NOT NULL,
  message_text TEXT,
  file_url TEXT,
  file_name TEXT,
  read_yn TEXT,
  created_at TIMESTAMP NOT NULL,
  PRIMARY KEY (message_id)
);
