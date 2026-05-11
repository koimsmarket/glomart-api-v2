-- GLOMART Cloudtype DB Schema V121
-- 1차 구축 범위:
-- 1) 상품+옵션 통합 product_options
-- 2) 이미지 별도 product_images
-- 3) 검색/조회 집계 search_logs, product_views, category_daily_stats

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS product_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,
  vendor_item_id TEXT NOT NULL,
  item_id TEXT,
  cp_key TEXT,
  coupang_url TEXT,
  glomart_category_no TEXT,
  cafe24_category_no TEXT,
  cafe24_product_no TEXT,
  product_name TEXT,
  option_group TEXT,
  option_name TEXT,
  option_label TEXT,
  real_price INTEGER DEFAULT 0,
  display_price INTEGER DEFAULT 0,
  price_text TEXT,
  unit_price_text TEXT,
  shipping_text TEXT,
  delivery_type TEXT,
  stock_status TEXT,
  warning_text TEXT,
  lang TEXT,
  country TEXT,
  source TEXT,
  collect_version TEXT,
  first_collected_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, vendor_item_id)
);

CREATE INDEX IF NOT EXISTS idx_product_options_product_id ON product_options(product_id);
CREATE INDEX IF NOT EXISTS idx_product_options_vendor_item_id ON product_options(vendor_item_id);
CREATE INDEX IF NOT EXISTS idx_product_options_cp_key ON product_options(cp_key);
CREATE INDEX IF NOT EXISTS idx_product_options_category ON product_options(glomart_category_no, cafe24_category_no);
CREATE INDEX IF NOT EXISTS idx_product_options_updated ON product_options(updated_at);

CREATE TABLE IF NOT EXISTS product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  glomart_category_no TEXT,
  cafe24_category_no TEXT,
  product_id TEXT NOT NULL,
  image_type TEXT NOT NULL CHECK(image_type IN ('main','sub','detail')),
  image_url TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  width INTEGER DEFAULT 0,
  height INTEGER DEFAULT 0,
  source TEXT,
  collect_version TEXT,
  first_collected_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, image_type, image_url)
);

CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images(product_id);
CREATE INDEX IF NOT EXISTS idx_product_images_category ON product_images(glomart_category_no, cafe24_category_no);
CREATE INDEX IF NOT EXISTS idx_product_images_type ON product_images(image_type, sort_order);

CREATE TABLE IF NOT EXISTS search_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_keyword TEXT,
  normalized_keyword TEXT,
  matched_keyword TEXT,
  glomart_category_no TEXT,
  cafe24_category_no TEXT,
  lang TEXT,
  country TEXT,
  page_url TEXT,
  result_count INTEGER DEFAULT 0,
  source TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_search_logs_keyword ON search_logs(raw_keyword, normalized_keyword);
CREATE INDEX IF NOT EXISTS idx_search_logs_category ON search_logs(glomart_category_no, cafe24_category_no);
CREATE INDEX IF NOT EXISTS idx_search_logs_created_at ON search_logs(created_at);

CREATE TABLE IF NOT EXISTS product_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT,
  vendor_item_id TEXT,
  cp_key TEXT,
  glomart_category_no TEXT,
  cafe24_category_no TEXT,
  lang TEXT,
  country TEXT,
  source TEXT,
  page_url TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_product_views_product_id ON product_views(product_id);
CREATE INDEX IF NOT EXISTS idx_product_views_vendor_item_id ON product_views(vendor_item_id);
CREATE INDEX IF NOT EXISTS idx_product_views_category ON product_views(glomart_category_no, cafe24_category_no);
CREATE INDEX IF NOT EXISTS idx_product_views_created_at ON product_views(created_at);

CREATE TABLE IF NOT EXISTS category_daily_stats (
  stat_date TEXT NOT NULL,
  glomart_category_no TEXT NOT NULL DEFAULT '',
  cafe24_category_no TEXT NOT NULL DEFAULT '',
  lang TEXT NOT NULL DEFAULT '',
  search_count INTEGER DEFAULT 0,
  view_count INTEGER DEFAULT 0,
  click_count INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(stat_date, glomart_category_no, cafe24_category_no, lang)
);

CREATE TABLE IF NOT EXISTS temp_bridge (
  temp_id TEXT PRIMARY KEY,
  coupang_url TEXT NOT NULL,
  product_id TEXT,
  item_id TEXT,
  vendor_item_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expire_at TEXT
);
