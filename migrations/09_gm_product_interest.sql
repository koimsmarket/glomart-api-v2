-- 09_gm_product_interest.sql
-- Purpose: User-level external product visit/wish tracking.
-- Rule: store only user key + mall_code + pi_ii_vi + wish flag + visit count + last visit time.

CREATE TABLE IF NOT EXISTS gm_product_interest (
  member_id VARCHAR(80),
  guest_key VARCHAR(120),
  mall_code VARCHAR(20) NOT NULL,
  pi_ii_vi VARCHAR(255) NOT NULL,
  is_wish BOOLEAN NOT NULL DEFAULT FALSE,
  visit_count INTEGER NOT NULL DEFAULT 1,
  last_visited_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- V017 existing-table compatibility:
-- If this table already exists without mall_code, add it before indexes.
ALTER TABLE gm_product_interest
  ADD COLUMN IF NOT EXISTS mall_code VARCHAR(20) NOT NULL DEFAULT 'CPKR';

CREATE UNIQUE INDEX IF NOT EXISTS uq_gm_product_interest_member_item
  ON gm_product_interest (member_id, mall_code, pi_ii_vi)
  WHERE member_id IS NOT NULL AND member_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_gm_product_interest_guest_item
  ON gm_product_interest (guest_key, mall_code, pi_ii_vi)
  WHERE guest_key IS NOT NULL AND guest_key <> '';

CREATE INDEX IF NOT EXISTS idx_gm_product_interest_member_visit
  ON gm_product_interest (member_id, last_visited_at DESC);

CREATE INDEX IF NOT EXISTS idx_gm_product_interest_guest_visit
  ON gm_product_interest (guest_key, last_visited_at DESC);

CREATE INDEX IF NOT EXISTS idx_gm_product_interest_wish
  ON gm_product_interest (is_wish, last_visited_at DESC);
