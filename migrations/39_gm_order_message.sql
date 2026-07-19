-- 39_gm_order_message.sql
-- 주문 알림 전용 단기 보관 테이블.
-- 주문 최종 완료 후 30일이 지나면 해당 order_no의 행을 삭제한다.
--
-- direct_message 사용 규칙
--   ORDER_SHIPPED / EXCHANGE_RESHIPPED : 택배사|송장번호
--   DIRECT                              : 운영자 직접 입력 메시지
--   그 외                               : NULL

CREATE TABLE IF NOT EXISTS gm_order_message (
  message_id BIGSERIAL PRIMARY KEY,
  order_no TEXT NOT NULL,
  message_seq INTEGER NOT NULL,
  message_type VARCHAR(50) NOT NULL,
  direct_message TEXT,
  device_lang TEXT NOT NULL DEFAULT '',
  received_yn CHAR(1) NOT NULL DEFAULT 'N',
  sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  opened_at TIMESTAMP,
  CONSTRAINT uq_gm_order_message_order_seq UNIQUE (order_no, message_seq),
  CONSTRAINT ck_gm_order_message_received_yn CHECK (received_yn IN ('Y', 'N'))
);

COMMENT ON TABLE gm_order_message IS '주문별 단기 앱 알림. 주문 최종 완료 30일 후 삭제';
COMMENT ON COLUMN gm_order_message.message_seq IS '주문별 메시지 일련번호. 화면에서는 001 형식으로 표시';
COMMENT ON COLUMN gm_order_message.message_type IS 'ORDER_RECEIVED, ORDER_SHIPPED, RETURN_APPROVED, EXCHANGE_APPROVED, RETURN_COMPLETED, EXCHANGE_RESHIPPED, DIRECT 등';
COMMENT ON COLUMN gm_order_message.direct_message IS '배송 메시지는 택배사|송장번호, DIRECT는 직접 입력문, 그 외 NULL';
COMMENT ON COLUMN gm_order_message.device_lang IS '실제 발송 시 사용한 언어값 스냅샷';
COMMENT ON COLUMN gm_order_message.received_yn IS '사용자 앱 수신 여부 Y/N';
COMMENT ON COLUMN gm_order_message.sent_at IS 'FCM 발송일시';
COMMENT ON COLUMN gm_order_message.opened_at IS '사용자 확인일시';
