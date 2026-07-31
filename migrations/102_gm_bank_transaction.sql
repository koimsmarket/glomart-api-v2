-- 102_gm_bank_transaction.sql
-- Common bank transaction ledger.
-- Shared by all bank-specific parsers; WOORI is only the first parser.
--
-- This table is bank-neutral.
-- WOORI / KB / SHINHAN / HANA / other bank Excel parsers and future
-- OPEN_BANKING adapters must normalize their source format into this table.
-- The parser/adapter is bank-specific; the storage table is shared.

CREATE TABLE IF NOT EXISTS gm_bank_transaction (
  bank_transaction_id BIGSERIAL PRIMARY KEY,

  bank_code VARCHAR(20) NOT NULL,
  account_no VARCHAR(64) NOT NULL,
  account_holder VARCHAR(160),

  transaction_at TIMESTAMP NOT NULL,
  transaction_type VARCHAR(120),
  description TEXT,

  withdraw_amount BIGINT NOT NULL DEFAULT 0,
  deposit_amount BIGINT NOT NULL DEFAULT 0,
  balance_amount BIGINT NOT NULL DEFAULT 0,

  branch_name TEXT,
  bank_memo TEXT,
  instrument_amount BIGINT NOT NULL DEFAULT 0,

  source_type VARCHAR(20) NOT NULL DEFAULT 'FILE',
  source_file_name TEXT,
  source_file_hash CHAR(64),
  source_row_no INTEGER,
  bank_row_no INTEGER,

  transaction_hash CHAR(64) NOT NULL,
  raw_json JSONB,

  process_status VARCHAR(20) NOT NULL DEFAULT 'UNPROCESSED',
  matched_order_no TEXT,
  matched_amount BIGINT,
  processed_at TIMESTAMP,
  processed_by_member_id TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_gm_bank_transaction_hash UNIQUE (transaction_hash)
);

CREATE INDEX IF NOT EXISTS idx_gm_bank_transaction_unprocessed_deposit
  ON gm_bank_transaction (process_status, transaction_at DESC)
  WHERE deposit_amount > 0;

CREATE INDEX IF NOT EXISTS idx_gm_bank_transaction_order
  ON gm_bank_transaction (matched_order_no)
  WHERE matched_order_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gm_bank_transaction_account_time
  ON gm_bank_transaction (bank_code, account_no, transaction_at DESC);

CREATE INDEX IF NOT EXISTS idx_gm_bank_transaction_source_file
  ON gm_bank_transaction (source_file_hash, source_row_no);

CREATE INDEX IF NOT EXISTS idx_gm_bank_transaction_source_type
  ON gm_bank_transaction (source_type, bank_code, transaction_at DESC);
