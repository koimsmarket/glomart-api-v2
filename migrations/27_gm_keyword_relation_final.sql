-- 27_gm_keyword_relation_final.sql
-- Compatibility guard only. Do not recreate or expand gm_keyword_relation.
-- The final schema is owned by 26_gm_keyword_relation.sql.

CREATE TABLE IF NOT EXISTS gm_keyword_relation (
  gm_lang VARCHAR(10) NOT NULL,
  keyword_ko TEXT NOT NULL,
  related_keyword_ko TEXT NOT NULL,
  PRIMARY KEY (gm_lang,keyword_ko,related_keyword_ko)
);
