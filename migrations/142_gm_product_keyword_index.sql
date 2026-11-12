-- 142_gm_product_keyword_index.sql / GM_PRODUCT_KEYWORD_INDEX_V002
-- Schema-and-trigger migration, no legacy index DROP. Apply MANUALLY before deploying the two modified JS services.
-- No automatic backfill or existing-index drop in this file.
-- Up to 20 keyword links per product: one table row per (product_uid, keyword).
CREATE TABLE IF NOT EXISTS gm_product_keyword_index (
  product_uid TEXT NOT NULL REFERENCES gm_product(product_uid) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  keyword_type VARCHAR(4) NOT NULL CHECK (keyword_type IN ('MAIN','SUB')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  showed_at TIMESTAMPTZ NULL,
  rank INTEGER NULL,
  rank_point NUMERIC NULL,
  CONSTRAINT gm_product_keyword_index_pkey PRIMARY KEY (product_uid, keyword),
  CONSTRAINT gm_product_keyword_index_nonempty CHECK (BTRIM(keyword)<>'')
);
-- KEYWORD-first ordered lookup for fair exposure rotation. PK already covers product/keyword uniqueness.
CREATE INDEX IF NOT EXISTS idx_gm_product_keyword_exposure
 ON gm_product_keyword_index (keyword, showed_at ASC NULLS FIRST, product_uid);

-- Preserve old tokens first, append new tokens in order, discard empties/duplicates.
-- No category MAIN value is written by this function: category_keyword is a separate column.
CREATE OR REPLACE FUNCTION gm_product_keyword_merge(old_value TEXT, new_value TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $fn$
 SELECT NULLIF(string_agg(token, '|' ORDER BY first_ord), '')
 FROM (
   SELECT token, MIN(ord) AS first_ord
   FROM (
     SELECT BTRIM(x) AS token, ord::bigint AS ord
       FROM unnest(string_to_array(COALESCE(old_value,''),'|')) WITH ORDINALITY AS t(x,ord)
     UNION ALL
     SELECT BTRIM(x) AS token, (1000000000 + ord)::bigint AS ord
       FROM unnest(string_to_array(COALESCE(new_value,''),'|')) WITH ORDINALITY AS t(x,ord)
   ) tokens
   WHERE token <> ''
   GROUP BY token
 ) dedup
$fn$;

-- Only actual changes to keyword/category_keyword write to the index. It deliberately
-- does NOT update showed_at/rank/rank_point: those belong to exposure ranking logic.
CREATE OR REPLACE FUNCTION gm_product_keyword_index_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
BEGIN
  -- An intentional MAIN category change demotes prior MAIN entries; keeps old search link.
  IF TG_OP='UPDATE' AND OLD.category_keyword IS DISTINCT FROM NEW.category_keyword THEN
    UPDATE gm_product_keyword_index k SET keyword_type='SUB',updated_at=NOW()
      WHERE k.product_uid=NEW.product_uid AND k.keyword_type='MAIN'
        AND NOT EXISTS (
          SELECT 1 FROM unnest(string_to_array(COALESCE(NEW.category_keyword,''),'|')) AS m(v)
          WHERE BTRIM(m.v)=k.keyword
        );
  END IF;
  INSERT INTO gm_product_keyword_index(product_uid,keyword,keyword_type,updated_at)
  SELECT NEW.product_uid, token,
         CASE WHEN BOOL_OR(kind='MAIN') THEN 'MAIN' ELSE 'SUB' END, NOW()
    FROM (
      SELECT BTRIM(x) AS token,'MAIN'::text AS kind
        FROM unnest(string_to_array(COALESCE(NEW.category_keyword,''),'|')) AS m(x)
      UNION ALL
      SELECT BTRIM(x) AS token,'SUB'::text AS kind
        FROM unnest(string_to_array(COALESCE(NEW.keyword,''),'|')) AS s(x)
    ) candidates
   WHERE token<>'' GROUP BY token
  ON CONFLICT(product_uid,keyword) DO UPDATE
    SET keyword_type=EXCLUDED.keyword_type,
        updated_at=CASE WHEN gm_product_keyword_index.keyword_type IS DISTINCT FROM EXCLUDED.keyword_type
                      THEN NOW() ELSE gm_product_keyword_index.updated_at END;
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_gm_product_keyword_index_ins ON gm_product;
CREATE TRIGGER trg_gm_product_keyword_index_ins
  AFTER INSERT ON gm_product
  FOR EACH ROW EXECUTE FUNCTION gm_product_keyword_index_sync();
DROP TRIGGER IF EXISTS trg_gm_product_keyword_index_upd ON gm_product;
CREATE TRIGGER trg_gm_product_keyword_index_upd
  AFTER UPDATE OF keyword, category_keyword ON gm_product
  FOR EACH ROW
  WHEN (OLD.keyword IS DISTINCT FROM NEW.keyword OR OLD.category_keyword IS DISTINCT FROM NEW.category_keyword)
  EXECUTE FUNCTION gm_product_keyword_index_sync();
