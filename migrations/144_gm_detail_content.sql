-- GM_DETAIL_CONTENT_V001: MANUAL EXECUTION ONLY. Never auto-run on production.
-- Existing gm_product / gm_product_option records are not modified.
CREATE TABLE IF NOT EXISTS public.gm_cpkr_detail_content (
  product_id TEXT PRIMARY KEY,
  content_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT gm_cpkr_detail_content_json_object CHECK (jsonb_typeof(content_json) = 'object')
);
CREATE TABLE IF NOT EXISTS public.gm_alkr_detail_content (
  product_id TEXT PRIMARY KEY,
  content_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT gm_alkr_detail_content_json_object CHECK (jsonb_typeof(content_json) = 'object')
);
-- Do not drop or alter gm_product.detail_json in this migration.
