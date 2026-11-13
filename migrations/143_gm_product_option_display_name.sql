-- GM_PRODUCT_OPTION_DISPLAY_V003 | additive, repeatable schema migration.
-- This file MUST be included in recovered server archives alongside
-- migrations/01_gm_product.sql and migrations/29_gm_product_option.sql.
-- Live/production execution: ADMINISTRATOR-MANUAL ONLY.
-- This migration never rewrites option_name, option_count, or existing records.
BEGIN;
ALTER TABLE public.gm_product_option ADD COLUMN IF NOT EXISTS option_display_name TEXT;
ALTER TABLE public.gm_product ADD COLUMN IF NOT EXISTS option_count_verified_at TIMESTAMPTZ;

-- Stable deterministic parsing fallback for full search sales titles.
-- Does not infer a boundary from incomplete options of the same PID.
CREATE OR REPLACE FUNCTION public.gm_option_display_from_title(
  p_product_name TEXT, p_option_name TEXT
) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE base TEXT; raw TEXT;
BEGIN
  raw := btrim(COALESCE(p_option_name,''));
  IF raw='' THEN RETURN raw; END IF;
  base := btrim(split_part(COALESCE(p_product_name,''), ',', 1));
  IF base<>'' AND left(raw,length(base)+1)=base||',' THEN
    RETURN COALESCE(NULLIF(btrim(substr(raw,length(base)+2),' ,'),''),raw);
  END IF;
  RETURN raw;
END;
$$;
COMMIT;
