-- 26_gm_keyword_relation.sql
-- Final related-search table: exactly 3 columns.
-- 1) gm_lang  2) keyword_ko  3) related_keyword_ko
-- Existing rows are preserved; legacy columns are migrated and removed.

CREATE TABLE IF NOT EXISTS gm_keyword_relation (
  gm_lang VARCHAR(10),
  keyword_ko TEXT,
  related_keyword_ko TEXT
);

ALTER TABLE gm_keyword_relation ADD COLUMN IF NOT EXISTS gm_lang VARCHAR(10);
ALTER TABLE gm_keyword_relation ADD COLUMN IF NOT EXISTS keyword_ko TEXT;
ALTER TABLE gm_keyword_relation ADD COLUMN IF NOT EXISTS related_keyword_ko TEXT;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gm_keyword_relation' AND column_name='keyword') THEN
    EXECUTE 'UPDATE gm_keyword_relation SET keyword_ko=COALESCE(NULLIF(keyword_ko,'''') , NULLIF(keyword::text,'''')) WHERE keyword_ko IS NULL OR keyword_ko=''''';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gm_keyword_relation' AND column_name='related_keyword') THEN
    EXECUTE 'UPDATE gm_keyword_relation SET related_keyword_ko=COALESCE(NULLIF(related_keyword_ko,'''') , NULLIF(related_keyword::text,'''')) WHERE related_keyword_ko IS NULL OR related_keyword_ko=''''';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gm_keyword_relation' AND column_name='lang') THEN
    EXECUTE 'UPDATE gm_keyword_relation SET gm_lang=COALESCE(NULLIF(gm_lang,'''') , NULLIF(lang::text,'''')) WHERE gm_lang IS NULL OR gm_lang=''''';
  END IF;
END $$;

UPDATE gm_keyword_relation
SET gm_lang = CASE
  WHEN COALESCE(keyword_ko,'') ~ '[가-힣]' THEN 'ko'
  ELSE 'en'
END
WHERE gm_lang IS NULL OR BTRIM(gm_lang)='';

UPDATE gm_keyword_relation SET gm_lang=LOWER(SPLIT_PART(REPLACE(gm_lang,'_','-'),'-',1));
UPDATE gm_keyword_relation SET gm_lang='ko' WHERE gm_lang='kr';
UPDATE gm_keyword_relation SET gm_lang='zh' WHERE gm_lang='cn';
UPDATE gm_keyword_relation SET gm_lang='ja' WHERE gm_lang='jp';
UPDATE gm_keyword_relation SET gm_lang='vi' WHERE gm_lang='vn';

DELETE FROM gm_keyword_relation
WHERE COALESCE(BTRIM(keyword_ko),'')='' OR COALESCE(BTRIM(related_keyword_ko),'')='';

DELETE FROM gm_keyword_relation a
USING gm_keyword_relation b
WHERE a.ctid < b.ctid
  AND a.gm_lang=b.gm_lang
  AND a.keyword_ko=b.keyword_ko
  AND a.related_keyword_ko=b.related_keyword_ko;

DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema=current_schema()
      AND table_name='gm_keyword_relation'
      AND column_name NOT IN ('gm_lang','keyword_ko','related_keyword_ko')
  LOOP
    EXECUTE format('ALTER TABLE gm_keyword_relation DROP COLUMN IF EXISTS %I CASCADE', c.column_name);
  END LOOP;
END $$;

ALTER TABLE gm_keyword_relation ALTER COLUMN gm_lang SET NOT NULL;
ALTER TABLE gm_keyword_relation ALTER COLUMN keyword_ko SET NOT NULL;
ALTER TABLE gm_keyword_relation ALTER COLUMN related_keyword_ko SET NOT NULL;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint WHERE conrelid='gm_keyword_relation'::regclass AND contype IN ('p','u') LOOP
    EXECUTE format('ALTER TABLE gm_keyword_relation DROP CONSTRAINT IF EXISTS %I',r.conname);
  END LOOP;
END $$;

ALTER TABLE gm_keyword_relation
  ADD CONSTRAINT gm_keyword_relation_pkey PRIMARY KEY (gm_lang,keyword_ko,related_keyword_ko);

COMMENT ON TABLE gm_keyword_relation IS 'Related search terms. Exactly three fields: gm_lang, keyword_ko, related_keyword_ko.';
