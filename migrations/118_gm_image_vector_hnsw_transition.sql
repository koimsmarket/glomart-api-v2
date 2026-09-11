-- GM_IMAGE_VECTOR_HNSW_TRANSITION_V002_SAFE_ADD_ONLY
-- 2026-09-11
-- IMPORTANT: additive migration only. No DROP / TRUNCATE / DELETE.
-- The obsolete Tree/Leaf schema remains physically present until HNSW is verified.
-- Existing 512D REAL[] vector_image and candidate/background pipeline remain untouched.

BEGIN;

-- NULL = original vector only. Representative builder will assign 1..N per keyword later.
ALTER TABLE gm_product_image_vector
  ADD COLUMN IF NOT EXISTS search_vector_no INTEGER NULL;

COMMIT;

-- pgvector is optional in the current production environment.
-- Attempt extension enablement without breaking DB initialization when unavailable.
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
    BEGIN
      IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'gm_product_image_vector'
           AND column_name = 'search_vector'
      ) THEN
        EXECUTE 'ALTER TABLE gm_product_image_vector ADD COLUMN search_vector vector(512) NULL';
      END IF;
    EXCEPTION
      WHEN undefined_object THEN
        RAISE NOTICE 'pgvector type exists but vector(512) column creation is unavailable; deferred';
    END;

    IF EXISTS (
      SELECT 1
        FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'gm_product_image_vector'
         AND column_name = 'search_vector'
    ) THEN
      BEGIN
        -- Representative-only HNSW. It is empty until the representative Builder populates search_vector.
        EXECUTE 'CREATE INDEX IF NOT EXISTS idx_gm_product_image_vector_search_hnsw '
             || 'ON gm_product_image_vector USING hnsw (search_vector vector_cosine_ops) '
             || 'WHERE search_vector IS NOT NULL';
      EXCEPTION
        WHEN undefined_object OR feature_not_supported THEN
          RAISE NOTICE 'HNSW access method/operator class unavailable; HNSW index creation deferred';
      END;
    END IF;
  ELSE
    RAISE NOTICE 'pgvector type not present; search_vector/HNSW creation deferred';
  END IF;
END $$;
