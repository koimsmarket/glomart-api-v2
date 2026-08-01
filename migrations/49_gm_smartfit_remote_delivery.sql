-- SmartFit 상품별 제주/도서산간 배송정책 보존
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS jeju_delivery_yn TEXT;
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS jeju_extra_delivery_fee INTEGER;
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS island_delivery_yn TEXT;
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS island_extra_delivery_fee INTEGER;
