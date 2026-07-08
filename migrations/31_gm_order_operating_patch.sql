-- 운영 테스트용 패치. 테스트 성공 후 migration_operating의 03/04/21을 기존 migrations 원본에 흡수한다.
-- 새 쇼핑몰 설치본에는 이 31번 파일을 남기지 않는다.

BEGIN;

-- 테스트 데이터 초기화
TRUNCATE TABLE gm_order_item RESTART IDENTITY CASCADE;
TRUNCATE TABLE gm_order RESTART IDENTITY CASCADE;
TRUNCATE TABLE gm_member_address RESTART IDENTITY CASCADE;

-- gm_order: 현재 필요한 참조 배송지 ID만 추가.
-- 도로명/건물번호 분리는 주문서 주소검색 완료 시점에서 별도 작업하므로 여기서 생성하지 않는다.
ALTER TABLE gm_order ADD COLUMN IF NOT EXISTS address_id VARCHAR(80);
CREATE INDEX IF NOT EXISTS idx_gm_order_address_id ON gm_order(address_id);

-- gm_order_item: 확인된 기존 컬럼의 기본값/값 정리
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS mall_sale_price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS customer_order_price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS source_mall VARCHAR(20);
ALTER TABLE gm_order_item ADD COLUMN IF NOT EXISTS source_uid VARCHAR(160);
ALTER TABLE gm_order_item ALTER COLUMN item_order_status SET DEFAULT 'READY_TO_ORDER';
UPDATE gm_order_item SET item_order_status='READY_TO_ORDER' WHERE item_order_status IS DISTINCT FROM 'READY_TO_ORDER';
CREATE INDEX IF NOT EXISTS idx_gm_order_item_source_uid ON gm_order_item(source_uid);

-- gm_member_address: 주문 테스트로 생성된 쓰레기 주소는 위 TRUNCATE로 제거.
-- 주문 저장 중 주소록 INSERT/UPDATE는 JS/route에서 차단한다.
ALTER TABLE gm_member_address ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_gm_member_address_member_last_used ON gm_member_address(member_id, last_used_at DESC);

COMMIT;
