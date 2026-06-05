-- 10_gm_product_behavior_columns.sql
-- Purpose: Add product behavior counters needed for search/wish/order analytics.
-- Notes: order_amount_total and unique_user_count are intentionally excluded.

ALTER TABLE gm_product ADD COLUMN IF NOT EXISTS wish_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gm_product ADD COLUMN IF NOT EXISTS last_wish_at TIMESTAMP;
ALTER TABLE gm_product ADD COLUMN IF NOT EXISTS order_qty_total INTEGER NOT NULL DEFAULT 0;
