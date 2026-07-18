-- GLOMART KEYWORD RELATION MASTER
-- Final schema policy:
-- 1) This table stores Korean keyword relationships only.
-- 2) Multilingual translations belong in gm_keyword_translate.
-- 3) Do not add gm_lang, translated keyword columns, or timestamp columns here.
-- 4) The server UPSERT uses exactly these three columns.

CREATE TABLE IF NOT EXISTS gm_keyword_relation (
    category_main_keyword_ko TEXT NOT NULL DEFAULT '',
    keyword_ko               TEXT NOT NULL,
    related_keyword_ko       TEXT NOT NULL,
    PRIMARY KEY (keyword_ko, related_keyword_ko)
);
