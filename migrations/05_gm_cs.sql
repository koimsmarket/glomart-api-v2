-- 05_gm_cs.sql
-- Source sheet: CS_DB_최소구조
-- Column structure is preserved from the uploaded workbook.

CREATE TABLE IF NOT EXISTS gm_cs (
  cs_no TEXT NOT NULL,
  request_at TIMESTAMP NOT NULL,
  order_no TEXT,
  pi_ii_vi TEXT,
  cs_type TEXT NOT NULL,
  cs_status TEXT NOT NULL,
  message_summary TEXT,
  return_at TIMESTAMP,
  return_carrier TEXT,
  return_invoice_no TEXT,
  return_received_at TIMESTAMP,
  return_confirm_yn TEXT,
  reship_at TIMESTAMP,
  reship_carrier TEXT,
  reship_invoice_no TEXT,
  reship_received_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP,
  PRIMARY KEY (cs_no)
);
