-- GM_RUNTIME_CONFIG_V003
-- Central operational configuration. One setting = one row.
-- No fixed-column ceiling: new operational switches/values are added as rows.

CREATE TABLE IF NOT EXISTS gm_runtime_config (
  config_key      VARCHAR(120) PRIMARY KEY,
  config_value    TEXT NOT NULL DEFAULT '',
  value_type      VARCHAR(20) NOT NULL DEFAULT 'STRING',
  category        VARCHAR(40) NOT NULL DEFAULT 'SYSTEM',
  mode            VARCHAR(20) NOT NULL DEFAULT 'FIXED',
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  description     TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gm_runtime_config_type_chk
    CHECK (value_type IN ('STRING','NUMBER','BOOLEAN','VERSION','JSON'))
);

CREATE INDEX IF NOT EXISTS idx_gm_runtime_config_category
  ON gm_runtime_config(category, config_key);

INSERT INTO gm_runtime_config
  (config_key, config_value, value_type, category, mode, enabled, description)
VALUES
  ('gm_v1', 'AUTO_1MIN', 'VERSION', 'VERSION', 'AUTO', TRUE,
   '기존 1분 동적 버전. Builder에서 직접 변경하지 않음'),
  ('gm_v2', '1', 'VERSION', 'VERSION', 'FIXED', TRUE,
   '고정 순차 버전. Builder +1 버튼으로 1,2,3... 증가'),
  ('device_lang_enabled', '1', 'BOOLEAN', 'LANGUAGE', 'FIXED', TRUE,
   'DEVICE_LANG 및 승인 확장 언어팩 기능'),
  ('device_lang_pack_version', '1', 'VERSION', 'LANGUAGE', 'FIXED', TRUE,
   'DEVICE_LANG 공통 배포 버전'),
  ('device_lang_background_mode', 'AUTO', 'STRING', 'LANGUAGE', 'AUTO', TRUE,
   '신규 DEVICE_LANG UI 사전 생성: OFF/AUTO/ON'),
  ('device_lang_auto_start', '00:00', 'STRING', 'LANGUAGE', 'AUTO', TRUE,
   'AUTO 생성 시작시간 KST'),
  ('device_lang_auto_end', '08:00', 'STRING', 'LANGUAGE', 'AUTO', TRUE,
   'AUTO 생성 종료시간 KST'),
  ('device_lang_memory_start_pct', '70', 'NUMBER', 'LANGUAGE', 'AUTO', TRUE,
   'AUTO 생성 시작 허용 메모리 사용률 상한'),
  ('device_lang_memory_stop_pct', '80', 'NUMBER', 'LANGUAGE', 'AUTO', TRUE,
   '생성 중단 메모리 사용률 상한')
ON CONFLICT (config_key) DO NOTHING;
