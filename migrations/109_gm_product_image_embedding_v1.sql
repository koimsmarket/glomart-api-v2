-- GM_PRODUCT_IMAGE_EMBEDDING_V002 / SERVER V336
-- MobileCLIP target: 512-dimensional pgvector `vector`.
-- Do NOT use halfvec: the current production pgvector extension does not provide it.
-- Preserve every row/product_uid. Existing pgvector values are preserved so /missing can
-- distinguish 512-d current vectors from stale dimensions and rebuild stale rows lazily.
-- If the historical column is an array/non-pgvector type, its old values are cleared while rows remain.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE gm_product_image_vector
  ALTER COLUMN vector_image DROP NOT NULL;

-- Remove the failed/obsolete halfvec index name if it exists.
DROP INDEX IF EXISTS idx_gm_product_image_vector_hnsw_cosine;

DO $$
DECLARE
  current_type text;
BEGIN
  SELECT t.typname
    INTO current_type
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_type t ON t.oid = a.atttypid
   WHERE c.relname = 'gm_product_image_vector'
     AND a.attname = 'vector_image'
     AND a.attnum > 0
     AND NOT a.attisdropped
   ORDER BY CASE WHEN n.nspname = current_schema() THEN 0 ELSE 1 END
   LIMIT 1;

  IF current_type = 'vector' THEN
    -- vector(n) -> unconstrained vector keeps existing values and allows lazy mixed-dimension migration.
    ALTER TABLE gm_product_image_vector
      ALTER COLUMN vector_image TYPE vector
      USING vector_image::vector;
  ELSE
    -- Legacy REAL[]/other formats are not MobileCLIP embeddings. Keep the row/product_uid only.
    ALTER TABLE gm_product_image_vector
      ALTER COLUMN vector_image TYPE vector
      USING NULL::vector;
  END IF;
END $$;

-- Only 512-d values count as current. Other dimensions remain in place until that product
-- is encountered, when /missing returns it and /upsert replaces it with a 512-d MobileCLIP vector.
-- An ANN index can be added later as a partial expression index after production pgvector
-- version/capabilities are confirmed; correctness does not depend on it.
