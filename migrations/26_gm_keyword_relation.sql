-- GLOMART KEYWORD RELATION MASTER
-- Final schema policy:
-- 1) This table stores Korean keyword relationships only.
-- 2) Multilingual translations belong in gm_keyword_translate.
-- 3) Final columns are exactly:
--      category_main_keyword_ko, keyword_ko, related_keyword_ko
-- 4) The server UPSERT uses exactly these three columns.
-- 5) Existing operating DBs may still have gm_lang as the first column.
--    In that case, rename gm_lang to category_main_keyword_ko without dropping data.
-- 6) This migration is safe to run repeatedly. Do not add DROP TABLE here.

CREATE TABLE IF NOT EXISTS gm_keyword_relation (
    category_main_keyword_ko TEXT NOT NULL DEFAULT '',
    keyword_ko               TEXT NOT NULL,
    related_keyword_ko       TEXT NOT NULL,
    PRIMARY KEY (keyword_ko, related_keyword_ko)
);

DO $$
BEGIN
    -- Existing old 3-column schema:
    -- gm_lang, keyword_ko, related_keyword_ko
    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'gm_keyword_relation'
           AND column_name = 'gm_lang'
    )
    AND NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'gm_keyword_relation'
           AND column_name = 'category_main_keyword_ko'
    ) THEN
        ALTER TABLE gm_keyword_relation
            RENAME COLUMN gm_lang TO category_main_keyword_ko;
    END IF;

    -- Defensive cleanup: if both columns somehow exist, keep the final column only.
    IF EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'gm_keyword_relation'
           AND column_name = 'gm_lang'
    )
    AND EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'gm_keyword_relation'
           AND column_name = 'category_main_keyword_ko'
    ) THEN
        ALTER TABLE gm_keyword_relation DROP COLUMN gm_lang;
    END IF;
END
$$;

ALTER TABLE gm_keyword_relation
    ALTER COLUMN category_main_keyword_ko SET DEFAULT '',
    ALTER COLUMN category_main_keyword_ko SET NOT NULL,
    ALTER COLUMN keyword_ko SET NOT NULL,
    ALTER COLUMN related_keyword_ko SET NOT NULL;
