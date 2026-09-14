-- GM_IMAGE_VECTOR_MEMORY_MODE_V003
-- One-time generalization of the deep-switch table.
-- Future config_id values (3,4,...) can be inserted without another schema migration.
-- Existing config_id=1 remains the image-vector worker mode (OFF/AUTO/ON).
-- config_id=2 is representative HNSW memory mode (LOADING/UNLOADING).

ALTER TABLE IF EXISTS gm_image_vector_background_config
  DROP CONSTRAINT IF EXISTS gm_image_vector_background_config_config_id_check;

ALTER TABLE IF EXISTS gm_image_vector_background_config
  DROP CONSTRAINT IF EXISTS gm_image_vector_background_config_mode_check;

INSERT INTO gm_image_vector_background_config(config_id,mode,updated_at)
VALUES(2,'UNLOADING',now())
ON CONFLICT(config_id) DO NOTHING;
