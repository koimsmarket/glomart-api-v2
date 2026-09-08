-- 115_gm_order_tax_amount.sql
-- Add tax classification / supply amount / VAT amount to order and auto-order snapshots.
-- SAFE ONLY: existing tables/data are preserved. No DROP/TRUNCATE/DELETE.

BEGIN;

-- Glomart sales order header: total supply amount / VAT amount.
ALTER TABLE gm_order
  ADD COLUMN IF NOT EXISTS supply_amount INTEGER,
  ADD COLUMN IF NOT EXISTS vat_amount INTEGER;

-- Glomart sales order item: per-item tax classification / supply amount / VAT amount.
ALTER TABLE gm_order_item
  ADD COLUMN IF NOT EXISTS tax_type TEXT,
  ADD COLUMN IF NOT EXISTS supply_amount INTEGER,
  ADD COLUMN IF NOT EXISTS vat_amount INTEGER;

-- External purchase(auto-order) header: total supply amount / VAT amount.
-- Keep the amount type aligned with the existing gm_auto_order monetary columns.
ALTER TABLE gm_auto_order
  ADD COLUMN IF NOT EXISTS supply_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(14,2);

-- External purchase(auto-order) item: per-item tax classification / supply amount / VAT amount.
ALTER TABLE gm_auto_order_item
  ADD COLUMN IF NOT EXISTS tax_type TEXT,
  ADD COLUMN IF NOT EXISTS supply_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(14,2);

COMMIT;
