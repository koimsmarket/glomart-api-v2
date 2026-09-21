-- GM_SEARCH_INDEX_V001
-- CPKR/ALKR 및 향후 mall 공용 정확 키워드 검색 인덱스.
-- 현재 운영 검색은 CPKR만 사용하되, mall_code 필터로 같은 인덱스를 재사용한다.
-- CONCURRENTLY: 운영 중 gm_product 쓰기 차단을 최소화한다.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gm_product_mall_keyword
ON gm_product (mall_code, keyword);
