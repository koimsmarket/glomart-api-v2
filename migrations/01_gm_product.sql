-- 01_gm_product.sql
-- 운영 안전 스키마: DROP 금지. CREATE/ALTER IF NOT EXISTS만 사용.
-- V027: cp_id/cp_code 대신 cp_selected_code/cp_fix_code 적용. cp_match는 T 보호/F 전파 기준.

CREATE TABLE IF NOT EXISTS gm_product (
  product_uid TEXT NOT NULL,
  glomart_code TEXT NOT NULL DEFAULT '',
  gm_category TEXT NOT NULL DEFAULT '',
  category_keyword TEXT,
  keyword TEXT,
  mall_code TEXT NOT NULL,
  source_mall TEXT,
  source_uid TEXT,
  mall_category TEXT,
  mall_category_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  cp_selected_code TEXT,
  cp_fix_code TEXT,
  cp_match TEXT NOT NULL DEFAULT 'F',
  product_id TEXT NOT NULL,
  item_id TEXT,
  vendor_item_id TEXT NOT NULL,
  pi_ii_vi TEXT,
  internal_product_code TEXT,
  product_name TEXT NOT NULL,
  mall_product_name TEXT,
  option_count INTEGER NOT NULL DEFAULT 0,
  option_json JSONB NOT NULL DEFAULT '{"iid_vid":""}'::jsonb,
  thumb_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  seasonal_text TEXT,
  mall_sale_price INTEGER NOT NULL DEFAULT 0,
  final_supply_price INTEGER,
  normal_price INTEGER,
  discount_price INTEGER,
  delivery_fee INTEGER,
  delivery_eta_text TEXT,
  delivery_type TEXT,
  jeju_delivery_yn TEXT NOT NULL DEFAULT 'F',
  jeju_extra_delivery_fee INTEGER NOT NULL DEFAULT 0,
  island_delivery_yn TEXT NOT NULL DEFAULT 'F',
  island_extra_delivery_fee INTEGER NOT NULL DEFAULT 0,
  tax_type TEXT,
  overseas_direct_yn TEXT NOT NULL DEFAULT 'N',
  review_count INTEGER,
  mall_sales_count TEXT,
  certification_no_1 TEXT,
  certification_no_2 TEXT,
  supplier_id TEXT,
  supplier_name TEXT,
  business_number TEXT,
  online_sales_number TEXT,
  ceo_name TEXT,
  supplier_mobile TEXT,
  supplier_phone TEXT,
  supplier_email TEXT,
  supplier_address TEXT,
  product_url TEXT NOT NULL DEFAULT '',
  thumb_origin_url TEXT,
  soldout_yn TEXT NOT NULL DEFAULT 'N',
  hit_count INTEGER NOT NULL DEFAULT 0,
  detail_view_count INTEGER NOT NULL DEFAULT 0,
  cart_count INTEGER NOT NULL DEFAULT 0,
  wish_count INTEGER NOT NULL DEFAULT 0,
  order_count INTEGER NOT NULL DEFAULT 0,
  order_qty_total INTEGER NOT NULL DEFAULT 0,
  product_grade TEXT,
  smartfit_template_count BIGINT NOT NULL DEFAULT 0,
  last_seen_at TIMESTAMP,
  last_cart_at TIMESTAMP,
  last_wish_at TIMESTAMP,
  last_order_at TIMESTAMP,
  registered_our_product_yn TEXT NOT NULL DEFAULT 'N',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP,
  sale_status TEXT NOT NULL DEFAULT 'active',
  buyable_qty INTEGER,
  min_order_qty INTEGER,
  max_order_qty INTEGER,
  return_available_yn TEXT NOT NULL DEFAULT 'Y',
  exchange_available_yn TEXT NOT NULL DEFAULT 'Y',
  return_policy_text TEXT,
  exchange_policy_text TEXT,
  return_shipping_fee INTEGER NOT NULL DEFAULT 0,
  exchange_shipping_fee INTEGER NOT NULL DEFAULT 0,
  return_period_days INTEGER,
  exchange_period_days INTEGER,
  PRIMARY KEY (product_uid)
);

CREATE INDEX IF NOT EXISTS idx_gm_product_keyword ON gm_product(keyword);
CREATE INDEX IF NOT EXISTS idx_gm_product_mall_code ON gm_product(mall_code);
CREATE INDEX IF NOT EXISTS idx_gm_product_cp_selected_code ON gm_product(cp_selected_code);
CREATE INDEX IF NOT EXISTS idx_gm_product_cp_fix_code ON gm_product(cp_fix_code);
CREATE INDEX IF NOT EXISTS idx_gm_product_cp_match ON gm_product(cp_match);
CREATE INDEX IF NOT EXISTS idx_gm_product_pi_ii_vi ON gm_product(pi_ii_vi);

-- V028: 상세 카테고리 path에서 새로 발견된 쿠팡 세부 카테고리를 기본 카테고리와 분리 보관한다.
CREATE TABLE IF NOT EXISTS gm_category_dynamic (
  id BIGSERIAL PRIMARY KEY,
  mall_code TEXT NOT NULL DEFAULT 'CPKR',
  gm_code TEXT NOT NULL,
  cp_code TEXT NOT NULL,
  gm_parent_code TEXT,
  cp_parent_code TEXT,
  cp_id TEXT,
  parent_name_ko TEXT,
  depth INTEGER NOT NULL DEFAULT 1,
  leaf_yn TEXT NOT NULL DEFAULT 'Y',
  display_yn TEXT NOT NULL DEFAULT 'Y',
  sort_order INTEGER NOT NULL DEFAULT 0,
  name_ko TEXT NOT NULL,
  keyword TEXT,
  category_path TEXT,
  source_keyword TEXT,
  source_product_id TEXT,
  source_item_id TEXT,
  source_vendor_item_id TEXT,
  source TEXT NOT NULL DEFAULT 'detail_auto',
  active_yn TEXT NOT NULL DEFAULT 'Y',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mall_code, cp_code)
);
CREATE INDEX IF NOT EXISTS idx_gm_category_dynamic_keyword ON gm_category_dynamic(keyword);
CREATE INDEX IF NOT EXISTS idx_gm_category_dynamic_name_ko ON gm_category_dynamic(name_ko);
CREATE INDEX IF NOT EXISTS idx_gm_category_dynamic_parent ON gm_category_dynamic(cp_parent_code);

ALTER TABLE gm_product ALTER COLUMN option_json SET DEFAULT '{"iid_vid":""}'::jsonb;


-- 운영 안전 보강: 기존 테이블에는 필요한 칼럼만 추가한다. DROP/DELETE/TRUNCATE 금지.
ALTER TABLE gm_product ADD COLUMN IF NOT EXISTS cp_selected_code TEXT;
ALTER TABLE gm_product ADD COLUMN IF NOT EXISTS cp_fix_code TEXT;
ALTER TABLE gm_product ADD COLUMN IF NOT EXISTS cp_match TEXT NOT NULL DEFAULT 'F';
ALTER TABLE gm_product ADD COLUMN IF NOT EXISTS option_json JSONB NOT NULL DEFAULT '{"iid_vid":""}'::jsonb;
ALTER TABLE gm_product ADD COLUMN IF NOT EXISTS detail_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE gm_product ADD COLUMN IF NOT EXISTS mall_category_json JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE gm_product ADD COLUMN IF NOT EXISTS product_url TEXT NOT NULL DEFAULT '';
ALTER TABLE gm_product ADD COLUMN IF NOT EXISTS jeju_delivery_yn TEXT NOT NULL DEFAULT 'F';
ALTER TABLE gm_product ADD COLUMN IF NOT EXISTS jeju_extra_delivery_fee INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gm_product ADD COLUMN IF NOT EXISTS island_delivery_yn TEXT NOT NULL DEFAULT 'F';
ALTER TABLE gm_product ADD COLUMN IF NOT EXISTS island_extra_delivery_fee INTEGER NOT NULL DEFAULT 0;


-- SmartFit V016: MAIN/SUB 구분 없이 공개 활성 Template 포함 수를 빠르게 표시한다.
ALTER TABLE gm_product ADD COLUMN IF NOT EXISTS smartfit_template_count BIGINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_gm_product_smartfit_template_count_v016 ON gm_product (smartfit_template_count DESC);

-- 제주/도서산간 배송상태 최종 규칙
-- Y = 추가배송비 있음, N = 배송 불가, F = 무료배송
-- 기존 T/F 이진 구조가 확인될 때만 기존값을 1회 변환한다.
DO $$
DECLARE
  jeju_default text;
  island_default text;
  legacy_schema boolean := false;
BEGIN
  SELECT column_default INTO jeju_default
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'gm_product'
    AND column_name = 'jeju_delivery_yn';

  SELECT column_default INTO island_default
  FROM information_schema.columns
  WHERE table_schema = current_schema()
    AND table_name = 'gm_product'
    AND column_name = 'island_delivery_yn';

  legacy_schema :=
    coalesce(jeju_default, '') ILIKE '%T%'
    OR coalesce(island_default, '') ILIKE '%T%'
    OR EXISTS (
      SELECT 1 FROM gm_product
      WHERE upper(coalesce(jeju_delivery_yn, '')) = 'T'
         OR upper(coalesce(island_delivery_yn, '')) = 'T'
    );

  IF legacy_schema THEN
    UPDATE gm_product
    SET
      jeju_delivery_yn = CASE
        WHEN upper(coalesce(jeju_delivery_yn, '')) = 'F' THEN 'N'
        WHEN upper(coalesce(jeju_delivery_yn, '')) = 'T'
             AND coalesce(jeju_extra_delivery_fee, 0) > 0 THEN 'Y'
        WHEN upper(coalesce(jeju_delivery_yn, '')) = 'T' THEN 'F'
        WHEN upper(coalesce(jeju_delivery_yn, '')) IN ('Y', 'N')
          THEN upper(jeju_delivery_yn)
        ELSE CASE
          WHEN coalesce(jeju_extra_delivery_fee, 0) > 0 THEN 'Y'
          ELSE 'F'
        END
      END,
      island_delivery_yn = CASE
        WHEN upper(coalesce(island_delivery_yn, '')) = 'F' THEN 'N'
        WHEN upper(coalesce(island_delivery_yn, '')) = 'T'
             AND coalesce(island_extra_delivery_fee, 0) > 0 THEN 'Y'
        WHEN upper(coalesce(island_delivery_yn, '')) = 'T' THEN 'F'
        WHEN upper(coalesce(island_delivery_yn, '')) IN ('Y', 'N')
          THEN upper(island_delivery_yn)
        ELSE CASE
          WHEN coalesce(island_extra_delivery_fee, 0) > 0 THEN 'Y'
          ELSE 'F'
        END
      END;
  END IF;
END $$;

UPDATE gm_product
SET jeju_extra_delivery_fee = 0
WHERE jeju_delivery_yn IN ('N', 'F');

UPDATE gm_product
SET island_extra_delivery_fee = 0
WHERE island_delivery_yn IN ('N', 'F');

ALTER TABLE gm_product
  ALTER COLUMN jeju_delivery_yn TYPE TEXT,
  ALTER COLUMN island_delivery_yn TYPE TEXT,
  ALTER COLUMN jeju_delivery_yn SET DEFAULT 'F',
  ALTER COLUMN island_delivery_yn SET DEFAULT 'F';

ALTER TABLE gm_product
  DROP CONSTRAINT IF EXISTS gm_product_jeju_delivery_yn_check;
ALTER TABLE gm_product
  DROP CONSTRAINT IF EXISTS gm_product_island_delivery_yn_check;

ALTER TABLE gm_product
  ADD CONSTRAINT gm_product_jeju_delivery_yn_check
    CHECK (jeju_delivery_yn IN ('Y', 'N', 'F')),
  ADD CONSTRAINT gm_product_island_delivery_yn_check
    CHECK (island_delivery_yn IN ('Y', 'N', 'F'));

