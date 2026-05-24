-- GM_DB_V004_SIMPLE_TABLES
-- PostgreSQL / Cloudtype
-- table names: gm_suppliers, gm_products, gm_basket, gm_orders, gm_order_items, gm_cs

CREATE TABLE IF NOT EXISTS gm_suppliers (
  gm_supplier_id TEXT PRIMARY KEY,
  mall_code TEXT NOT NULL,
  mall_seller_id TEXT NOT NULL,
  supplier_code TEXT UNIQUE,
  seller_key TEXT UNIQUE,
  seller_name TEXT NOT NULL,
  company_name TEXT,
  ceo_name TEXT,
  business_number TEXT,
  online_sales_number TEXT,
  main_phone TEXT,
  main_email TEXT,
  business_zipcode TEXT,
  business_address1 TEXT,
  business_address2 TEXT,
  manager_name TEXT,
  manager_department TEXT,
  manager_phone TEXT,
  manager_mobile TEXT,
  manager_email TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gm_products (
  product_uid TEXT PRIMARY KEY,
  glomart_code TEXT NOT NULL,
  gm_category TEXT NOT NULL,
  category_keyword TEXT,
  mall_code TEXT NOT NULL,
  mall_category TEXT,
  product_id TEXT NOT NULL,
  item_id TEXT,
  vendor_item_id TEXT NOT NULL,
  pi_ii_vi TEXT UNIQUE,
  internal_product_code TEXT,
  product_name TEXT NOT NULL,
  mall_product_name TEXT,
  option_count BIGINT,
  option_name TEXT,
  option_value TEXT,
  origin_country TEXT,
  storage_type TEXT,
  storage_method TEXT,
  shelf_life_text TEXT,
  seasonal_yn TEXT DEFAULT 'N',
  mall_sale_price BIGINT DEFAULT 0,
  final_supply_price BIGINT,
  normal_price BIGINT,
  discount_price BIGINT,
  delivery_fee BIGINT DEFAULT 0,
  delivery_eta_text TEXT,
  delivery_days_range TEXT,
  delivery_type TEXT,
  tax_type TEXT,
  overseas_direct_yn TEXT DEFAULT 'N',
  review_count BIGINT DEFAULT 0,
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
  product_url TEXT,
  thumb_origin_url TEXT,
  thumb_file_name TEXT,
  thumb_file_path TEXT,
  thumb_saved_yn TEXT DEFAULT 'N',
  adult_auth_yn TEXT DEFAULT 'N',
  option_use_yn TEXT DEFAULT 'N',
  min_order_qty BIGINT DEFAULT 1,
  max_order_qty BIGINT,
  hs_code TEXT,
  customs_notice TEXT,
  soldout_yn TEXT DEFAULT 'N',
  sale_status TEXT DEFAULT 'active',
  order_status TEXT,
  shipping_status TEXT,
  registered_our_product_yn TEXT DEFAULT 'N',
  hit_count BIGINT DEFAULT 0,
  detail_view_count BIGINT DEFAULT 0,
  cart_count BIGINT DEFAULT 0,
  order_count BIGINT DEFAULT 0,
  first_seen_at TIMESTAMPTZ DEFAULT now(),
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  expire_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gm_basket (
  member_id TEXT,
  guest_key TEXT,
  pi_ii_vi TEXT NOT NULL,
  product_name TEXT NOT NULL,
  option_name TEXT,
  option_value TEXT,
  quantity BIGINT NOT NULL DEFAULT 1,
  amount BIGINT NOT NULL DEFAULT 0,
  amount_type TEXT DEFAULT 'unit',
  delivery_type TEXT,
  delivery_fee BIGINT DEFAULT 0,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CHECK (
    (member_id IS NOT NULL AND member_id <> '')
    OR
    (guest_key IS NOT NULL AND guest_key <> '')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_gm_basket_member_item
ON gm_basket(member_id, pi_ii_vi)
WHERE member_id IS NOT NULL AND member_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS ux_gm_basket_guest_item
ON gm_basket(guest_key, pi_ii_vi)
WHERE guest_key IS NOT NULL AND guest_key <> '';

CREATE TABLE IF NOT EXISTS gm_orders (
  order_no TEXT PRIMARY KEY,
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
  customs_required_yn TEXT DEFAULT 'N',
  customs_clearance_code TEXT,
  customs_name TEXT,
  customs_mobile TEXT,
  payment_method TEXT NOT NULL,
  payment_method_display TEXT,
  payment_bank_name TEXT,
  payment_account_number TEXT,
  depositor_name TEXT,
  depositor_phone TEXT,
  expected_payment_amount BIGINT DEFAULT 0,
  actual_payment_amount BIGINT,
  payment_difference_amount BIGINT DEFAULT 0,
  total_product_price BIGINT DEFAULT 0,
  total_delivery_fee BIGINT DEFAULT 0,
  extra_area_delivery_fee BIGINT DEFAULT 0,
  estimated_customs_fee BIGINT DEFAULT 0,
  estimated_import_vat BIGINT DEFAULT 0,
  total_payment_price BIGINT DEFAULT 0,
  order_status TEXT DEFAULT 'ordered',
  payment_status TEXT DEFAULT 'pending',
  shipping_status TEXT DEFAULT 'pending',
  cs_status TEXT DEFAULT 'none',
  cancel_status TEXT DEFAULT 'none',
  ordered_at TIMESTAMPTZ DEFAULT now(),
  paid_at TIMESTAMPTZ,
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  purchase_confirmed_at TIMESTAMPTZ,
  purchase_confirmed_yn TEXT DEFAULT 'N',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gm_order_items (
  order_no TEXT NOT NULL REFERENCES gm_orders(order_no) ON DELETE CASCADE,
  pi_ii_vi TEXT NOT NULL,
  product_name TEXT NOT NULL,
  option_name TEXT,
  option_value TEXT,
  quantity BIGINT NOT NULL DEFAULT 1,
  mall_sale_price BIGINT DEFAULT 0,
  customer_order_price BIGINT DEFAULT 0,
  final_supply_price BIGINT,
  product_amount BIGINT DEFAULT 0,
  delivery_type TEXT,
  delivery_fee BIGINT DEFAULT 0,
  extra_area_delivery_fee BIGINT DEFAULT 0,
  mall_code TEXT,
  supplier_id TEXT,
  supplier_name TEXT,
  product_url TEXT,
  thumb_file_name TEXT,
  hs_code TEXT,
  origin_country TEXT,
  carrier_name TEXT,
  tracking_number TEXT,
  item_order_status TEXT DEFAULT 'ordered',
  item_shipping_status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (order_no, pi_ii_vi)
);

CREATE TABLE IF NOT EXISTS gm_cs (
  cs_no TEXT PRIMARY KEY,
  order_no TEXT NOT NULL REFERENCES gm_orders(order_no) ON DELETE CASCADE,
  pi_ii_vi TEXT,
  cs_type TEXT NOT NULL,
  cs_status TEXT DEFAULT 'received',
  cs_reason TEXT,
  cs_memo TEXT,
  requested_by TEXT,
  requested_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_gm_suppliers_mall ON gm_suppliers(mall_code, mall_seller_id);
CREATE INDEX IF NOT EXISTS ix_gm_products_mall_code ON gm_products(mall_code);
CREATE INDEX IF NOT EXISTS ix_gm_products_pi_ii_vi ON gm_products(pi_ii_vi);
CREATE INDEX IF NOT EXISTS ix_gm_products_glomart_code ON gm_products(glomart_code);
CREATE INDEX IF NOT EXISTS ix_gm_products_supplier_id ON gm_products(supplier_id);
CREATE INDEX IF NOT EXISTS ix_gm_basket_member_id ON gm_basket(member_id);
CREATE INDEX IF NOT EXISTS ix_gm_basket_guest_key ON gm_basket(guest_key);
CREATE INDEX IF NOT EXISTS ix_gm_orders_member_id ON gm_orders(member_id);
CREATE INDEX IF NOT EXISTS ix_gm_orders_guest_key ON gm_orders(guest_key);
CREATE INDEX IF NOT EXISTS ix_gm_orders_ordered_at ON gm_orders(ordered_at);
CREATE INDEX IF NOT EXISTS ix_gm_order_items_supplier_id ON gm_order_items(supplier_id);
CREATE INDEX IF NOT EXISTS ix_gm_cs_order_no ON gm_cs(order_no);
