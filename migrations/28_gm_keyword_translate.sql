-- 28_gm_keyword_translate.sql
-- Foreign/input keyword alias table for search normalization.

CREATE TABLE IF NOT EXISTS gm_keyword_translate (
  lang TEXT NOT NULL,
  input_keyword TEXT NOT NULL,
  main_keyword_ko TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (lang, input_keyword)
);

COMMENT ON TABLE gm_keyword_translate IS 'Search input alias. lang + input_keyword maps to Korean main_keyword_ko and tracks hit_count.';
COMMENT ON COLUMN gm_keyword_translate.lang IS 'Input language code, such as ko,en,zh,ja,vi.';
COMMENT ON COLUMN gm_keyword_translate.input_keyword IS 'User-entered keyword or translated alias in the given language.';
COMMENT ON COLUMN gm_keyword_translate.main_keyword_ko IS 'Korean normalized main search keyword.';
COMMENT ON COLUMN gm_keyword_translate.hit_count IS 'Number of times this alias mapping was observed or saved.';
