-- Manual migration, separate from JS deployment. No destructive SQL.
-- All rounds retained as "1:3|2:0|3:6"; photo file paths are computed, never stored.
ALTER TABLE gm_order ADD COLUMN IF NOT EXISTS return_image_history TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_order ADD COLUMN IF NOT EXISTS exchange_image_history TEXT NOT NULL DEFAULT '';
