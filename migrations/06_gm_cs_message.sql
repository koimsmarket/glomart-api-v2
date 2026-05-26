-- 06_gm_cs_message.sql
-- Source sheet: CS_MESSAGE_DB_최소구조
-- Column structure is preserved from the uploaded workbook.

CREATE TABLE IF NOT EXISTS gm_cs_message (
  message_id INTEGER NOT NULL,
  cs_no TEXT,
  order_no TEXT,
  sender_type TEXT NOT NULL,
  message_type TEXT NOT NULL,
  message_text TEXT,
  file_url TEXT,
  file_name TEXT,
  read_yn TEXT,
  created_at TIMESTAMP NOT NULL,
  PRIMARY KEY (message_id)
);
