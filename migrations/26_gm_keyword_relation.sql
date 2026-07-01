-- 26_gm_keyword_relation.sql
-- Product/category primary keyword + 1:1 related keyword records.
-- 쿠팡 검색창 아래 추천/연관검색어 저장용.

ALTER TABLE IF EXISTS gm_product
  ADD COLUMN IF NOT EXISTS keyword TEXT;

ALTER TABLE IF EXISTS gm_category
  ADD COLUMN IF NOT EXISTS keyword TEXT;

CREATE TABLE IF NOT EXISTS gm_keyword_relation (
  id BIGSERIAL PRIMARY KEY,
  mall_code TEXT NOT NULL DEFAULT '',
  keyword TEXT NOT NULL,
  keyword_normalized TEXT NOT NULL,
  related_keyword TEXT NOT NULL,
  related_keyword_normalized TEXT NOT NULL,
  related_order INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'search_suggest',
  hit_count INTEGER NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMP NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMP NOT NULL DEFAULT now(),
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_gm_keyword_relation_pair
  ON gm_keyword_relation (mall_code, keyword_normalized, related_keyword_normalized);

CREATE INDEX IF NOT EXISTS ix_gm_keyword_relation_keyword
  ON gm_keyword_relation (mall_code, keyword_normalized, related_order);
