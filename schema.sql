CREATE TABLE IF NOT EXISTS products_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT,
  vendor_item_id TEXT,
  item_id TEXT,
  cp_key TEXT,
  coupang_url TEXT,
  glomart_category_no TEXT,
  cafe24_category_no TEXT,
  product_name TEXT,
  option_name TEXT,
  option_group TEXT,
  real_price INTEGER,
  display_price INTEGER,
  shipping_text TEXT,
  stock_status TEXT,
  warning_text TEXT,
  lang TEXT,
  extra_json TEXT,
  raw_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, vendor_item_id)
);

CREATE TABLE IF NOT EXISTS product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  glomart_category_no TEXT,
  product_id TEXT NOT NULL,
  image_type TEXT NOT NULL,
  image_url TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  width INTEGER,
  height INTEGER,
  collected_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, image_type, image_url)
);

CREATE TABLE IF NOT EXISTS search_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_keyword TEXT,
  matched_keyword TEXT,
  glomart_category_no TEXT,
  cafe24_category_no TEXT,
  lang TEXT,
  country TEXT,
  action_type TEXT,
  result_count INTEGER DEFAULT 0,
  count INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
