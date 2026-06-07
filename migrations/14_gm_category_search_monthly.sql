-- 14_gm_category_search_monthly.sql
-- Purpose: monthly category demand counter by category + country + UI language + mall.

CREATE TABLE IF NOT EXISTS gm_category_search_monthly (
  monthly_id BIGSERIAL PRIMARY KEY,
  yyyymm TEXT NOT NULL,
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

CREATE UNIQUE INDEX IF NOT EXISTS ux_gm_category_search_monthly_key
  ON gm_category_search_monthly (
    yyyymm,
    category_no,
    country_code,
    lang_code,
    mall_code
  );

CREATE INDEX IF NOT EXISTS idx_gm_category_search_monthly_count
  ON gm_category_search_monthly (yyyymm, search_count DESC, last_search_at DESC);

ALTER TABLE IF EXISTS gm_dashboard_snapshot
  ADD COLUMN IF NOT EXISTS gm_category_search_monthly_count INTEGER NOT NULL DEFAULT 0;
