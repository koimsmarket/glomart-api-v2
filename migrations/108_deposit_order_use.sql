-- 108_deposit_order_use.sql
-- 주문결과 재호출/새로고침으로 예치금이 중복 차감되는 것을 DB에서 차단한다.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS uq_deposit_order_use
  ON gm_deposit_transaction(order_no)
  WHERE order_no IS NOT NULL AND transaction_type='ORDER_USE';
COMMIT;
