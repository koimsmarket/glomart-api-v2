-- 128_gm_point_reward.sql
-- Glomart purchase reward point ledger.
-- Cash deposit remains completely separate in gm_deposit_*.
BEGIN;

CREATE TABLE IF NOT EXISTS gm_point_balance (
  member_id       VARCHAR(80) PRIMARY KEY,
  balance_amount  BIGINT NOT NULL DEFAULT 0 CHECK (balance_amount >= 0),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gm_point_transaction (
  transaction_id    BIGSERIAL PRIMARY KEY,
  member_id         VARCHAR(80) NOT NULL,
  order_no          VARCHAR(60),
  transaction_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  transaction_type  VARCHAR(40) NOT NULL,
  grant_amount      BIGINT NOT NULL DEFAULT 0 CHECK (grant_amount >= 0),
  use_amount        BIGINT NOT NULL DEFAULT 0 CHECK (use_amount >= 0),
  balance_after     BIGINT NOT NULL CHECK (balance_after >= 0),
  description       VARCHAR(255),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT gm_point_transaction_amount_ck CHECK (
    (grant_amount > 0 AND use_amount = 0)
    OR (grant_amount = 0 AND use_amount > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_gm_point_tx_member_time
  ON gm_point_transaction(member_id, transaction_at DESC, transaction_id DESC);
CREATE INDEX IF NOT EXISTS idx_gm_point_tx_order
  ON gm_point_transaction(order_no)
  WHERE order_no IS NOT NULL;

-- One order can consume points only once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gm_point_order_use
  ON gm_point_transaction(order_no)
  WHERE order_no IS NOT NULL AND transaction_type='ORDER_USE';

-- Purchase-confirm reward is generated exactly once per order.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gm_point_purchase_confirm_grant
  ON gm_point_transaction(order_no)
  WHERE order_no IS NOT NULL AND transaction_type='PURCHASE_CONFIRM_GRANT';

ALTER TABLE gm_order
  ADD COLUMN IF NOT EXISTS point_used_amount BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS point_granted_amount BIGINT NOT NULL DEFAULT 0;

-- Initial balance migration only; historical rows are not fabricated.
INSERT INTO gm_point_balance(member_id,balance_amount,updated_at)
SELECT member_id,GREATEST(0,COALESCE(point_balance,0)::BIGINT),NOW()
  FROM gm_member
 WHERE member_id IS NOT NULL AND BTRIM(member_id)<>''
ON CONFLICT(member_id) DO NOTHING;

COMMIT;
