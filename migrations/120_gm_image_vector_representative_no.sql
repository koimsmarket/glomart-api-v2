-- 120_gm_image_vector_representative_no.sql
-- V007 additive-only: representative group serial number. No DROP/DELETE.
ALTER TABLE gm_image_vector_representative_map ADD COLUMN IF NOT EXISTS representative_no BIGINT;
CREATE INDEX IF NOT EXISTS idx_gm_image_vector_rep_map_no ON gm_image_vector_representative_map (representative_no) WHERE representative_no IS NOT NULL;
ALTER TABLE gm_image_vector_representative_stat ADD COLUMN IF NOT EXISTS representative_no BIGINT;
CREATE INDEX IF NOT EXISTS idx_gm_image_vector_rep_stat_no ON gm_image_vector_representative_stat (representative_no, run_no) WHERE representative_no IS NOT NULL;
