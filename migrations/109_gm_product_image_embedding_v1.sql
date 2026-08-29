-- GM_PRODUCT_IMAGE_EMBEDDING_V001
-- Replaces legacy 16x16 REAL[] image vectors with one 512-d MobileCLIP embedding.
-- 104_gm_product_image_vector.sql is historical and MUST NOT be edited.
-- Existing legacy vectors are intentionally discarded once when this NEW migration is applied.
-- GM_ALLOW_DESTRUCTIVE_MIGRATION

CREATE EXTENSION IF NOT EXISTS vector;

TRUNCATE TABLE gm_product_image_vector;

ALTER TABLE gm_product_image_vector
  ALTER COLUMN vector_image TYPE halfvec(512)
  USING NULL::halfvec(512);

CREATE INDEX IF NOT EXISTS idx_gm_product_image_vector_hnsw_cosine
  ON gm_product_image_vector
  USING hnsw (vector_image halfvec_cosine_ops);
