-- GM_PRODUCT_IMAGE_EMBEDDING_V001
-- Replaces legacy 16x16 REAL[] image vectors with one 512-d MobileCLIP embedding.
-- 104_gm_product_image_vector.sql is historical and MUST NOT be edited.
-- Existing rows/product_uid are preserved. Only the legacy vector values are cleared
-- while the existing vector_image column is converted to halfvec(512).

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE gm_product_image_vector
  ALTER COLUMN vector_image DROP NOT NULL;

ALTER TABLE gm_product_image_vector
  ALTER COLUMN vector_image TYPE halfvec(512)
  USING NULL::halfvec(512);

CREATE INDEX IF NOT EXISTS idx_gm_product_image_vector_hnsw_cosine
  ON gm_product_image_vector
  USING hnsw (vector_image halfvec_cosine_ops);
