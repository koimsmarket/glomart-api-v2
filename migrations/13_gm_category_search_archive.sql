-- 13_gm_category_search_archive.sql
-- Purpose: category master/keyword management, search/category statistics, product archive transfer.

-- Existing dashboard/search tables: add columns required by V042.
ALTER TABLE IF EXISTS gm_dashboard_snapshot
  ADD COLUMN IF NOT EXISTS gm_product_archive_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gm_category_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gm_category_keyword_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gm_search_keyword_stat_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gm_category_search_stat_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS gm_search_log
  ADD COLUMN IF NOT EXISTS keyword_canonical TEXT;

-- Category master for Cafe24/Glomart management.
CREATE TABLE IF NOT EXISTS gm_category (
  category_no TEXT PRIMARY KEY,
  category_code TEXT,
  parent_category_no TEXT,
  parent_category_code TEXT,
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
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gm_category_code
  ON gm_category (category_code);

CREATE INDEX IF NOT EXISTS idx_gm_category_parent
  ON gm_category (parent_category_no, depth, sort_order);

-- Category keyword dictionary:
-- original typo/spacing/multilingual keywords are mapped to canonical keyword and category.
CREATE TABLE IF NOT EXISTS gm_category_keyword (
  keyword_id BIGSERIAL PRIMARY KEY,
  keyword_original TEXT NOT NULL,
  keyword_normalized TEXT NOT NULL,
  keyword_canonical TEXT,
  category_no TEXT,
  category_code TEXT,
  category_name TEXT,
  lang_code TEXT,
  country_code TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'active',
  confidence_score NUMERIC(8,4) NOT NULL DEFAULT 1.0,
  search_count INTEGER NOT NULL DEFAULT 0,
  last_seen_at TIMESTAMP,
  note TEXT,
  raw_json JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_gm_category_keyword_norm_lang_cat
  ON gm_category_keyword (
    keyword_normalized,
    COALESCE(lang_code,''),
    COALESCE(country_code,''),
    COALESCE(category_no,'')
  );

CREATE INDEX IF NOT EXISTS idx_gm_category_keyword_category
  ON gm_category_keyword (category_no, category_code, status);

CREATE INDEX IF NOT EXISTS idx_gm_category_keyword_canonical
  ON gm_category_keyword (keyword_canonical, status);

-- Search keyword statistics by original/normalized/canonical keyword + country/lang/category/mall.
CREATE TABLE IF NOT EXISTS gm_search_keyword_stat (
  stat_id BIGSERIAL PRIMARY KEY,
  keyword_original TEXT,
  keyword_normalized TEXT NOT NULL,
  keyword_canonical TEXT,
  country_code TEXT NOT NULL DEFAULT '',
  lang_code TEXT NOT NULL DEFAULT '',
  member_country_code TEXT,
  category_no TEXT NOT NULL DEFAULT '',
  category_code TEXT,
  category_name TEXT,
  mall_code TEXT NOT NULL DEFAULT '',
  search_count INTEGER NOT NULL DEFAULT 0,
  cache_used_count INTEGER NOT NULL DEFAULT 0,
  cache_miss_count INTEGER NOT NULL DEFAULT 0,
  result_count_sum INTEGER NOT NULL DEFAULT 0,
  db_insert_count_sum INTEGER NOT NULL DEFAULT 0,
  queue_send_count_sum INTEGER NOT NULL DEFAULT 0,
  first_search_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_search_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_gm_search_keyword_stat_key
  ON gm_search_keyword_stat (
    keyword_normalized,
    country_code,
    lang_code,
    category_no,
    mall_code
  );

CREATE INDEX IF NOT EXISTS idx_gm_search_keyword_stat_count
  ON gm_search_keyword_stat (search_count DESC, last_search_at DESC);

-- Category statistics by category + country/lang/mall.
CREATE TABLE IF NOT EXISTS gm_category_search_stat (
  stat_id BIGSERIAL PRIMARY KEY,
  category_no TEXT NOT NULL,
  category_code TEXT,
  category_name TEXT,
  country_code TEXT NOT NULL DEFAULT '',
  lang_code TEXT NOT NULL DEFAULT '',
  member_country_code TEXT,
  mall_code TEXT NOT NULL DEFAULT '',
  search_count INTEGER NOT NULL DEFAULT 0,
  cache_used_count INTEGER NOT NULL DEFAULT 0,
  cache_miss_count INTEGER NOT NULL DEFAULT 0,
  result_count_sum INTEGER NOT NULL DEFAULT 0,
  db_insert_count_sum INTEGER NOT NULL DEFAULT 0,
  queue_send_count_sum INTEGER NOT NULL DEFAULT 0,
  first_search_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_search_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_gm_category_search_stat_key
  ON gm_category_search_stat (
    category_no,
    country_code,
    lang_code,
    mall_code
  );

CREATE INDEX IF NOT EXISTS idx_gm_category_search_stat_count
  ON gm_category_search_stat (search_count DESC, last_search_at DESC);

-- Product archive: expired/soldout/manual-delete products are moved here instead of hard delete.
DO $$
BEGIN
  IF to_regclass('public.gm_product') IS NOT NULL THEN
    EXECUTE 'CREATE TABLE IF NOT EXISTS gm_product_archive (LIKE gm_product INCLUDING DEFAULTS)';
  ELSE
    CREATE TABLE IF NOT EXISTS gm_product_archive (
      product_uid TEXT PRIMARY KEY,
      mall_code TEXT,
      pi_ii_vi TEXT,
      product_name TEXT,
      raw_json JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  END IF;
END $$;

ALTER TABLE IF EXISTS gm_product_archive
  ADD COLUMN IF NOT EXISTS archive_reason TEXT NOT NULL DEFAULT 'EXPIRE',
  ADD COLUMN IF NOT EXISTS archive_source TEXT NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN IF NOT EXISTS expire_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS archive_note TEXT,
  ADD COLUMN IF NOT EXISTS archived_by TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_gm_product_archive_uid
  ON gm_product_archive (product_uid);

CREATE INDEX IF NOT EXISTS idx_gm_product_archive_reason_date
  ON gm_product_archive (archive_reason, expire_date DESC);

ALTER TABLE IF EXISTS gm_product
  ADD COLUMN IF NOT EXISTS archive_reason TEXT,
  ADD COLUMN IF NOT EXISTS archive_source TEXT,
  ADD COLUMN IF NOT EXISTS expire_date TIMESTAMP;
