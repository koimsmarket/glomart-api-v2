-- 32_gm_search_log_v2.sql
-- Search log V2: one user search = one row. Existing search log data may be discarded.

DROP TABLE IF EXISTS gm_guest_member_link;
DROP TABLE IF EXISTS gm_search_log;
DROP SEQUENCE IF EXISTS gm_detail_entry_seq;

CREATE SEQUENCE gm_detail_entry_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE gm_search_log (
  search_id BIGSERIAL PRIMARY KEY,
  search_event_id TEXT NOT NULL UNIQUE,
  search_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  result_rendered_at TIMESTAMP,

  keyword_original TEXT,
  keyword_normalized TEXT,
  keyword_canonical TEXT,
  lang_code TEXT,
  ui_lang_code TEXT,
  keyword_lang_code TEXT,
  country_code TEXT,
  member_country_code TEXT,
  category_code TEXT,
  category_no TEXT,
  category_name TEXT,

  gmkr_result_count INTEGER NOT NULL DEFAULT 0,
  cpkr_result_count INTEGER NOT NULL DEFAULT 0,
  alkr_result_count INTEGER NOT NULL DEFAULT 0,
  smartfit_result_count INTEGER NOT NULL DEFAULT 0,
  db_insert_count INTEGER NOT NULL DEFAULT 0,
  queue_send_count INTEGER NOT NULL DEFAULT 0,

  cache_used CHAR(1) NOT NULL DEFAULT 'F' CHECK (cache_used IN ('T','F')),
  cache_key TEXT,
  search_source TEXT,

  member_id TEXT,
  guest_key TEXT,
  device_type TEXT NOT NULL DEFAULT 'PHONE' CHECK (device_type IN ('PHONE','TABLET','PC')),
  device_lang TEXT NOT NULL DEFAULT '',
  client_app TEXT NOT NULL DEFAULT 'GLOMART_MOBILE',

  id_search_count INTEGER NOT NULL DEFAULT 0,
  id_keyword_count INTEGER NOT NULL DEFAULT 0,
  id_detail_count INTEGER NOT NULL DEFAULT 0,
  guest_search_count INTEGER NOT NULL DEFAULT 0,
  guest_keyword_count INTEGER NOT NULL DEFAULT 0,
  guest_detail_count INTEGER NOT NULL DEFAULT 0,
  merged_search_count INTEGER NOT NULL DEFAULT 0,
  merged_keyword_count INTEGER NOT NULL DEFAULT 0,
  merged_detail_count INTEGER NOT NULL DEFAULT 0,

  detail_enter_count INTEGER NOT NULL DEFAULT 0,
  detail_entry_no BIGINT NOT NULL DEFAULT 0,
  next_search_event_id TEXT,
  next_keyword_normalized TEXT,
  next_search_delay_ms INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE gm_guest_member_link (
  guest_key TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_gm_search_log_at ON gm_search_log(search_at DESC);
CREATE INDEX idx_gm_search_log_keyword ON gm_search_log(keyword_normalized, search_at DESC);
CREATE INDEX idx_gm_search_log_member ON gm_search_log(member_id, search_at DESC);
CREATE INDEX idx_gm_search_log_member_keyword ON gm_search_log(member_id, keyword_normalized, search_at DESC);
CREATE INDEX idx_gm_search_log_guest ON gm_search_log(guest_key, search_at DESC);
CREATE INDEX idx_gm_search_log_guest_keyword ON gm_search_log(guest_key, keyword_normalized, search_at DESC);
CREATE INDEX idx_gm_search_log_category_country ON gm_search_log(category_code, category_no, country_code, search_at DESC);
CREATE INDEX idx_gm_search_log_ui_keyword_lang ON gm_search_log(ui_lang_code, keyword_lang_code, country_code, search_at DESC);
CREATE INDEX idx_gm_guest_member_link_member ON gm_guest_member_link(member_id, created_at DESC);
