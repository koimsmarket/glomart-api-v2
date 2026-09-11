-- GM_IMAGE_VECTOR_REPRESENTATIVE_V001
-- 2026-09-11
-- Additive only. Representative relationship + representative statistics + central settings.
-- No DROP / DELETE / TRUNCATE. Existing vector/background/category tables remain untouched.

CREATE TABLE IF NOT EXISTS gm_image_vector_representative_map (
  puid                TEXT PRIMARY KEY,
  representative_puid TEXT,
  similarity          REAL,
  run_no              INTEGER NOT NULL DEFAULT 0 CHECK (run_no >= 0),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gm_iv_rep_map_representative
  ON gm_image_vector_representative_map(representative_puid);
CREATE INDEX IF NOT EXISTS idx_gm_iv_rep_map_run
  ON gm_image_vector_representative_map(run_no);

CREATE TABLE IF NOT EXISTS gm_image_vector_representative_stat (
  representative_puid TEXT NOT NULL,
  run_no              INTEGER NOT NULL CHECK (run_no >= 1),
  member_count        INTEGER NOT NULL DEFAULT 0,
  avg_similarity      REAL,
  min_similarity      REAL,
  max_similarity      REAL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (representative_puid, run_no)
);
CREATE INDEX IF NOT EXISTS idx_gm_iv_rep_stat_run
  ON gm_image_vector_representative_stat(run_no, representative_puid);

INSERT INTO gm_runtime_config
  (config_key,config_value,value_type,category,mode,enabled,description)
VALUES
  ('gm_v3','1','VERSION','VERSION','FIXED',TRUE,'고정 순차/실험용 운영 버전'),
  ('product_margin_rate','12','NUMBER','PRODUCT','FIXED',TRUE,'상품 기본 마진율(%)'),
  ('image_vector_representative_similarity','0.9500','NUMBER','IMAGE_VECTOR','FIXED',TRUE,'대표이미지 기본 유사율 기준(0~1)'),
  ('image_vector_representative_run','1','NUMBER','IMAGE_VECTOR','FIXED',TRUE,'대표이미지 현재 실행 RUN. 0은 카테고리 없음 예약값')
ON CONFLICT (config_key) DO NOTHING;
