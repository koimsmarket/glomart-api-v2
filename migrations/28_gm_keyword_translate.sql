-- GM_KEYWORD_TRANSLATE_V045_ONE_TIME_RECREATE
-- 주의: 이 파일은 gm_keyword_translate 구조 전환을 위한 1회 실행용입니다.
-- 실행 후 반드시 migration_operating/28_gm_keyword_translate.sql 파일로 다시 교체하십시오.

DROP TABLE IF EXISTS gm_keyword_translate;

CREATE TABLE gm_keyword_translate (
  lang TEXT NOT NULL DEFAULT 'all',
  input_keyword TEXT NOT NULL,
  main_keyword_ko TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_at DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_at DATE NOT NULL DEFAULT CURRENT_DATE,
  translate_complete CHAR(1) NOT NULL DEFAULT 'F',

  keyword_ko TEXT,
  keyword_en TEXT,
  keyword_zh TEXT,
  keyword_vi TEXT,
  keyword_ja TEXT,
  keyword_tw TEXT,
  keyword_th TEXT,
  keyword_uz TEXT,
  keyword_ne TEXT,
  keyword_km TEXT,
  keyword_id TEXT,
  keyword_tl TEXT,
  keyword_mn TEXT,
  keyword_my TEXT,
  keyword_kk TEXT,
  keyword_si TEXT,
  keyword_ru TEXT,
  keyword_bn TEXT,
  keyword_ur TEXT,
  keyword_lo TEXT,
  keyword_hi TEXT,
  keyword_tr TEXT,
  keyword_fa TEXT,
  keyword_es TEXT,
  keyword_fr TEXT,

  PRIMARY KEY (lang, input_keyword)
);

CREATE INDEX IF NOT EXISTS idx_gm_keyword_translate_main_keyword_ko ON gm_keyword_translate(main_keyword_ko);
CREATE INDEX IF NOT EXISTS idx_gm_keyword_translate_complete ON gm_keyword_translate(translate_complete);
CREATE INDEX IF NOT EXISTS idx_gm_keyword_translate_updated_at ON gm_keyword_translate(updated_at);

-- 검색로그 경량화 유지
ALTER TABLE gm_search_log DROP COLUMN IF EXISTS raw_json;
ALTER TABLE gm_search_log ALTER COLUMN cache_used TYPE CHAR(1)
USING CASE WHEN COALESCE(cache_used::text,'') IN ('true','t','T','Y','y','1') THEN 'T' ELSE 'F' END;
