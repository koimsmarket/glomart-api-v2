-- GM_BARCODE_PRODUCT_V001
-- Barcode lookup cache. Keep intentionally lightweight.
CREATE TABLE IF NOT EXISTS gm_barcode_product (
  barcode TEXT PRIMARY KEY,
  product_original TEXT,
  product_ko TEXT,
  brand TEXT,
  category TEXT,
  keyword TEXT,
  image_url TEXT,
  price_low NUMERIC(15,2),
  price_high NUMERIC(15,2),
  source TEXT NOT NULL DEFAULT 'UPCITEMDB',
  country TEXT,
  source_url TEXT,
  product_url TEXT,
  search_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gm_barcode_product_search_count ON gm_barcode_product(search_count DESC);
CREATE INDEX IF NOT EXISTS idx_gm_barcode_product_keyword ON gm_barcode_product(keyword);
