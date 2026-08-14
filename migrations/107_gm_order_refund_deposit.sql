-- 107_gm_order_refund_deposit.sql
-- GM_ORDER_SERVER_V102 FINAL CONSOLIDATED FINANCE STRUCTURE
-- Base: glomart-api-v2_20260814_0758
--
-- FINAL RULES
-- 1) gm_order remains the only Glomart order/status table.
-- 2) Refund destination account is NOT copied into gm_order.
--    BANK refund account is always read from gm_member.refund_*.
-- 3) Existing gm_bank_transaction remains the company-wide bank account ledger.
--    This migration does not alter or duplicate that table.
-- 4) Member deposit money is managed by TWO dedicated tables:
--      gm_deposit_balance      = current member balance (1 row/member)
--      gm_deposit_transaction  = individual member deposit/use/refund history
-- 5) gm_deposit_transaction can point to existing bank history
--    (bank_transaction_id) and/or order history (order_no).

BEGIN;

-- gm_order stores refund SUMMARY/STATE only.
ALTER TABLE gm_order
  ADD COLUMN IF NOT EXISTS refund_method VARCHAR(20),
  ADD COLUMN IF NOT EXISTS refund_status VARCHAR(20) NOT NULL DEFAULT 'NONE';

COMMENT ON COLUMN gm_order.refund_method IS
  'Refund method only: BANK or DEPOSIT. Refund account stays only in gm_member.refund_*.';
COMMENT ON COLUMN gm_order.refund_status IS
  'Refund state only: NONE, PENDING, PROCESSING, COMPLETED, FAILED.';

-- Current deposit balance: exactly one row per member.
CREATE TABLE IF NOT EXISTS gm_deposit_balance (
  member_id       VARCHAR(80) PRIMARY KEY,
  balance_amount  BIGINT NOT NULL DEFAULT 0 CHECK (balance_amount >= 0),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE gm_deposit_balance IS
  'Current Glomart deposit balance per member. Detailed history is gm_deposit_transaction.';

-- Member-by-member deposit movement history.
CREATE TABLE IF NOT EXISTS gm_deposit_transaction (
  transaction_id      BIGSERIAL PRIMARY KEY,
  member_id           VARCHAR(80) NOT NULL,
  bank_transaction_id BIGINT,
  order_no            VARCHAR(60),
  transaction_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  transaction_type    VARCHAR(30) NOT NULL,
  deposit_amount      BIGINT NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  withdraw_amount     BIGINT NOT NULL DEFAULT 0 CHECK (withdraw_amount >= 0),
  balance_after       BIGINT NOT NULL CHECK (balance_after >= 0),
  description         VARCHAR(255),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT gm_deposit_transaction_amount_ck
    CHECK (
      (deposit_amount > 0 AND withdraw_amount = 0)
      OR (deposit_amount = 0 AND withdraw_amount > 0)
    )
);

COMMENT ON TABLE gm_deposit_transaction IS
  'Member deposit ledger. bank_transaction_id links company bank history; order_no links order/use/refund history.';
COMMENT ON COLUMN gm_deposit_transaction.bank_transaction_id IS
  'Existing gm_bank_transaction.bank_transaction_id when this balance movement originated from an actual bank transaction.';
COMMENT ON COLUMN gm_deposit_transaction.order_no IS
  'gm_order.order_no when this balance movement originated from order use/refund.';
COMMENT ON COLUMN gm_deposit_transaction.transaction_type IS
  'BANK_IN, BANK_OUT, ORDER_USE, ORDER_REFUND, ADMIN_ADJUST_IN, ADMIN_ADJUST_OUT.';

CREATE INDEX IF NOT EXISTS idx_gm_deposit_tx_member_time
  ON gm_deposit_transaction(member_id, transaction_at DESC, transaction_id DESC);
CREATE INDEX IF NOT EXISTS idx_gm_deposit_tx_bank
  ON gm_deposit_transaction(bank_transaction_id)
  WHERE bank_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gm_deposit_tx_order
  ON gm_deposit_transaction(order_no)
  WHERE order_no IS NOT NULL;

-- One order cancellation can be credited back to deposit only once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gm_deposit_order_refund
  ON gm_deposit_transaction(order_no)
  WHERE order_no IS NOT NULL AND transaction_type='ORDER_REFUND';

-- Initial balance migration only. Historical transactions are NOT fabricated.
-- gm_member.deposit_balance is the existing legacy balance source at migration time.
INSERT INTO gm_deposit_balance(member_id, balance_amount, updated_at)
SELECT member_id, GREATEST(0, COALESCE(deposit_balance,0)::BIGINT), NOW()
  FROM gm_member
 WHERE member_id IS NOT NULL AND BTRIM(member_id)<>''
ON CONFLICT (member_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_gm_order_refund_status
  ON gm_order(refund_status, ordered_at DESC);

COMMIT;
