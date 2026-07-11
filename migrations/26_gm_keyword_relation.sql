-- 26_gm_keyword_relation.sql
-- Final master schema: preserve existing rows and keep only three columns.
--   category_main_keyword_ko, keyword_ko, related_keyword_ko

ALTER TABLE IF EXISTS gm_product
  ADD COLUMN IF NOT EXISTS keyword TEXT;

ALTER TABLE IF EXISTS gm_category
  ADD COLUMN IF NOT EXISTS keyword TEXT;

CREATE TABLE IF NOT EXISTS gm_keyword_relation (
  category_main_keyword_ko TEXT NOT NULL DEFAULT '',
  keyword_ko TEXT NOT NULL,
  related_keyword_ko TEXT NOT NULL,
  PRIMARY KEY (keyword_ko, related_keyword_ko)
);

-- Existing legacy table: add the three final columns without deleting rows.
ALTER TABLE gm_keyword_relation
  ADD COLUMN IF NOT EXISTS category_main_keyword_ko TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS keyword_ko TEXT,
  ADD COLUMN IF NOT EXISTS related_keyword_ko TEXT;

-- Copy values from legacy columns only when those columns exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'gm_keyword_relation'
      AND column_name = 'keyword'
  ) THEN
    EXECUTE $q$
      UPDATE gm_keyword_relation
         SET keyword_ko = COALESCE(NULLIF(BTRIM(keyword_ko), ''), BTRIM(keyword))
       WHERE COALESCE(BTRIM(keyword_ko), '') = ''
    $q$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'gm_keyword_relation'
      AND column_name = 'related_keyword'
  ) THEN
    EXECUTE $q$
      UPDATE gm_keyword_relation
         SET related_keyword_ko = COALESCE(NULLIF(BTRIM(related_keyword_ko), ''), BTRIM(related_keyword))
       WHERE COALESCE(BTRIM(related_keyword_ko), '') = ''
    $q$;
  END IF;
END $$;

UPDATE gm_keyword_relation
   SET category_main_keyword_ko = COALESCE(category_main_keyword_ko, ''),
       keyword_ko = BTRIM(COALESCE(keyword_ko, '')),
       related_keyword_ko = BTRIM(COALESCE(related_keyword_ko, ''));

-- Invalid empty records cannot participate in the final natural key.
DELETE FROM gm_keyword_relation
 WHERE keyword_ko = '' OR related_keyword_ko = '';

-- Preserve one row per natural key before adding the primary key.
DELETE FROM gm_keyword_relation a
USING gm_keyword_relation b
WHERE a.ctid < b.ctid
  AND a.keyword_ko = b.keyword_ko
  AND a.related_keyword_ko = b.related_keyword_ko;

-- Remove every legacy/translation/status column while preserving all rows.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'gm_keyword_relation'
       AND column_name NOT IN (
         'category_main_keyword_ko',
         'keyword_ko',
         'related_keyword_ko'
       )
  LOOP
    EXECUTE format(
      'ALTER TABLE gm_keyword_relation DROP COLUMN IF EXISTS %I CASCADE',
      r.column_name
    );
  END LOOP;
END $$;

ALTER TABLE gm_keyword_relation
  ALTER COLUMN category_main_keyword_ko SET DEFAULT '',
  ALTER COLUMN category_main_keyword_ko SET NOT NULL,
  ALTER COLUMN keyword_ko SET NOT NULL,
  ALTER COLUMN related_keyword_ko SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'gm_keyword_relation'::regclass
       AND contype = 'p'
  ) THEN
    ALTER TABLE gm_keyword_relation
      ADD CONSTRAINT gm_keyword_relation_pkey
      PRIMARY KEY (keyword_ko, related_keyword_ko);
  END IF;
END $$;

COMMENT ON TABLE gm_keyword_relation IS
  'Related-search master. Only Korean category keyword, base keyword and related keyword are stored.';
