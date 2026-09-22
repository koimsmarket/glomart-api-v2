-- GM_CATEGORY_MENU_LOOKUP_INDEX_V001
-- Supports /api/gm/category/menu direct-child lookup:
--   WHERE COALESCE(display_yn,'Y')='Y'
--     AND depth = $1
--     AND gm_code LIKE 'PREFIX-%'
-- Existing gm_parent_code indexes are not used by this route.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gm_category_menu_depth_code
ON gm_category (depth, gm_code text_pattern_ops)
WHERE COALESCE(display_yn,'Y')='Y';
