-- GM SmartFit final confirmed structure V004
-- Confirmed: 2026-07-16
-- Raw media/event tables are retired. Images use deterministic R2 paths.
-- Settlement uses purchase-confirmed timestamps from external/internal sale rows.

-- 1) Retire unused raw tables.
DROP TABLE IF EXISTS gm_smartfit_media;
DROP TABLE IF EXISTS gm_smartfit_event;

-- 2) Template: category/search aggregation and sales summaries.
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS gm_code TEXT;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS cp_code TEXT;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS search_source TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS keyword_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS image_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS link01 TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS link02 TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS link03 TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS link04 TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS link05 TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS link06 TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS item_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS purchase_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS sales_item_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS sales_amount NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS incentive_sales_item_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS incentive_sales_amount NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS creator_incentive_amount NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS ranking_score NUMERIC(18,6) NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_template ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP;

-- 3) Space deterministic image/link metadata.
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS image_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS link01 TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS link02 TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS link03 TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS link04 TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS link05 TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_space ADD COLUMN IF NOT EXISTS link06 TEXT NOT NULL DEFAULT '';

-- 4) Template items: option-independent creator purchase qualification.
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS product_id VARCHAR(120) NOT NULL DEFAULT '';
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS add_source VARCHAR(20) NOT NULL DEFAULT 'BASKET';
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS creator_purchase_confirmed_yn CHAR(1) NOT NULL DEFAULT 'N';
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS creator_purchase_confirmed_at TIMESTAMP;
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS creator_purchase_order_no VARCHAR(80);
ALTER TABLE gm_smartfit_item ADD COLUMN IF NOT EXISTS creator_purchase_order_item_id BIGINT;
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_item_product_id
  ON gm_smartfit_item (mall_code, product_id);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_item_creator_purchase
  ON gm_smartfit_item (creator_purchase_confirmed_yn, template_id);

-- 5) Comments: R2 slots support 10; current API/UI limit is 3.
ALTER TABLE gm_smartfit_comment ADD COLUMN IF NOT EXISTS image_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gm_smartfit_comment ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP;
ALTER TABLE gm_smartfit_comment DROP CONSTRAINT IF EXISTS chk_gm_smartfit_comment_image_count;
ALTER TABLE gm_smartfit_comment ADD CONSTRAINT chk_gm_smartfit_comment_image_count
  CHECK (image_count BETWEEN 0 AND 10);

-- 6) Product-level SmartFit supplier incentive policy.
ALTER TABLE gm_product ADD COLUMN IF NOT EXISTS smartfit_template_count BIGINT NOT NULL DEFAULT 0;
ALTER TABLE gm_product ADD COLUMN IF NOT EXISTS smartfit_incentive_yn CHAR(1) NOT NULL DEFAULT 'N';
ALTER TABLE gm_product ADD COLUMN IF NOT EXISTS smartfit_incentive_rate NUMERIC(8,4) NOT NULL DEFAULT 0;
ALTER TABLE gm_product DROP CONSTRAINT IF EXISTS chk_gm_product_smartfit_incentive_rate;
ALTER TABLE gm_product ADD CONSTRAINT chk_gm_product_smartfit_incentive_rate
  CHECK (smartfit_incentive_rate >= 0 AND smartfit_incentive_rate <= 100);

-- 7) External order summary and per-order-item SmartFit attribution snapshot.
ALTER TABLE gm_order ADD COLUMN IF NOT EXISTS smartfit_yn CHAR(1) NOT NULL DEFAULT 'N';
ALTER TABLE gm_order ADD COLUMN IF NOT EXISTS smartfit_item_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS smartfit_template_id BIGINT;
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS smartfit_creator_member_id VARCHAR(80);
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS smartfit_creator_purchase_yn CHAR(1);
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS smartfit_incentive_yn CHAR(1);
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS smartfit_incentive_rate NUMERIC(8,4);
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS smartfit_sales_amount NUMERIC(18,2);
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS smartfit_incentive_amount NUMERIC(18,2);
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS smartfit_incentive_status VARCHAR(20);
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS smartfit_confirmed_at TIMESTAMP;
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS smartfit_cancelled_at TIMESTAMP;
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS smartfit_paid_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_gm_order_item_smartfit_template
  ON gm_order_item (smartfit_template_id, smartfit_confirmed_at);
CREATE INDEX IF NOT EXISTS idx_gm_order_item_smartfit_creator
  ON gm_order_item (smartfit_creator_member_id, smartfit_incentive_status, smartfit_confirmed_at);

-- 8) Cafe24 internal-product SmartFit sales are stored separately.
CREATE TABLE IF NOT EXISTS gm_smartfit_internal_sale (
  sale_id BIGSERIAL PRIMARY KEY,
  order_no VARCHAR(80) NOT NULL,
  order_item_no VARCHAR(120) NOT NULL,
  member_id VARCHAR(80),
  mall_code VARCHAR(20) NOT NULL DEFAULT 'CAFE24',
  product_id VARCHAR(120) NOT NULL,
  product_uid VARCHAR(160),
  template_id BIGINT NOT NULL,
  creator_member_id VARCHAR(80) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  sales_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  creator_purchase_yn CHAR(1) NOT NULL DEFAULT 'N',
  incentive_yn CHAR(1) NOT NULL DEFAULT 'N',
  incentive_rate NUMERIC(8,4) NOT NULL DEFAULT 0,
  incentive_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  order_status VARCHAR(30),
  incentive_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  ordered_at TIMESTAMP,
  confirmed_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  paid_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_gm_smartfit_internal_sale_order_item_template
    UNIQUE (order_no, order_item_no, template_id),
  CONSTRAINT chk_gm_smartfit_internal_sale_rate
    CHECK (incentive_rate >= 0 AND incentive_rate <= 100)
);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_internal_sale_confirmed
  ON gm_smartfit_internal_sale (confirmed_at, incentive_status);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_internal_sale_creator
  ON gm_smartfit_internal_sale (creator_member_id, incentive_status, confirmed_at);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_internal_sale_template
  ON gm_smartfit_internal_sale (template_id, confirmed_at);
