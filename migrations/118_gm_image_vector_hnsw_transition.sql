-- GM_IMAGE_VECTOR_HNSW_TRANSITION_V001
-- 2026-09-11
-- Retire ONLY the obsolete image-vector classification Tree/Leaf schema.
-- Preserve the 512D REAL[] source vector and the existing background/candidate-vector pipeline.

BEGIN;

-- 1) New representative marker. NULL = original vector only.
ALTER TABLE gm_product_image_vector
  ADD COLUMN IF NOT EXISTS search_vector_no INTEGER NULL;

-- 2) Remove ONLY columns introduced by migration 117 for the retired Tree/Leaf classifier.
ALTER TABLE gm_product_image_vector
  DROP CONSTRAINT IF EXISTS fk_gm_product_image_vector_class;

DROP INDEX IF EXISTS idx_gm_product_image_vector_class_id;
DROP INDEX IF EXISTS idx_gm_product_image_vector_category_group;

ALTER TABLE gm_product_image_vector
  DROP COLUMN IF EXISTS class_id,
  DROP COLUMN IF EXISTS category_group;

-- 3) Remove ONLY the retired visual-classification tables.
DROP TABLE IF EXISTS gm_vector_class_stage;
DROP TABLE IF EXISTS gm_vector_category_stage;
DROP TABLE IF EXISTS gm_vector_category CASCADE;

COMMIT;

-- 4) pgvector/HNSW layer is optional at this migration step because the current
-- production environment previously did not provide the vector extension.
-- Try to enable it without making the schema cleanup fail when unavailable.
DO $$
BEGIN
  BEGIN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS vector';
  EXCEPTION
    WHEN insufficient_privilege OR undefined_file THEN
      RAISE NOTICE 'pgvector extension unavailable; search_vector/HNSW creation deferred';
  END;
END $$;

DO $$
BEGIN
  IF to_regtype('vector') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
        FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'gm_product_image_vector'
         AND column_name = 'search_vector'
    ) THEN
      EXECUTE 'ALTER TABLE gm_product_image_vector ADD COLUMN search_vector vector(512) NULL';
    END IF;

    -- HNSW contains representative rows only. search_vector is populated later
    -- by the representative Builder; original vector_image REAL[] remains untouched.
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_gm_product_image_vector_search_hnsw '
         || 'ON gm_product_image_vector USING hnsw (search_vector vector_cosine_ops) '
         || 'WHERE search_vector IS NOT NULL';
  ELSE
    RAISE NOTICE 'pgvector type not present; search_vector/HNSW creation deferred';
  END IF;
END $$;
