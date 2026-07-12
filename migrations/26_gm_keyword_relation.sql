-- 26_gm_keyword_relation.sql
-- 개발 단계 최종 확정: 기존 gm_keyword_relation을 삭제하고 3컬럼으로 새로 생성한다.
-- 데이터는 별도 CSV로 다시 업로드한다.

ALTER TABLE IF EXISTS gm_product ADD COLUMN IF NOT EXISTS keyword TEXT;
ALTER TABLE IF EXISTS gm_category ADD COLUMN IF NOT EXISTS keyword TEXT;

DROP TABLE IF EXISTS gm_keyword_relation CASCADE;

CREATE TABLE gm_keyword_relation (
  gm_lang VARCHAR(10) NOT NULL,
  keyword_ko TEXT NOT NULL,
  related_keyword_ko TEXT NOT NULL,
  CONSTRAINT gm_keyword_relation_pkey
    PRIMARY KEY (gm_lang, keyword_ko, related_keyword_ko)
);
