-- GM_CATEGORY_PRODUCT_SEARCH_INDEX_V001
-- Supports routes/search_local.js categoryStage() product scope lookup:
--   string_to_array(COALESCE(glomart_code,''),'|') && $1::text[]
--
-- The index expression is intentionally identical to the production query expression.
-- Only searchable CPKR/ALKR active, non-sold-out rows are indexed because categoryStage()
-- always applies the same predicates. This keeps the GIN index smaller and focused.
-- CONCURRENTLY minimizes blocking while gm_product continues receiving queue upserts.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gm_product_active_glomart_code_array
ON gm_product
USING GIN (string_to_array(COALESCE(glomart_code,''),'|'))
WHERE mall_code IN ('CPKR','ALKR')
  AND COALESCE(sale_status,'active')='active'
  AND COALESCE(soldout_yn,'N')<>'Y';
