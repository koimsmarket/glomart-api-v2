-- 36_gm_device_lang.sql
-- Device language and search translation trace. Safe to run repeatedly.

ALTER TABLE gm_member
  ADD COLUMN IF NOT EXISTS device_lang VARCHAR(35);

COMMENT ON COLUMN gm_member.device_lang IS
  'Android BCP-47 phone locale tag. Updated only with a valid nonblank value; examples ko-KR, vi-VN, zh-TW.';

ALTER TABLE gm_search_log
  ADD COLUMN IF NOT EXISTS device_lang VARCHAR(35),
  ADD COLUMN IF NOT EXISTS translation_source VARCHAR(30);

COMMENT ON COLUMN gm_search_log.device_lang IS
  'Phone locale tag at search time. May differ from UI gm_lang.';
COMMENT ON COLUMN gm_search_log.translation_source IS
  'Search keyword source path: INPUT, GM_LANG, DEVICE_LANG, SERVER_MATCH, COUPANG_MATCH, INPUT_FALLBACK.';

CREATE INDEX IF NOT EXISTS idx_gm_search_log_device_lang
  ON gm_search_log(device_lang, search_at DESC);
