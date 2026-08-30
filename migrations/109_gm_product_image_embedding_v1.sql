-- GM_PRODUCT_IMAGE_EMBEDDING_V003 / V342
-- MobileCLIP target: 512-dimensional pgvector vector.
-- Preserve every row/product_uid. Legacy non-512 image vectors become NULL and are rebuilt lazily.
-- This migration supports the currently deployed REAL[] vector_image column.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE gm_product_image_vector
  ALTER COLUMN vector_image DROP NOT NULL;

DROP INDEX IF EXISTS idx_gm_product_image_vector_hnsw_cosine;

DO $$
DECLARE
  current_type text;
BEGIN
  SELECT format_type(a.atttypid,a.atttypmod)
    INTO current_type
    FROM pg_attribute a
    JOIN pg_class c ON c.oid=a.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE c.relname='gm_product_image_vector'
     AND a.attname='vector_image'
     AND a.attnum>0
     AND NOT a.attisdropped
   ORDER BY CASE WHEN n.nspname=current_schema() THEN 0 ELSE 1 END
   LIMIT 1;

  IF current_type IS NULL THEN
    RAISE EXCEPTION 'gm_product_image_vector.vector_image not found';
  ELSIF current_type LIKE 'vector%' THEN
    -- Keep only current 512-dimensional vectors. Rows remain untouched.
    UPDATE gm_product_image_vector
       SET vector_image=NULL
     WHERE vector_image IS NOT NULL
       AND vector_dims(vector_image)<>512;

    ALTER TABLE gm_product_image_vector
      ALTER COLUMN vector_image TYPE vector(512)
      USING CASE
              WHEN vector_image IS NULL THEN NULL::vector(512)
              WHEN vector_dims(vector_image)=512 THEN vector_image::vector(512)
              ELSE NULL::vector(512)
            END;
  ELSIF current_type IN ('real[]','double precision[]') THEN
    -- Convert only already-current 512-d arrays. Old 256-d/other vectors become NULL.
    ALTER TABLE gm_product_image_vector
      ALTER COLUMN vector_image TYPE vector(512)
      USING CASE
              WHEN vector_image IS NULL THEN NULL::vector(512)
              WHEN array_length(vector_image,1)=512
                THEN ('[' || array_to_string(vector_image, ',') || ']')::vector(512)
              ELSE NULL::vector(512)
            END;
  ELSE
    -- Unknown historical representation: preserve rows/product_uid, clear only vector value.
    ALTER TABLE gm_product_image_vector
      ALTER COLUMN vector_image TYPE vector(512)
      USING NULL::vector(512);
  END IF;
END $$;

-- Index is intentionally omitted here. Correctness comes first; after all rows are 512-d
-- and production pgvector capabilities are confirmed, an ANN index can be added separately.
