-- 13_gm_category_search_archive.sql
-- V018: gm_category base structure preserved. Only front identifier columns renamed/added. Development upsert key is cp_code.
-- DEV/Cloud test safe before official start: DROP/CREATE gm_category only.
-- NOTE: Upload/update key during development is cp_code. cp_id is learned later and must not be overwritten by translated category uploads.

DROP TABLE IF EXISTS gm_category CASCADE;

CREATE TABLE gm_category (
  category_id BIGSERIAL PRIMARY KEY,
  gm_code TEXT NOT NULL,
  cp_code TEXT,
  gm_parent_code TEXT,
  cp_parent_code TEXT,
  cp_id TEXT,
  parent_name_ko TEXT,
  depth INTEGER NOT NULL DEFAULT 0,
  leaf_yn TEXT NOT NULL DEFAULT 'N',
  display_yn TEXT NOT NULL DEFAULT 'Y',
  sort_order INTEGER NOT NULL DEFAULT 0,
  name_ko TEXT,
  name_en TEXT,
  name_zh TEXT,
  name_vi TEXT,
  name_ja TEXT,
  name_tw TEXT,
  name_th TEXT,
  name_uz TEXT,
  name_ne TEXT,
  name_km TEXT,
  name_id TEXT,
  name_tl TEXT,
  name_mn TEXT,
  name_my TEXT,
  name_kk TEXT,
  name_si TEXT,
  name_ru TEXT,
  name_bn TEXT,
  name_ur TEXT,
  name_lo TEXT,
  name_hi TEXT,
  name_tr TEXT,
  name_fa TEXT,
  name_es TEXT,
  name_fr TEXT,
  keyword_seed TEXT,
  raw_json JSONB,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  view_count INTEGER NOT NULL DEFAULT 0,
  search_count INTEGER NOT NULL DEFAULT 0,
  wish_count INTEGER NOT NULL DEFAULT 0,
  cart_count INTEGER NOT NULL DEFAULT 0,
  order_count INTEGER NOT NULL DEFAULT 0,
  sales_qty INTEGER NOT NULL DEFAULT 0,
  sales_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  purchase_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  gross_profit NUMERIC(18,2) NOT NULL DEFAULT 0,
  return_count INTEGER NOT NULL DEFAULT 0,
  exchange_count INTEGER NOT NULL DEFAULT 0,
  ad_view_count INTEGER NOT NULL DEFAULT 0,
  ad_order_count INTEGER NOT NULL DEFAULT 0,
  ad_sales_qty INTEGER NOT NULL DEFAULT 0,
  ad_sales_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  last_search_at TEXT,
  last_view_at TEXT,
  last_order_at TEXT,
  last_return_at TEXT,
  last_exchange_at TEXT,
  last_ad_view_at TEXT,
  last_ad_order_at TEXT,
  keyword TEXT
);

CREATE UNIQUE INDEX ux_gm_category_gm_code
  ON gm_category (gm_code)
  WHERE gm_code IS NOT NULL AND gm_code <> '';

CREATE UNIQUE INDEX ux_gm_category_cp_code
  ON gm_category (cp_code)
  WHERE cp_code IS NOT NULL AND cp_code <> '';

CREATE INDEX idx_gm_category_gm_parent_code ON gm_category (gm_parent_code);
CREATE INDEX idx_gm_category_cp_parent_code ON gm_category (cp_parent_code);
CREATE INDEX idx_gm_category_cp_id ON gm_category (cp_id);
CREATE INDEX idx_gm_category_parent_name_ko ON gm_category (parent_name_ko);
CREATE INDEX idx_gm_category_name_ko ON gm_category (name_ko);
CREATE INDEX idx_gm_category_keyword ON gm_category (keyword);
CREATE INDEX idx_gm_category_tree ON gm_category (depth, sort_order, gm_code);
