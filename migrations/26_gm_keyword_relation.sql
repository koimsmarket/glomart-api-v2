-- 26_gm_keyword_relation.sql
-- Final master schema: gm_lang, keyword_ko, related_keyword_ko.
-- Existing rows are preserved. Physical column order is rebuilt so CSV export
-- is always: gm_lang,keyword_ko,related_keyword_ko.

ALTER TABLE IF EXISTS gm_product ADD COLUMN IF NOT EXISTS keyword TEXT;
ALTER TABLE IF EXISTS gm_category ADD COLUMN IF NOT EXISTS keyword TEXT;

DO $$
BEGIN
  IF to_regclass('public.gm_keyword_relation') IS NULL THEN
    CREATE TABLE gm_keyword_relation (
      gm_lang VARCHAR(10) NOT NULL,
      keyword_ko TEXT NOT NULL,
      related_keyword_ko TEXT NOT NULL,
      CONSTRAINT gm_keyword_relation_pkey PRIMARY KEY (gm_lang, keyword_ko, related_keyword_ko)
    );
    RETURN;
  END IF;

  ALTER TABLE gm_keyword_relation ADD COLUMN IF NOT EXISTS gm_lang VARCHAR(10);
  ALTER TABLE gm_keyword_relation ADD COLUMN IF NOT EXISTS keyword_ko TEXT;
  ALTER TABLE gm_keyword_relation ADD COLUMN IF NOT EXISTS related_keyword_ko TEXT;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='gm_keyword_relation' AND column_name='keyword') THEN
    EXECUTE 'UPDATE gm_keyword_relation SET keyword_ko=COALESCE(NULLIF(BTRIM(keyword_ko),''''),NULLIF(BTRIM(keyword::text),'''')) WHERE keyword_ko IS NULL OR BTRIM(keyword_ko)=''''';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='gm_keyword_relation' AND column_name='related_keyword') THEN
    EXECUTE 'UPDATE gm_keyword_relation SET related_keyword_ko=COALESCE(NULLIF(BTRIM(related_keyword_ko),''''),NULLIF(BTRIM(related_keyword::text),'''')) WHERE related_keyword_ko IS NULL OR BTRIM(related_keyword_ko)=''''';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='gm_keyword_relation' AND column_name='lang') THEN
    EXECUTE 'UPDATE gm_keyword_relation SET gm_lang=COALESCE(NULLIF(BTRIM(gm_lang),''''),NULLIF(BTRIM(lang::text),'''')) WHERE gm_lang IS NULL OR BTRIM(gm_lang)=''''';
  END IF;

  UPDATE gm_keyword_relation
     SET gm_lang=CASE WHEN COALESCE(keyword_ko,'') ~ '[가-힣]' THEN 'ko' ELSE 'en' END
   WHERE gm_lang IS NULL OR BTRIM(gm_lang)='';
  UPDATE gm_keyword_relation SET gm_lang=LOWER(SPLIT_PART(REPLACE(gm_lang,'_','-'),'-',1));
  UPDATE gm_keyword_relation SET gm_lang=CASE gm_lang WHEN 'kr' THEN 'ko' WHEN 'cn' THEN 'zh' WHEN 'jp' THEN 'ja' WHEN 'vn' THEN 'vi' ELSE gm_lang END;

  DROP TABLE IF EXISTS gm_keyword_relation__new;
  CREATE TABLE gm_keyword_relation__new (
    gm_lang VARCHAR(10) NOT NULL,
    keyword_ko TEXT NOT NULL,
    related_keyword_ko TEXT NOT NULL,
    CONSTRAINT gm_keyword_relation__new_pkey PRIMARY KEY (gm_lang, keyword_ko, related_keyword_ko)
  );

  INSERT INTO gm_keyword_relation__new (gm_lang, keyword_ko, related_keyword_ko)
  SELECT DISTINCT gm_lang, BTRIM(keyword_ko), BTRIM(related_keyword_ko)
    FROM gm_keyword_relation
   WHERE COALESCE(BTRIM(gm_lang),'')<>''
     AND COALESCE(BTRIM(keyword_ko),'')<>''
     AND COALESCE(BTRIM(related_keyword_ko),'')<>''
  ON CONFLICT DO NOTHING;

  DROP TABLE gm_keyword_relation CASCADE;
  ALTER TABLE gm_keyword_relation__new RENAME TO gm_keyword_relation;
  ALTER TABLE gm_keyword_relation RENAME CONSTRAINT gm_keyword_relation__new_pkey TO gm_keyword_relation_pkey;
END $$;
