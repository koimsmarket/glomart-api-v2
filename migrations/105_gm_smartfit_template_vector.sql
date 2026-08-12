-- GM_SMARTFIT_TEMPLATE_VECTOR_V001
-- Intentionally two columns only.
CREATE TABLE IF NOT EXISTS gm_smartfit_template_vector (
  template_id BIGINT PRIMARY KEY,
  vector_image REAL[] NOT NULL
);
