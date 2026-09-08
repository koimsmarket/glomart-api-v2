-- GM_PRODUCT_IMAGE_CANDIDATE_VECTOR_V001
-- Append-only migration.
-- Keep vector_image REAL[] as the exact 512-d source of truth.
-- candidate_vector stores only the compact ANN-candidate representation.
-- No PostgreSQL index is created on BYTEA; the ANN index is a separate runtime/search artifact.

ALTER TABLE gm_product_image_vector
  ADD COLUMN IF NOT EXISTS candidate_vector BYTEA;

COMMENT ON COLUMN gm_product_image_vector.candidate_vector IS
  'GM image search candidate vector: V1 519-byte INT8 payload derived from 512-d vector_image; ANN candidate retrieval only';
