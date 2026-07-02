-- 27_gm_keyword_relation_final.sql
-- Final keyword relation schema for Glomart related-search terms.
-- 확정안:
-- - Master: gm_keyword_relation
-- - Monthly physical tables: gm_keyword_relation_YYYYMM (예: 202607, 202608)
-- - Yearly physical tables: gm_keyword_relation_YYYY (예: 2026, 2027)
-- - No relation_id, relation_key, mall_code, yyyymm, yyyy columns.
-- - Natural PK: (keyword_ko, related_keyword_ko)
-- - category_main_keyword_ko is Korean-only category primary keyword.

DROP TABLE IF EXISTS gm_keyword_relation CASCADE;

CREATE TABLE IF NOT EXISTS gm_keyword_relation (
  category_main_keyword_ko TEXT NOT NULL DEFAULT '',
  keyword_ko TEXT NOT NULL,
  related_keyword_ko TEXT NOT NULL,
  related_keyword_en TEXT DEFAULT '',
  related_keyword_zh TEXT DEFAULT '',
  related_keyword_vi TEXT DEFAULT '',
  related_keyword_ja TEXT DEFAULT '',
  related_keyword_tw TEXT DEFAULT '',
  related_keyword_th TEXT DEFAULT '',
  related_keyword_uz TEXT DEFAULT '',
  related_keyword_ne TEXT DEFAULT '',
  related_keyword_km TEXT DEFAULT '',
  related_keyword_id TEXT DEFAULT '',
  related_keyword_tl TEXT DEFAULT '',
  related_keyword_mn TEXT DEFAULT '',
  related_keyword_my TEXT DEFAULT '',
  related_keyword_kk TEXT DEFAULT '',
  related_keyword_si TEXT DEFAULT '',
  related_keyword_ru TEXT DEFAULT '',
  related_keyword_bn TEXT DEFAULT '',
  related_keyword_ur TEXT DEFAULT '',
  related_keyword_lo TEXT DEFAULT '',
  related_keyword_hi TEXT DEFAULT '',
  related_keyword_tr TEXT DEFAULT '',
  related_keyword_fa TEXT DEFAULT '',
  related_keyword_es TEXT DEFAULT '',
  related_keyword_fr TEXT DEFAULT '',
  updated_at DATE NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (keyword_ko, related_keyword_ko)
);

COMMENT ON TABLE gm_keyword_relation IS 'Related search master. Korean keyword + Korean related keyword are the natural key. Display text is stored in 25 related_keyword_* language columns.';
COMMENT ON COLUMN gm_keyword_relation.category_main_keyword_ko IS 'Category primary keyword. Korean only.';
COMMENT ON COLUMN gm_keyword_relation.keyword_ko IS 'Korean base search keyword.';
COMMENT ON COLUMN gm_keyword_relation.related_keyword_ko IS 'Korean related keyword. Search execution uses this value.';

DO $$
DECLARE
  ym TEXT;
  yy TEXT;
BEGIN
  -- Current/next month tables for July 2026 deployment window.
  FOREACH ym IN ARRAY ARRAY['202607','202608'] LOOP
    EXECUTE format($fmt$
      CREATE TABLE IF NOT EXISTS gm_keyword_relation_%s (
        category_main_keyword_ko TEXT NOT NULL DEFAULT '',
        keyword_ko TEXT NOT NULL,
        related_keyword_ko TEXT NOT NULL,
        day_01 INTEGER NOT NULL DEFAULT 0,
        day_02 INTEGER NOT NULL DEFAULT 0,
        day_03 INTEGER NOT NULL DEFAULT 0,
        day_04 INTEGER NOT NULL DEFAULT 0,
        day_05 INTEGER NOT NULL DEFAULT 0,
        day_06 INTEGER NOT NULL DEFAULT 0,
        day_07 INTEGER NOT NULL DEFAULT 0,
        day_08 INTEGER NOT NULL DEFAULT 0,
        day_09 INTEGER NOT NULL DEFAULT 0,
        day_10 INTEGER NOT NULL DEFAULT 0,
        day_11 INTEGER NOT NULL DEFAULT 0,
        day_12 INTEGER NOT NULL DEFAULT 0,
        day_13 INTEGER NOT NULL DEFAULT 0,
        day_14 INTEGER NOT NULL DEFAULT 0,
        day_15 INTEGER NOT NULL DEFAULT 0,
        day_16 INTEGER NOT NULL DEFAULT 0,
        day_17 INTEGER NOT NULL DEFAULT 0,
        day_18 INTEGER NOT NULL DEFAULT 0,
        day_19 INTEGER NOT NULL DEFAULT 0,
        day_20 INTEGER NOT NULL DEFAULT 0,
        day_21 INTEGER NOT NULL DEFAULT 0,
        day_22 INTEGER NOT NULL DEFAULT 0,
        day_23 INTEGER NOT NULL DEFAULT 0,
        day_24 INTEGER NOT NULL DEFAULT 0,
        day_25 INTEGER NOT NULL DEFAULT 0,
        day_26 INTEGER NOT NULL DEFAULT 0,
        day_27 INTEGER NOT NULL DEFAULT 0,
        day_28 INTEGER NOT NULL DEFAULT 0,
        day_29 INTEGER NOT NULL DEFAULT 0,
        day_30 INTEGER NOT NULL DEFAULT 0,
        day_31 INTEGER NOT NULL DEFAULT 0,
        month_total INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (keyword_ko, related_keyword_ko)
      )
    $fmt$, ym);
  END LOOP;

  -- Current/next year tables for 2026 deployment window.
  FOREACH yy IN ARRAY ARRAY['2026','2027'] LOOP
    EXECUTE format($fmt$
      CREATE TABLE IF NOT EXISTS gm_keyword_relation_%s (
        category_main_keyword_ko TEXT NOT NULL DEFAULT '',
        keyword_ko TEXT NOT NULL,
        related_keyword_ko TEXT NOT NULL,
        month_01 INTEGER NOT NULL DEFAULT 0,
        month_02 INTEGER NOT NULL DEFAULT 0,
        month_03 INTEGER NOT NULL DEFAULT 0,
        month_04 INTEGER NOT NULL DEFAULT 0,
        month_05 INTEGER NOT NULL DEFAULT 0,
        month_06 INTEGER NOT NULL DEFAULT 0,
        month_07 INTEGER NOT NULL DEFAULT 0,
        month_08 INTEGER NOT NULL DEFAULT 0,
        month_09 INTEGER NOT NULL DEFAULT 0,
        month_10 INTEGER NOT NULL DEFAULT 0,
        month_11 INTEGER NOT NULL DEFAULT 0,
        month_12 INTEGER NOT NULL DEFAULT 0,
        year_total INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (keyword_ko, related_keyword_ko)
      )
    $fmt$, yy);
  END LOOP;
END $$;

-- Ensure existing deployments store only date in updated_at.
ALTER TABLE IF EXISTS gm_keyword_relation ALTER COLUMN updated_at TYPE DATE USING updated_at::date;
