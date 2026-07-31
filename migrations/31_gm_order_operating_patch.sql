-- 31_gm_order_operating_patch.sql
-- SAFE HISTORICAL VERSION
-- 운영 데이터 보존 원칙:
--   * TRUNCATE / DROP / 무조건 대량 DELETE 금지
--   * 기존 주문 상태를 일괄 덮어쓰지 않음
-- 이 파일은 신규 환경의 구조 보강 용도로만 유지한다.

BEGIN;

-- gm_order: 배송지 선택 참조용
ALTER TABLE gm_order ADD COLUMN IF NOT EXISTS address_id VARCHAR(80);

-- gm_order_item: 구조 보강만 수행
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS mall_sale_price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS customer_order_price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS source_mall VARCHAR(20);
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS source_uid TEXT;

-- 기본값만 설정하고 기존 데이터의 상태값은 보존한다.
ALTER TABLE gm_order_item ALTER COLUMN item_order_status SET DEFAULT 'READY_TO_ORDER';

-- 같은 주문 안에서 동일 외부상품 중복 저장 방지
DROP INDEX IF EXISTS uq_gm_order_item_order_source_uid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_gm_order_item_order_source_uid
  ON gm_order_item(order_no, source_uid)
  WHERE source_uid IS NOT NULL AND source_uid <> '';

-- 회원 배송지 데이터는 절대 초기화하지 않는다.
ALTER TABLE gm_member_address ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_gm_member_address_member_last_used
  ON gm_member_address(member_id, last_used_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_member_address_default_recent
  ON gm_member_address(member_id, is_default DESC, last_used_at DESC, updated_at DESC);

COMMIT;
