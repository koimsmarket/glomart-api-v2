-- 31_gm_order_operating_patch.sql
-- 현재 운영 DB 테스트용 패치.
-- 테스트 성공 후 아래 변경은 migration_operating/03,04,21의 최종본에 흡수하고 이 파일은 운영 원본 migration에는 남기지 않는다.

BEGIN;

-- 주문 테스트 데이터 초기화: 주문 저장 검증을 위해 기존 쓰레기 데이터 제거
TRUNCATE TABLE gm_order_item RESTART IDENTITY CASCADE;
TRUNCATE TABLE gm_order RESTART IDENTITY CASCADE;
TRUNCATE TABLE gm_member_address RESTART IDENTITY CASCADE;

-- gm_order: 배송지 선택 참조용 address_id만 추가. 도로명/건물번호 분리는 주문서 주소검색 작업에서 별도 처리
ALTER TABLE gm_order ADD COLUMN IF NOT EXISTS address_id VARCHAR(80);

-- gm_order_item: 이미 존재하는 핵심 컬럼의 기본값/상태 정리
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS mall_sale_price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS customer_order_price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS source_mall VARCHAR(20);
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS source_uid TEXT;

ALTER TABLE gm_order_item ALTER COLUMN item_order_status SET DEFAULT 'READY_TO_ORDER';
UPDATE gm_order_item SET item_order_status='READY_TO_ORDER' WHERE item_order_status IS DISTINCT FROM 'READY_TO_ORDER';

-- 같은 주문 안에서 동일 외부상품 중복 저장 방지
DROP INDEX IF EXISTS uq_gm_order_item_order_source_uid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_gm_order_item_order_source_uid
  ON gm_order_item(order_no, source_uid)
  WHERE source_uid IS NOT NULL AND source_uid <> '';

-- gm_member_address: 주문 시 INSERT 금지. 기존 쓰레기 주소는 위 TRUNCATE로 제거.
ALTER TABLE gm_member_address ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_gm_member_address_member_last_used
  ON gm_member_address(member_id, last_used_at DESC);

COMMIT;
