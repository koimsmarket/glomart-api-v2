-- 48_gm_basket_remote_delivery.sql
-- Preserve product-level Jeju/island delivery policy through basket and SmartFit flows.
ALTER TABLE gm_basket ADD COLUMN IF NOT EXISTS jeju_delivery_yn TEXT;
ALTER TABLE gm_basket ADD COLUMN IF NOT EXISTS jeju_extra_delivery_fee INTEGER;
ALTER TABLE gm_basket ADD COLUMN IF NOT EXISTS island_delivery_yn TEXT;
ALTER TABLE gm_basket ADD COLUMN IF NOT EXISTS island_extra_delivery_fee INTEGER;
