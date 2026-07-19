-- 43_gm_smartfit_message_receiver.sql
-- One template message is valid once per receiver. Later serial_no values contain only newly eligible members.

CREATE TABLE IF NOT EXISTS gm_smartfit_message_receiver (
  message_no BIGSERIAL PRIMARY KEY,
  serial_no INTEGER NOT NULL DEFAULT 1,
  template_id BIGINT NOT NULL,
  receiver_member_id VARCHAR(80) NOT NULL,
  device_lang VARCHAR(10) NOT NULL DEFAULT '',
  relation_depth SMALLINT,
  message TEXT NOT NULL DEFAULT '',
  send_status VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
  sent_at TIMESTAMP,
  read_at TIMESTAMP,
  failed_reason TEXT,

  CONSTRAINT uq_gm_smartfit_message_template_receiver
    UNIQUE (template_id, receiver_member_id),
  CONSTRAINT chk_gm_smartfit_message_serial
    CHECK (serial_no > 0),
  CONSTRAINT chk_gm_smartfit_message_relation_depth
    CHECK (relation_depth IS NULL OR relation_depth BETWEEN 1 AND 5),
  CONSTRAINT chk_gm_smartfit_message_status
    CHECK (send_status IN ('QUEUED','QUEUED_NIGHT','PROCESSING','SENT','READ','FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_gm_smartfit_message_receiver_queue
  ON gm_smartfit_message_receiver (template_id, serial_no, send_status, message_no);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_message_receiver_member
  ON gm_smartfit_message_receiver (receiver_member_id, send_status, message_no DESC);
