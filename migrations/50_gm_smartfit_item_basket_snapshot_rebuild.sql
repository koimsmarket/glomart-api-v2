-- 50_gm_smartfit_item_basket_snapshot_rebuild.sql
-- GM_ALLOW_DESTRUCTIVE_MIGRATION
-- Development-only one-time rebuild.
-- Scope: gm_smartfit_item only. Space/template/collection tables are not touched.
-- Existing SmartFit item rows are intentionally discarded and must be imported again from basket.

DROP TABLE IF EXISTS gm_smartfit_item;

CREATE TABLE gm_smartfit_item (
  template_id BIGINT NOT NULL REFERENCES gm_smartfit_template(template_id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL CHECK (item_id > 0),
  item_role SMALLINT NULL CHECK (item_role IS NULL OR item_role > 0),

  member_id TEXT NOT NULL DEFAULT '',
  mall_code TEXT NOT NULL DEFAULT 'CPKR',
  pi_ii_vi TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  option_name TEXT,
  option_value TEXT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  amount_type TEXT NOT NULL DEFAULT 'unit',
  delivery_type TEXT,
  delivery_fee INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  product_url TEXT NOT NULL DEFAULT '',
  thumb_url TEXT NOT NULL DEFAULT '',
  thumb_file_name TEXT,
  source_mall TEXT,
  source_uid TEXT,
  internal_product_code TEXT,
  cafe24_product_no TEXT,
  gm_internal_link INTEGER NOT NULL DEFAULT 0,
  cart_item_key TEXT,
  jeju_delivery_yn TEXT,
  jeju_extra_delivery_fee INTEGER,
  island_delivery_yn TEXT,
  island_extra_delivery_fee INTEGER,

  PRIMARY KEY (template_id, item_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_gm_smartfit_item_template_product_v50
  ON gm_smartfit_item (template_id, mall_code, pi_ii_vi);

CREATE UNIQUE INDEX IF NOT EXISTS uq_gm_smartfit_item_template_role_v50
  ON gm_smartfit_item (template_id, item_role)
  WHERE item_role IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gm_smartfit_item_member_v50
  ON gm_smartfit_item (member_id);

CREATE INDEX IF NOT EXISTS idx_gm_smartfit_item_cart_key_v50
  ON gm_smartfit_item (cart_item_key)
  WHERE COALESCE(cart_item_key,'') <> '';

CREATE INDEX IF NOT EXISTS idx_gm_smartfit_item_cafe24_v50
  ON gm_smartfit_item (cafe24_product_no)
  WHERE COALESCE(cafe24_product_no,'') <> '';

COMMENT ON COLUMN gm_smartfit_item.item_id IS 'Template-local item order: 1,2,3...';
COMMENT ON COLUMN gm_smartfit_item.item_role IS 'NULL=unassigned, 1=primary, 2=secondary, 3+=role priority';
