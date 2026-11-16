-- GM_SEARCH_URL_UPSERT_V006: existing option UPSERT stores the original search URL.
-- Manually apply only; never auto-run.
ALTER TABLE public.gm_product_option
  ADD COLUMN IF NOT EXISTS product_url TEXT NOT NULL DEFAULT '';
