-- 46_gm_order_customer_seller_status.sql
-- 외부상품 주문조회 및 취소/교환/반품 처리를 위한 주문 상태 컬럼 추가
--
-- 상태 분리 원칙
--   seller_status   : 판매자/물류의 실제 주문·배송 진행 상태
--   customer_status : 구매자의 구매확정 및 취소·교환·반품 요청 처리 상태
--
-- seller_status 권장값
--   READY_TO_ORDER, ORDERED, PREPARING, SHIPPING, DELIVERED, CANCELLED
--
-- customer_status 권장값
--   NONE, PURCHASE_CONFIRMED,
--   CANCEL_REQUESTED, CANCEL_PROCESSING, CANCEL_COMPLETED, CANCEL_REJECTED, CANCEL_WITHDRAWN,
--   EXCHANGE_REQUESTED, EXCHANGE_PROCESSING, EXCHANGE_COMPLETED, EXCHANGE_REJECTED, EXCHANGE_WITHDRAWN,
--   RETURN_REQUESTED, RETURN_PROCESSING, RETURN_COMPLETED, RETURN_REJECTED, RETURN_WITHDRAWN

BEGIN;

ALTER TABLE gm_order
  ADD COLUMN IF NOT EXISTS seller_status TEXT,
  ADD COLUMN IF NOT EXISTS customer_status TEXT,
  ADD COLUMN IF NOT EXISTS cs_reason_code TEXT,
  ADD COLUMN IF NOT EXISTS cs_reason_text TEXT,
  ADD COLUMN IF NOT EXISTS cs_requested_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS cs_processed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS cs_completed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS cs_rejected_reason TEXT,
  ADD COLUMN IF NOT EXISTS cs_withdrawn_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS refund_amount INTEGER,
  ADD COLUMN IF NOT EXISTS refund_completed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS admin_memo TEXT;

-- 기존 주문/배송 상태를 판매자 상태로 1회 변환한다.
-- 이미 seller_status가 저장된 레코드는 건드리지 않는다.
UPDATE gm_order
SET seller_status = CASE
  WHEN UPPER(COALESCE(cancel_status, '')) IN ('COMPLETED', 'COMPLETE', 'CANCELLED', 'CANCELED', 'DONE')
    OR UPPER(COALESCE(order_status, '')) IN ('CANCELLED', 'CANCELED')
    THEN 'CANCELLED'
  WHEN delivered_at IS NOT NULL
    OR UPPER(COALESCE(shipping_status, '')) IN ('DELIVERED', 'COMPLETE', 'COMPLETED')
    THEN 'DELIVERED'
  WHEN UPPER(COALESCE(shipping_status, '')) IN ('SHIPPING', 'IN_TRANSIT', 'DISPATCHED', 'SHIPPED')
    THEN 'SHIPPING'
  WHEN UPPER(COALESCE(shipping_status, '')) IN ('PREPARING', 'READY', 'READY_TO_SHIP')
    THEN 'PREPARING'
  WHEN UPPER(COALESCE(order_status, '')) IN ('ORDERED', 'ACCEPTED', 'PAID')
    THEN 'ORDERED'
  ELSE 'READY_TO_ORDER'
END
WHERE seller_status IS NULL OR BTRIM(seller_status) = '';

-- 기존 구매확정/취소 상태를 구매자 상태로 1회 변환한다.
-- 취소 완료/요청 상태를 구매확정보다 우선한다.
UPDATE gm_order
SET customer_status = CASE
  WHEN UPPER(COALESCE(cancel_status, '')) IN ('COMPLETED', 'COMPLETE', 'CANCELLED', 'CANCELED', 'DONE')
    THEN 'CANCEL_COMPLETED'
  WHEN cancel_requested_at IS NOT NULL
    OR UPPER(COALESCE(cancel_status, '')) IN ('REQUESTED', 'REQUEST', 'PENDING', 'PROCESSING')
    THEN CASE
      WHEN UPPER(COALESCE(cancel_status, '')) = 'PROCESSING' THEN 'CANCEL_PROCESSING'
      ELSE 'CANCEL_REQUESTED'
    END
  WHEN UPPER(COALESCE(purchase_confirmed_yn, 'N')) = 'Y'
    OR purchase_confirmed_at IS NOT NULL
    THEN 'PURCHASE_CONFIRMED'
  ELSE 'NONE'
END
WHERE customer_status IS NULL OR BTRIM(customer_status) = '';

-- 기존 취소 시각은 공통 CS 시각에 보존한다.
UPDATE gm_order
SET cs_requested_at = cancel_requested_at
WHERE cs_requested_at IS NULL
  AND cancel_requested_at IS NOT NULL;

UPDATE gm_order
SET cs_completed_at = cancel_completed_at
WHERE cs_completed_at IS NULL
  AND cancel_completed_at IS NOT NULL;

ALTER TABLE gm_order
  ALTER COLUMN seller_status SET DEFAULT 'READY_TO_ORDER',
  ALTER COLUMN seller_status SET NOT NULL,
  ALTER COLUMN customer_status SET DEFAULT 'NONE',
  ALTER COLUMN customer_status SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gm_order_member_seller_ordered
  ON gm_order(member_id, seller_status, ordered_at DESC);

CREATE INDEX IF NOT EXISTS idx_gm_order_member_customer_ordered
  ON gm_order(member_id, customer_status, ordered_at DESC);

CREATE INDEX IF NOT EXISTS idx_gm_order_customer_status
  ON gm_order(customer_status)
  WHERE customer_status <> 'NONE';

COMMIT;
