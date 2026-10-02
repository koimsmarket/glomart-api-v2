-- GM_UI_DICTIONARY_V003
-- Canonical dictionary lifecycle + mixed discovery (STATIC + RUNTIME).
-- Existing 25-language rows remain intact.

ALTER TABLE gm_ui_dictionary ADD COLUMN IF NOT EXISTS source_file TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_ui_dictionary ADD COLUMN IF NOT EXISTS source_locator TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_ui_dictionary ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE gm_ui_dictionary ADD COLUMN IF NOT EXISTS active_yn CHAR(1) NOT NULL DEFAULT 'Y';
ALTER TABLE gm_ui_dictionary ADD COLUMN IF NOT EXISTS translation_status TEXT NOT NULL DEFAULT 'READY';
ALTER TABLE gm_ui_dictionary ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ;
ALTER TABLE gm_ui_dictionary ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE gm_ui_dictionary ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_gm_ui_dictionary_active ON gm_ui_dictionary(active_yn, gm_code);
CREATE INDEX IF NOT EXISTS idx_gm_ui_dictionary_source_locator ON gm_ui_dictionary(source_locator) WHERE source_locator <> '';

CREATE TABLE IF NOT EXISTS gm_ui_dictionary_pending (
  pending_id BIGSERIAL PRIMARY KEY,
  gm_code VARCHAR(30),
  source_text_ko TEXT NOT NULL,
  previous_text_ko TEXT NOT NULL DEFAULT '',
  page_name TEXT NOT NULL DEFAULT '',
  source_file TEXT NOT NULL DEFAULT '',
  source_locator TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL CHECK (source_type IN ('STATIC','RUNTIME')),
  change_type TEXT NOT NULL CHECK (change_type IN ('NEW','CHANGED','REMOVED')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','IGNORED')),
  seen_count INTEGER NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  review_note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_gm_ui_dictionary_pending_status ON gm_ui_dictionary_pending(status, change_type, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_ui_dictionary_pending_code ON gm_ui_dictionary_pending(gm_code) WHERE gm_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gm_ui_dictionary_pending_locator ON gm_ui_dictionary_pending(source_locator) WHERE source_locator <> '';

CREATE TABLE IF NOT EXISTS gm_ui_dictionary_history (
  history_id BIGSERIAL PRIMARY KEY,
  gm_code VARCHAR(30) NOT NULL,
  old_kr TEXT NOT NULL DEFAULT '',
  new_kr TEXT NOT NULL DEFAULT '',
  change_type TEXT NOT NULL,
  source_file TEXT NOT NULL DEFAULT '',
  source_locator TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT '',
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gm_ui_dictionary_history_code ON gm_ui_dictionary_history(gm_code, changed_at DESC);
