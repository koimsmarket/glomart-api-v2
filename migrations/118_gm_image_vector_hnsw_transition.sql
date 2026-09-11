-- GM_IMAGE_VECTOR_HNSW_TRANSITION_V003_SAFE_EXTENSION_CHECK
-- 2026-09-11
-- Additive only. No DROP / TRUNCATE / DELETE.
-- Existing 512D REAL[] vector_image and candidate/background pipeline remain untouched.

BEGIN;

-- NULL = original vector only. Representative builder will assign 1..N per keyword later.
ALTER TABLE gm_product_image_vector
  ADD COLUMN IF NOT EXISTS search_vector_no INTEGER NULL;

COMMIT;

-- pgvector may not be installed by the managed PostgreSQL provider.
-- IMPORTANT: do not execute CREATE EXTENSION when the provider does not advertise it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    BEGIN
      EXECUTE 'CREATE EXTENSION IF NOT EXISTS vector';
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'pgvector is available but CREATE EXTENSION privilege is unavailable; deferred';
      WHEN feature_not_supported THEN
        RAISE NOTICE 'pgvector extension cannot be enabled by this PostgreSQL service; deferred';
    END;
  ELSE
    RAISE NOTICE 'pgvector extension is not installed/available on this PostgreSQL service; HNSW DB index deferred';
  END IF;
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
