-- GM_UI_DICTIONARY_V007_REBUILD_133
-- GM_ALLOW_DESTRUCTIVE_MIGRATION
-- Final runtime metadata policy for gm_ui_dictionary.
-- Keep only: source_map, use_count, last_used_at, has_variable.
-- 130/131/132 files remain untouched; this 133 intentionally reconciles the canonical table.

DROP INDEX IF EXISTS idx_gm_ui_dictionary_source_locator;
DROP INDEX IF EXISTS idx_gm_ui_dictionary_template_hash;

ALTER TABLE gm_ui_dictionary
  DROP COLUMN IF EXISTS source_file,
  DROP COLUMN IF EXISTS source_locator,
  DROP COLUMN IF EXISTS source_type,
  DROP COLUMN IF EXISTS first_seen_at,
  DROP COLUMN IF EXISTS last_seen_at,
  DROP COLUMN IF EXISTS removed_at,
  DROP COLUMN IF EXISTS template_hash,
  DROP COLUMN IF EXISTS glomart_use_count,
  DROP COLUMN IF EXISTS guppy_use_count,
  DROP COLUMN IF EXISTS first_used_at;

ALTER TABLE gm_ui_dictionary
  ADD COLUMN IF NOT EXISTS source_map JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS use_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS has_variable CHAR(1) NOT NULL DEFAULT 'N';

-- Existing rows are classified from the already-supported GM_MATCH_ENGINE slots.
UPDATE gm_ui_dictionary
SET has_variable = CASE WHEN kr ~ '%[dsm]' THEN 'Y' ELSE 'N' END
WHERE has_variable IS DISTINCT FROM CASE WHEN kr ~ '%[dsm]' THEN 'Y' ELSE 'N' END;

ALTER TABLE gm_ui_dictionary
  DROP CONSTRAINT IF EXISTS chk_gm_ui_dictionary_has_variable;
ALTER TABLE gm_ui_dictionary
  ADD CONSTRAINT chk_gm_ui_dictionary_has_variable CHECK (has_variable IN ('Y','N'));

CREATE INDEX IF NOT EXISTS idx_gm_ui_dictionary_last_used_at
  ON gm_ui_dictionary(last_used_at DESC NULLS LAST);
