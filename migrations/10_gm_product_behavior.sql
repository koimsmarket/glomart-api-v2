-- 10_gm_product_behavior.sql
-- Purpose: Add product behavior counters for interest and order quantity.
-- Safe to run on existing DB. New installations also keep the columns in 01_gm_product.sql.

ALTER TABLE gm_product
  ADD COLUMN IF NOT EXISTS wish_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE gm_product
  ADD COLUMN IF NOT EXISTS last_wish_at TIMESTAMP NULL;

ALTER TABLE gm_product
  ADD COLUMN IF NOT EXISTS order_qty_total INTEGER NOT NULL DEFAULT 0;
