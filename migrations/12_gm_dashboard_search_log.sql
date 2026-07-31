-- 12_gm_dashboard_search_log.sql
-- Purpose: Builder/dashboard realtime monitoring snapshots and search/category/country logs.

CREATE TABLE IF NOT EXISTS gm_dashboard_snapshot (
  snapshot_id BIGSERIAL PRIMARY KEY,
  snapshot_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  gm_product_count INTEGER NOT NULL DEFAULT 0,
  gm_basket_count INTEGER NOT NULL DEFAULT 0,
  gm_order_count INTEGER NOT NULL DEFAULT 0,
  gm_order_item_count INTEGER NOT NULL DEFAULT 0,
  gm_supplier_count INTEGER NOT NULL DEFAULT 0,
  gm_cs_count INTEGER NOT NULL DEFAULT 0,
  gm_cs_message_count INTEGER NOT NULL DEFAULT 0,
  gm_search_log_count INTEGER NOT NULL DEFAULT 0,
  queue_pending_count INTEGER NOT NULL DEFAULT 0,
  queue_processing_count INTEGER NOT NULL DEFAULT 0,
  queue_done_count INTEGER NOT NULL DEFAULT 0,
  queue_failed_count INTEGER NOT NULL DEFAULT 0,
  queue_total_count INTEGER NOT NULL DEFAULT 0,
  member_count INTEGER,
  today_order_count INTEGER,
  today_order_amount NUMERIC(18,2),
  today_product_view_count INTEGER,
  today_search_count INTEGER,
  db_size_bytes BIGINT,
  db_size_mb NUMERIC(18,2),
  db_size_percent NUMERIC(8,2),
  db_size_limit_mb NUMERIC(18,2),
  api_response_ms INTEGER,
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gm_dashboard_snapshot_at
  ON gm_dashboard_snapshot (snapshot_at DESC);

CREATE TABLE IF NOT EXISTS gm_search_log (
  search_id BIGSERIAL PRIMARY KEY,
  search_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  keyword_original TEXT,
  keyword_normalized TEXT,
  lang_code TEXT,
  country_code TEXT,
  member_country_code TEXT,
  category_code TEXT,
  category_no TEXT,
  category_name TEXT,
  mall_code TEXT,
  result_count INTEGER NOT NULL DEFAULT 0,
  db_insert_count INTEGER NOT NULL DEFAULT 0,
  queue_send_count INTEGER NOT NULL DEFAULT 0,
  cache_used BOOLEAN NOT NULL DEFAULT FALSE,
  cache_key TEXT,
  search_source TEXT,
  member_id TEXT,
  guest_key TEXT,
  device_type TEXT,
  request_id TEXT,
  raw_json JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- V021 existing-table compatibility:
-- gm_search_log may already exist from an older schema.
-- CREATE TABLE IF NOT EXISTS does not add missing columns, so ensure every
-- column used by the indexes below exists before creating those indexes.
ALTER TABLE gm_search_log ADD COLUMN IF NOT EXISTS search_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE gm_search_log ADD COLUMN IF NOT EXISTS keyword_normalized TEXT;
ALTER TABLE gm_search_log ADD COLUMN IF NOT EXISTS category_code TEXT;
ALTER TABLE gm_search_log ADD COLUMN IF NOT EXISTS category_no TEXT;
ALTER TABLE gm_search_log ADD COLUMN IF NOT EXISTS country_code TEXT;
ALTER TABLE gm_search_log ADD COLUMN IF NOT EXISTS lang_code TEXT;
ALTER TABLE gm_search_log ADD COLUMN IF NOT EXISTS mall_code TEXT;
ALTER TABLE gm_search_log ADD COLUMN IF NOT EXISTS cache_used BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_gm_search_log_at
  ON gm_search_log (search_at DESC);

CREATE INDEX IF NOT EXISTS idx_gm_search_log_keyword
  ON gm_search_log (keyword_normalized, search_at DESC);

CREATE INDEX IF NOT EXISTS idx_gm_search_log_category_country
  ON gm_search_log (category_code, category_no, country_code, search_at DESC);

CREATE INDEX IF NOT EXISTS idx_gm_search_log_lang_country
  ON gm_search_log (lang_code, country_code, search_at DESC);

CREATE INDEX IF NOT EXISTS idx_gm_search_log_mall_cache
  ON gm_search_log (mall_code, cache_used, search_at DESC);
