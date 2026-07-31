-- 101_gm_auto_order.sql
-- Glomart Auto Order core schema
-- Migration numbering restarted at 101 to avoid collision with SmartFit/cart migrations.
-- Based on GLOMART_AUTO_ORDER_FINAL_TABLE_DESIGN_V006
--
-- Important:
-- - This replaces/discards the old GM_AUTO_ORDER_RUNTIME_V001 migration design.
-- - No gm_auto_order_client / gm_auto_order_job / gm_auto_order_job_event tables.
-- - gm_auto_order_work is the control tower / queue / assignment / lock table.
-- - ORDER is created before payment but must not run until payment is confirmed.
--   For that reason work_status may use WAIT_PAYMENT.

CREATE TABLE IF NOT EXISTS gm_auto_order (
  auto_order_no TEXT PRIMARY KEY,
  order_no TEXT NOT NULL,
  ordered_at DATE NOT NULL,
  member_id TEXT NOT NULL,
  mall_code TEXT NOT NULL,

  mode TEXT NOT NULL DEFAULT 'SEMI_AUTO',

  admin_id TEXT,
  mall_account_id TEXT,

  received_item_count INTEGER NOT NULL DEFAULT 0,
  ordered_item_count INTEGER NOT NULL DEFAULT 0,

  order_status TEXT NOT NULL DEFAULT 'NOT_ORDERED',
  cancel_status TEXT NOT NULL DEFAULT 'NONE',
  exchange_status TEXT NOT NULL DEFAULT 'NONE',
  return_status TEXT NOT NULL DEFAULT 'NONE',
  process_status TEXT NOT NULL DEFAULT 'PENDING',

  total_product_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_delivery_fee NUMERIC(14,2) NOT NULL DEFAULT 0,
  extra_area_delivery_fee NUMERIC(14,2) NOT NULL DEFAULT 0,
  actual_payment_amount NUMERIC(14,2) NOT NULL DEFAULT 0,

  mall_order_no TEXT,
  payment_method TEXT,
  payment_completed_at TIMESTAMP,

  last_error_code TEXT,
  last_error_message TEXT,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gm_auto_order_order_no
  ON gm_auto_order (order_no);

CREATE INDEX IF NOT EXISTS idx_gm_auto_order_member_day
  ON gm_auto_order (member_id, ordered_at);

CREATE INDEX IF NOT EXISTS idx_gm_auto_order_admin
  ON gm_auto_order (admin_id);

CREATE INDEX IF NOT EXISTS idx_gm_auto_order_mall_account
  ON gm_auto_order (mall_account_id);

CREATE INDEX IF NOT EXISTS idx_gm_auto_order_mall_order_no
  ON gm_auto_order (mall_order_no);


CREATE TABLE IF NOT EXISTS gm_auto_order_item (
  auto_order_item_id BIGSERIAL PRIMARY KEY,
  auto_order_no TEXT NOT NULL,
  order_no TEXT NOT NULL,

  pi_ii_vi TEXT,
  mall_code TEXT NOT NULL,
  source_uid TEXT,

  product_name TEXT,
  option_name TEXT,
  option_value TEXT,

  quantity INTEGER NOT NULL DEFAULT 1,
  ordered_quantity INTEGER NOT NULL DEFAULT 0,

  mall_sale_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  order_attempt_price NUMERIC(14,2),
  ordered_price NUMERIC(14,2),
  item_discount_amount NUMERIC(14,2),
  product_amount NUMERIC(14,2),

  item_order_status TEXT NOT NULL DEFAULT 'NOT_ORDERED',
  process_status TEXT NOT NULL DEFAULT 'PENDING',

  mall_order_no TEXT,
  mall_order_item_no TEXT,
  ordered_at TIMESTAMP,

  error_code TEXT,
  error_message TEXT,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gm_auto_order_item_auto_order
  ON gm_auto_order_item (auto_order_no);

CREATE INDEX IF NOT EXISTS idx_gm_auto_order_item_order_no
  ON gm_auto_order_item (order_no);

CREATE INDEX IF NOT EXISTS idx_gm_auto_order_item_pi_ii_vi
  ON gm_auto_order_item (pi_ii_vi);

CREATE INDEX IF NOT EXISTS idx_gm_auto_order_item_mall_order_no
  ON gm_auto_order_item (mall_order_no);


-- Control tower:
-- ORDER / CANCEL / EXCHANGE / RETURN work assignment and locking.
CREATE TABLE IF NOT EXISTS gm_auto_order_work (
  work_id BIGSERIAL PRIMARY KEY,
  auto_order_no TEXT NOT NULL,

  work_type TEXT NOT NULL,
  work_status TEXT NOT NULL DEFAULT 'WAIT_PAYMENT',
  priority INTEGER NOT NULL DEFAULT 100,

  admin_id TEXT,
  mall_account_id TEXT,

  lock_token TEXT,
  lock_admin_id TEXT,
  lock_mall_account_id TEXT,
  lock_at TIMESTAMP,
  lock_expires_at TIMESTAMP,

  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,

  error_code TEXT,
  error_message TEXT,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gm_auto_order_work_queue
  ON gm_auto_order_work (work_status, priority DESC, requested_at ASC, work_id ASC);

CREATE INDEX IF NOT EXISTS idx_gm_auto_order_work_auto_order
  ON gm_auto_order_work (auto_order_no);

CREATE INDEX IF NOT EXISTS idx_gm_auto_order_work_type
  ON gm_auto_order_work (work_type);

CREATE INDEX IF NOT EXISTS idx_gm_auto_order_work_admin
  ON gm_auto_order_work (admin_id);

CREATE INDEX IF NOT EXISTS idx_gm_auto_order_work_mall_account
  ON gm_auto_order_work (mall_account_id);

CREATE INDEX IF NOT EXISTS idx_gm_auto_order_work_lock_admin
  ON gm_auto_order_work (lock_admin_id)
  WHERE lock_admin_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gm_auto_order_work_lock_mall_account
  ON gm_auto_order_work (lock_mall_account_id)
  WHERE lock_mall_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gm_auto_order_work_lock_expires
  ON gm_auto_order_work (lock_expires_at)
  WHERE lock_expires_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_gm_auto_order_work_lock_token
  ON gm_auto_order_work (lock_token)
  WHERE lock_token IS NOT NULL;


CREATE TABLE IF NOT EXISTS gm_auto_order_log (
  log_id BIGSERIAL PRIMARY KEY,
  auto_order_no TEXT NOT NULL,
  auto_order_item_id BIGINT,
  work_id BIGINT,

  action_type TEXT NOT NULL,
  status_before TEXT,
  status_after TEXT,

  admin_id TEXT,
  mall_account_id TEXT,

  message TEXT,
  detail_json JSONB,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gm_auto_order_log_auto_order
  ON gm_auto_order_log (auto_order_no, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gm_auto_order_log_item
  ON gm_auto_order_log (auto_order_item_id, created_at DESC)
  WHERE auto_order_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gm_auto_order_log_work
  ON gm_auto_order_log (work_id, created_at DESC)
  WHERE work_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gm_auto_order_log_action
  ON gm_auto_order_log (action_type, created_at DESC);


-- External mall account + MEMBER administrator assignment in one table.
-- MASTER / DEPUTY may manage this table through the application.
CREATE TABLE IF NOT EXISTS gm_auto_order_account (
  account_admin_id BIGSERIAL PRIMARY KEY,

  admin_id TEXT NOT NULL,
  account_admin_role TEXT NOT NULL DEFAULT 'OPERATOR',

  mall_account_id TEXT,
  mall_code TEXT,
  account_name TEXT,
  login_id TEXT,
  encrypted_password TEXT,

  can_order BOOLEAN NOT NULL DEFAULT FALSE,
  can_payment BOOLEAN NOT NULL DEFAULT FALSE,
  can_cancel BOOLEAN NOT NULL DEFAULT FALSE,
  can_exchange BOOLEAN NOT NULL DEFAULT FALSE,
  can_return BOOLEAN NOT NULL DEFAULT FALSE,

  enabled BOOLEAN NOT NULL DEFAULT TRUE,

  created_by_member_id TEXT,
  updated_by_member_id TEXT,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gm_auto_order_account_admin
  ON gm_auto_order_account (admin_id);

CREATE INDEX IF NOT EXISTS idx_gm_auto_order_account_mall
  ON gm_auto_order_account (mall_code, mall_account_id);

CREATE INDEX IF NOT EXISTS idx_gm_auto_order_account_role
  ON gm_auto_order_account (account_admin_role, enabled);
