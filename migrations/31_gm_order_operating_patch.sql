-- 31_gm_order_operating_patch.sql
-- 현재 운영/테스트 DB 반영용 임시 패치
-- 테스트 후 migration_operating/03,04,21 파일을 원본 migrations에 반영하고 이 패치는 제거한다.

BEGIN;

-- 기존 테스트 주문/주문상품/중복 주소록 데이터 삭제
TRUNCATE TABLE gm_order_item RESTART IDENTITY CASCADE;
TRUNCATE TABLE gm_order RESTART IDENTITY CASCADE;
TRUNCATE TABLE gm_member_address RESTART IDENTITY CASCADE;

-- gm_order 보강
ALTER TABLE gm_order ADD COLUMN IF NOT EXISTS address_id TEXT;
ALTER TABLE gm_order ADD COLUMN IF NOT EXISTS receiver_road_address TEXT;
ALTER TABLE gm_order ADD COLUMN IF NOT EXISTS receiver_building_no TEXT;
CREATE INDEX IF NOT EXISTS idx_gm_order_address_id ON gm_order(address_id);
CREATE INDEX IF NOT EXISTS idx_gm_order_cafe24_order_no ON gm_order(cafe24_order_no);

-- gm_order_item 보강
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS mall_sale_price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS customer_order_price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS source_mall TEXT;
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS source_uid TEXT;
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS cafe24_order_no TEXT;
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS sales_confirmed_at TIMESTAMP;
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS return_deadline_at TIMESTAMP;
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS incentive_calculated_yn TEXT DEFAULT 'N';
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS incentive_calculated_at TIMESTAMP;
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS incentive_settlement_month TEXT;
ALTER TABLE gm_order_item ALTER COLUMN item_order_status SET DEFAULT 'READY_TO_ORDER';
UPDATE gm_order_item SET item_order_status='READY_TO_ORDER' WHERE item_order_status IS DISTINCT FROM 'READY_TO_ORDER';
CREATE INDEX IF NOT EXISTS idx_gm_order_item_source_uid ON gm_order_item(source_uid);
DROP INDEX IF EXISTS uq_gm_order_item_order_source_uid;
CREATE UNIQUE INDEX uq_gm_order_item_order_source_uid
  ON gm_order_item (order_no, source_mall, source_uid, COALESCE(option_name,''), COALESCE(option_value,''))
  WHERE source_uid IS NOT NULL AND source_uid <> '';

-- gm_member / gm_member_address 보강
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS default_road_address TEXT;
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS default_building_no VARCHAR(40);
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS last_address_id VARCHAR(40);

ALTER TABLE gm_member_address ADD COLUMN IF NOT EXISTS road_address TEXT;
ALTER TABLE gm_member_address ADD COLUMN IF NOT EXISTS building_no VARCHAR(40);
ALTER TABLE gm_member_address ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_gm_member_address_last_used ON gm_member_address(member_id, last_used_at DESC);

COMMIT;
