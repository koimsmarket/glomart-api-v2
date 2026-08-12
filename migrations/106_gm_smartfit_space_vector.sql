-- GM_SMARTFIT_SPACE_VECTOR_V001
-- Intentionally two columns only. Reserved now for future Space/channel image search.
CREATE TABLE IF NOT EXISTS gm_smartfit_space_vector (
  space_id BIGINT PRIMARY KEY,
  vector_image REAL[] NOT NULL
);
