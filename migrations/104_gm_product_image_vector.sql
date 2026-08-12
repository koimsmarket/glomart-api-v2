-- GM_PRODUCT_IMAGE_VECTOR_V001
-- Intentionally two columns only, keyed 1:1 to gm_product.product_uid.
CREATE TABLE IF NOT EXISTS gm_product_image_vector (
  product_uid TEXT PRIMARY KEY,
  vector_image REAL[] NOT NULL
);
