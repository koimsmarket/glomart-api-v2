-- GM SmartFit personal collection delta V001
-- Only user changes are stored. Original template items remain immutable after collection.

CREATE TABLE IF NOT EXISTS gm_smartfit_collection_item_delta (
  delta_id BIGSERIAL PRIMARY KEY,
  member_id VARCHAR(80) NOT NULL,
  template_id BIGINT NOT NULL,
  source_item_id BIGINT,
  action_type VARCHAR(20) NOT NULL,
  source_product_id VARCHAR(120) NOT NULL DEFAULT '',
  mall_code VARCHAR(20) NOT NULL DEFAULT '',
  product_id VARCHAR(120) NOT NULL DEFAULT '',
  product_uid VARCHAR(160) NOT NULL DEFAULT '',
  qty INTEGER NOT NULL DEFAULT 1,
  default_checked CHAR(1) NOT NULL DEFAULT 'T',
  sort_no INTEGER NOT NULL DEFAULT 0,
  is_active CHAR(1) NOT NULL DEFAULT 'T',
  is_deleted CHAR(1) NOT NULL DEFAULT 'F',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_gm_smartfit_collection_delta_action
    CHECK (action_type IN ('EXCLUDE','REPLACE','ADD')),
  CONSTRAINT chk_gm_smartfit_collection_delta_qty
    CHECK (qty > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_gm_smartfit_collection_delta_source
  ON gm_smartfit_collection_item_delta (member_id, template_id, source_item_id)
  WHERE source_item_id IS NOT NULL AND is_deleted='F';
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_collection_delta_member_template
  ON gm_smartfit_collection_item_delta (member_id, template_id, is_deleted, action_type);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_collection_delta_product
  ON gm_smartfit_collection_item_delta (mall_code, product_id, product_uid);

-- The original creator keeps incentive attribution when product_id is unchanged,
-- even if the collected user selects a different product_uid (option).
