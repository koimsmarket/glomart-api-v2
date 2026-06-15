-- 07_gm_member_wallet.sql
-- Source schema: GM_MEMBER_WALLET_DB_SCHEMA_V003.csv
-- Purpose: Cafe24 member mirror + Glomart wallet/deposit/bonus/point/network incentive ledger.
-- Rule: current member state is stored in gm_member; every money/incentive movement is recorded in gm_member_ledger.

CREATE TABLE IF NOT EXISTS gm_member (
  member_id VARCHAR(80) NOT NULL,
  cafe24_member_id VARCHAR(80),
  member_name VARCHAR(120),
  member_name_en VARCHAR(120),
  email VARCHAR(180),
  phone VARCHAR(40),
  country_code VARCHAR(20),
  nationality VARCHAR(60),
  language_code VARCHAR(10) DEFAULT 'ko',
  cs_language VARCHAR(10) DEFAULT 'ko',
  recommender_id VARCHAR(80),
  network_seller_id VARCHAR(80),
  commission_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  member_grade VARCHAR(80),
  member_grade_code VARCHAR(40),
  member_status VARCHAR(20) NOT NULL DEFAULT 'active',
  deposit_balance NUMERIC(14,0) NOT NULL DEFAULT 0,
  bonus_balance NUMERIC(14,0) NOT NULL DEFAULT 0,
  usable_balance NUMERIC(14,0) NOT NULL DEFAULT 0,
  refund_balance NUMERIC(14,0) NOT NULL DEFAULT 0,
  point_balance NUMERIC(14,0) NOT NULL DEFAULT 0,
  refund_bank_name VARCHAR(80),
  refund_account_no VARCHAR(120),
  refund_account_holder VARCHAR(120),
  cafe24_raw_json JSONB,
  password_hash TEXT,
  password_algo VARCHAR(40),
  password_updated_at TIMESTAMP,
  password_migrated VARCHAR(1) NOT NULL DEFAULT 'N',
  last_sync_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (member_id)
);



-- Future Glomart independent login preparation.
-- Plain passwords must never be stored. Only Argon2id hash metadata is stored.
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS password_algo VARCHAR(40);
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS password_updated_at TIMESTAMP;
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS password_migrated VARCHAR(1) NOT NULL DEFAULT 'N';

CREATE TABLE IF NOT EXISTS gm_member_ledger (
  ledger_id VARCHAR(40) NOT NULL,
  member_id VARCHAR(80) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  type VARCHAR(40) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'confirmed',
  order_no VARCHAR(60),
  related_member_id VARCHAR(80),
  description VARCHAR(255),
  deposit_charge_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
  bonus_grant_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
  deposit_use_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
  bonus_use_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
  refund_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
  point_grant_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
  point_use_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
  commission_amount NUMERIC(14,0) NOT NULL DEFAULT 0,
  commission_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  bank_name VARCHAR(80),
  bank_account_no VARCHAR(120),
  bank_account_holder VARCHAR(120),
  deposit_balance_after NUMERIC(14,0) NOT NULL DEFAULT 0,
  bonus_balance_after NUMERIC(14,0) NOT NULL DEFAULT 0,
  usable_balance_after NUMERIC(14,0) NOT NULL DEFAULT 0,
  refund_balance_after NUMERIC(14,0) NOT NULL DEFAULT 0,
  point_balance_after NUMERIC(14,0) NOT NULL DEFAULT 0,
  admin_memo TEXT,
  created_by VARCHAR(80),
  PRIMARY KEY (ledger_id)
);

-- V002 safety: existing gm_member table may have been created before cafe24_raw_json was added.
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS cafe24_raw_json JSONB;
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS cafe24_member_id VARCHAR(80);
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS recommender_id VARCHAR(80);
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS deposit_balance NUMERIC(14,0) NOT NULL DEFAULT 0;
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS bonus_balance NUMERIC(14,0) NOT NULL DEFAULT 0;
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS usable_balance NUMERIC(14,0) NOT NULL DEFAULT 0;
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS refund_balance NUMERIC(14,0) NOT NULL DEFAULT 0;
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS point_balance NUMERIC(14,0) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_gm_member_recommender_id
  ON gm_member (recommender_id);

CREATE INDEX IF NOT EXISTS idx_gm_member_ledger_member_created
  ON gm_member_ledger (member_id, created_at);

CREATE INDEX IF NOT EXISTS idx_gm_member_ledger_order_no
  ON gm_member_ledger (order_no);

CREATE INDEX IF NOT EXISTS idx_gm_member_ledger_type_status
  ON gm_member_ledger (type, status);

CREATE INDEX IF NOT EXISTS idx_gm_member_cafe24_raw_json_gin
  ON gm_member USING GIN (cafe24_raw_json);
