-- GM_SEARCH_INDEX_V001
-- CPKR/ALKR 및 향후 mall 공용 category_keyword 보완 검색 인덱스.
-- keyword 정확 검색 부족분을 category_keyword로 보완할 때 같은 mall_code 필터를 사용한다.
-- CONCURRENTLY: 운영 중 gm_product 쓰기 차단을 최소화한다.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gm_product_mall_category_keyword
ON gm_product (mall_code, category_keyword);
