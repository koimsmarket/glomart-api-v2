-- 08_gm_basket_required_fields.sql
-- Purpose: apply required gm_basket fields to an already-created table.
-- Safe: only ADD COLUMN IF NOT EXISTS. No DROP/TRUNCATE/DELETE.

ALTER TABLE gm_basket ADD COLUMN IF NOT EXISTS mall_code TEXT NOT NULL DEFAULT 'CPKR';
ALTER TABLE gm_basket ADD COLUMN IF NOT EXISTS product_url TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_basket ADD COLUMN IF NOT EXISTS thumb_url TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_gm_basket_mall_pi
  ON gm_basket (mall_code, pi_ii_vi);

CREATE UNIQUE INDEX IF NOT EXISTS uq_gm_basket_owner_item
  ON gm_basket (mall_code, pi_ii_vi, COALESCE(member_id, ''), COALESCE(guest_key, ''));
