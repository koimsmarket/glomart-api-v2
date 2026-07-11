-- 27_gm_keyword_relation_final.sql
-- Compatibility guard after migration 26.
-- Do not DROP/CREATE gm_keyword_relation and do not restore translation columns.

ALTER TABLE IF EXISTS gm_keyword_relation
  ADD COLUMN IF NOT EXISTS category_main_keyword_ko TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS keyword_ko TEXT,
  ADD COLUMN IF NOT EXISTS related_keyword_ko TEXT;

-- The final schema is owned by 26_gm_keyword_relation.sql.
-- This migration intentionally performs no destructive rebuild.
