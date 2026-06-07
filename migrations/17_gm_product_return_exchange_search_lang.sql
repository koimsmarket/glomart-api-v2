-- 17_gm_product_return_exchange_search_lang.sql
-- Purpose: add product return/exchange policy columns and separate ui/keyword language tracking for search logs.

ALTER TABLE IF EXISTS gm_product
  ADD COLUMN IF NOT EXISTS return_available_yn TEXT NOT NULL DEFAULT 'Y',
  ADD COLUMN IF NOT EXISTS exchange_available_yn TEXT NOT NULL DEFAULT 'Y',
  ADD COLUMN IF NOT EXISTS return_policy_text TEXT,
  ADD COLUMN IF NOT EXISTS exchange_policy_text TEXT,
  ADD COLUMN IF NOT EXISTS return_shipping_fee INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exchange_shipping_fee INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS return_period_days INTEGER,
  ADD COLUMN IF NOT EXISTS exchange_period_days INTEGER,
  ADD COLUMN IF NOT EXISTS return_address TEXT,
  ADD COLUMN IF NOT EXISTS exchange_address TEXT,
  ADD COLUMN IF NOT EXISTS return_contact TEXT,
  ADD COLUMN IF NOT EXISTS exchange_contact TEXT;

ALTER TABLE IF EXISTS gm_product_archive
  ADD COLUMN IF NOT EXISTS return_available_yn TEXT NOT NULL DEFAULT 'Y',
  ADD COLUMN IF NOT EXISTS exchange_available_yn TEXT NOT NULL DEFAULT 'Y',
  ADD COLUMN IF NOT EXISTS return_policy_text TEXT,
  ADD COLUMN IF NOT EXISTS exchange_policy_text TEXT,
  ADD COLUMN IF NOT EXISTS return_shipping_fee INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exchange_shipping_fee INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS return_period_days INTEGER,
  ADD COLUMN IF NOT EXISTS exchange_period_days INTEGER,
  ADD COLUMN IF NOT EXISTS return_address TEXT,
  ADD COLUMN IF NOT EXISTS exchange_address TEXT,
  ADD COLUMN IF NOT EXISTS return_contact TEXT,
  ADD COLUMN IF NOT EXISTS exchange_contact TEXT;

ALTER TABLE IF EXISTS gm_search_log
  ADD COLUMN IF NOT EXISTS ui_lang_code TEXT,
  ADD COLUMN IF NOT EXISTS keyword_lang_code TEXT;

CREATE INDEX IF NOT EXISTS idx_gm_search_log_ui_keyword_lang
  ON gm_search_log (ui_lang_code, keyword_lang_code, country_code, search_at DESC);
