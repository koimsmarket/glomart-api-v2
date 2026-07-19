-- GM_KEYWORD_TRANSLATE_V048_ONE_TIME_EMPTY_RECREATE
-- 1회 실행용입니다. 운영 시작 전 기존 gm_keyword_translate 데이터를 전부 삭제하고 빈 테이블로 재생성합니다.
-- 실행 후 반드시 migration_operating/28_gm_keyword_translate.sql 을 migrations/28_gm_keyword_translate.sql 로 다시 복사하십시오.

DROP TABLE IF EXISTS gm_keyword_translate CASCADE;

CREATE TABLE gm_keyword_translate (
  -- Wide 구조: 한국어 검색어 1개 = lang='all' 1 row
  -- product.js 호환을 위해 lang/input_keyword 컬럼은 유지하되, lang은 항상 'all'만 사용합니다.
  lang TEXT NOT NULL DEFAULT 'all',
  input_keyword TEXT NOT NULL,
  main_keyword_ko TEXT NOT NULL,
  device_lang TEXT NOT NULL DEFAULT '',

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

  translate_complete CHAR(1) NOT NULL DEFAULT 'F',
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_at DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_at DATE NOT NULL DEFAULT CURRENT_DATE,

  PRIMARY KEY (lang, input_keyword),
  CONSTRAINT gm_keyword_translate_lang_all_chk CHECK (lang = 'all'),
  CONSTRAINT gm_keyword_translate_complete_chk CHECK (translate_complete IN ('T','F'))
);

CREATE INDEX IF NOT EXISTS idx_gm_keyword_translate_input_keyword ON gm_keyword_translate(input_keyword);
CREATE INDEX IF NOT EXISTS idx_gm_keyword_translate_main_keyword_ko ON gm_keyword_translate(main_keyword_ko);
CREATE INDEX IF NOT EXISTS idx_gm_keyword_translate_complete ON gm_keyword_translate(translate_complete);
CREATE INDEX IF NOT EXISTS idx_gm_keyword_translate_updated_at ON gm_keyword_translate(updated_at);

-- 검색로그 경량화 유지
ALTER TABLE gm_search_log DROP COLUMN IF EXISTS raw_json;
ALTER TABLE gm_search_log ALTER COLUMN cache_used TYPE CHAR(1)
USING CASE WHEN COALESCE(cache_used::text,'') IN ('true','t','T','Y','y','1') THEN 'T' ELSE 'F' END;
