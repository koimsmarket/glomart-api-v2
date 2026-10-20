-- GM_GPAY_V067: additive only; run with audited manual migration procedure.
-- All ledger statuses belong to purchase workflow. NEVER reverse issued G-PAY on purchase failure.
BEGIN;
CREATE TABLE IF NOT EXISTS gm_purchase_saga (
  tx_id VARCHAR(160) PRIMARY KEY,
  order_no VARCHAR(80) NOT NULL UNIQUE,
  member_id VARCHAR(100) NOT NULL,
  gpay_request_no VARCHAR(80) NULL, -- informational link ONLY; never cascade to a G-PAY issue
  product_amount_krw BIGINT NOT NULL CHECK(product_amount_krw >= 0),
  shipping_amount_krw BIGINT NOT NULL CHECK(shipping_amount_krw >= 0),
  point_used_krw BIGINT NOT NULL DEFAULT 0 CHECK(point_used_krw >= 0),
  gpay_amount BIGINT NOT NULL CHECK(gpay_amount >= 0),
  status VARCHAR(32) NOT NULL DEFAULT 'ORDER_PENDING'
    CHECK(status IN ('ORDER_PENDING','POINT_RESERVED','GPAY_UNKNOWN','GPAY_PAID','ORDER_PAID','DELIVERED','PURCHASE_CONFIRMED','RECONCILE_REQUIRED','CANCELLED','COMPENSATED')),
  gpay_payment_ref VARCHAR(160) NULL,
  point_use_ref VARCHAR(160) NULL,
  purchase_confirm_ref VARCHAR(160) NULL,
  last_error_code VARCHAR(100) NULL,
  last_reconciled_at TIMESTAMPTZ NULL,
  version BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(point_used_krw <= (product_amount_krw * 20 / 100 / 10) * 10),
  CHECK(point_used_krw % 10 = 0),
  CHECK(gpay_amount=product_amount_krw+shipping_amount_krw-point_used_krw)
);
CREATE INDEX IF NOT EXISTS idx_gm_purchase_saga_member ON gm_purchase_saga(member_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_purchase_saga_status ON gm_purchase_saga(status,updated_at);
CREATE INDEX IF NOT EXISTS idx_gm_purchase_saga_request ON gm_purchase_saga(gpay_request_no) WHERE gpay_request_no IS NOT NULL;
CREATE TABLE IF NOT EXISTS gm_purchase_saga_event (
  event_id BIGSERIAL PRIMARY KEY,
  tx_id VARCHAR(160) NOT NULL REFERENCES gm_purchase_saga(tx_id),
  event_key VARCHAR(160) NOT NULL,
  step VARCHAR(60) NOT NULL,
  result VARCHAR(40) NOT NULL,
  remote_ref VARCHAR(160) NULL,
  error_code VARCHAR(100) NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tx_id,event_key)
);
CREATE INDEX IF NOT EXISTS idx_gm_saga_event_tx ON gm_purchase_saga_event(tx_id,event_id);
-- Point ledger and purchase confirm use existing migration 128 unique constraints.
-- No FK to G-PAY request: independent DB and issuance lifecycle.
COMMIT;
