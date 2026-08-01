-- 02_gm_basket.sql
-- Purpose: Glomart external product basket.
-- Rule: gm_basket stores mall_code + pi_ii_vi separately. product_uid is not stored.

CREATE TABLE IF NOT EXISTS gm_basket (
  mall_code TEXT NOT NULL DEFAULT 'CPKR',
  member_id TEXT,
  guest_key TEXT,
  pi_ii_vi TEXT NOT NULL,
  product_name TEXT NOT NULL,
  option_name TEXT,
  option_value TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  amount INTEGER NOT NULL DEFAULT 0,
  amount_type TEXT DEFAULT 'unit',
  delivery_type TEXT,
  delivery_fee INTEGER DEFAULT 0,
  jeju_delivery_yn TEXT,
  jeju_extra_delivery_fee INTEGER,
  island_delivery_yn TEXT,
  island_extra_delivery_fee INTEGER,
  product_url TEXT NOT NULL,
  thumb_url TEXT NOT NULL,
  thumb_file_name TEXT,
  added_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- V017 existing-table compatibility:
-- If gm_basket already exists from an older version, CREATE TABLE IF NOT EXISTS
-- does not add mall_code. Add it before indexes that reference mall_code.
ALTER TABLE gm_basket
  ADD COLUMN IF NOT EXISTS mall_code TEXT NOT NULL DEFAULT 'CPKR';

CREATE INDEX IF NOT EXISTS idx_gm_basket_member_id
  ON gm_basket (member_id);

CREATE INDEX IF NOT EXISTS idx_gm_basket_guest_key
  ON gm_basket (guest_key);

CREATE INDEX IF NOT EXISTS idx_gm_basket_pi_ii_vi
  ON gm_basket (pi_ii_vi);

CREATE INDEX IF NOT EXISTS idx_gm_basket_mall_pi
  ON gm_basket (mall_code, pi_ii_vi);

CREATE UNIQUE INDEX IF NOT EXISTS uq_gm_basket_owner_item
  ON gm_basket (mall_code, pi_ii_vi, COALESCE(member_id, ''), COALESCE(guest_key, ''));
