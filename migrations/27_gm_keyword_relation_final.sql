-- 27_gm_keyword_relation_final.sql
-- 26번에서 확정 생성하므로 구형 컬럼을 다시 만들지 않는다.

CREATE TABLE IF NOT EXISTS gm_keyword_relation (
  gm_lang VARCHAR(10) NOT NULL,
  keyword_ko TEXT NOT NULL,
  related_keyword_ko TEXT NOT NULL,
  CONSTRAINT gm_keyword_relation_pkey
    PRIMARY KEY (gm_lang, keyword_ko, related_keyword_ko)
);
