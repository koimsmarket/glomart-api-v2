-- 27_gm_keyword_relation_final.sql
-- Legacy 30-column recreation removed. Final master has exactly three columns.

DO $$
BEGIN
  IF to_regclass('public.gm_keyword_relation') IS NULL THEN
    CREATE TABLE gm_keyword_relation (
      gm_lang VARCHAR(10) NOT NULL,
      keyword_ko TEXT NOT NULL,
      related_keyword_ko TEXT NOT NULL,
      CONSTRAINT gm_keyword_relation_pkey PRIMARY KEY (gm_lang, keyword_ko, related_keyword_ko)
    );
  END IF;
END $$;
