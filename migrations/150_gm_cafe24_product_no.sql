-- 150_gm_cafe24_product_no.sql
-- NEW migration based on actual glomart-api-v2_20261124_1425.zip.
-- V001-V006 SQL artifacts are not used as an installation baseline.
-- Purpose: preserve Cafe24 linkage in basket / order items / auto-order items.
-- gm_product: already covered by 901_gm_product_identity_schema_reconcile.sql.
-- gm_smartfit_item: already covered by 47/51 migrations.
-- product_uid and existing source_uid values are not modified.
-- This is schema-only. It does not populate rows or alter API persistence.

-- 02_gm_basket.sql defines neither field in fresh initial schema.
ALTER TABLE public.gm_basket
  ADD COLUMN IF NOT EXISTS source_uid TEXT;
ALTER TABLE public.gm_basket
  ADD COLUMN IF NOT EXISTS cafe24_product_no TEXT;

-- 04_gm_order_item.sql already defines source_uid.
ALTER TABLE public.gm_order_item
  ADD COLUMN IF NOT EXISTS cafe24_product_no TEXT;

-- 101_gm_auto_order.sql already defines source_uid.
ALTER TABLE public.gm_auto_order_item
  ADD COLUMN IF NOT EXISTS cafe24_product_no TEXT;
