-- GM_UI_DICTIONARY_V005
-- Additive runtime usage/template tracking for the existing canonical UI dictionary.
-- No new usage table. No REMOVED automation in V2.

ALTER TABLE gm_ui_dictionary ADD COLUMN IF NOT EXISTS template_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_ui_dictionary ADD COLUMN IF NOT EXISTS source_map JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE gm_ui_dictionary ADD COLUMN IF NOT EXISTS use_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE gm_ui_dictionary ADD COLUMN IF NOT EXISTS glomart_use_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE gm_ui_dictionary ADD COLUMN IF NOT EXISTS guppy_use_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE gm_ui_dictionary ADD COLUMN IF NOT EXISTS first_used_at TIMESTAMPTZ;
ALTER TABLE gm_ui_dictionary ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_gm_ui_dictionary_template_hash
  ON gm_ui_dictionary(template_hash)
  WHERE template_hash <> '';

CREATE INDEX IF NOT EXISTS idx_gm_ui_dictionary_last_used_at
  ON gm_ui_dictionary(last_used_at DESC NULLS LAST);
