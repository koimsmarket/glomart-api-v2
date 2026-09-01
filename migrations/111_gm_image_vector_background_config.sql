-- GM_IMAGE_VECTOR_BACKGROUND_CONFIG_V001
-- Append-only migration. Background image-vector operating mode is persisted here.
CREATE TABLE IF NOT EXISTS gm_image_vector_background_config (
  config_id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (config_id = 1),
  mode TEXT NOT NULL DEFAULT 'AUTO' CHECK (mode IN ('OFF','AUTO','ON')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO gm_image_vector_background_config(config_id,mode)
VALUES(1,'AUTO')
ON CONFLICT(config_id) DO NOTHING;
