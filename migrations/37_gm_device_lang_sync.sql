-- 37_gm_device_lang_sync.sql
-- Existing DB safe patch: search log + member device language.
-- BCP-47 original tags are stored as received (for example vi-VN, zh-TW, en-US).

ALTER TABLE IF EXISTS gm_search_log
  ADD COLUMN IF NOT EXISTS device_lang TEXT NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS gm_member
  ADD COLUMN IF NOT EXISTS device_lang TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_gm_search_log_device_lang
  ON gm_search_log (device_lang, search_at DESC);
