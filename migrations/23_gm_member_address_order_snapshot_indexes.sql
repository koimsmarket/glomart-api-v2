-- 23_gm_member_address_order_snapshot_indexes.sql
-- Purpose: finalize member default delivery fields, address book query indexes, and order-time address snapshot fields.

ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS default_receiver_name VARCHAR(120);
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS default_receiver_phone VARCHAR(40);
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS default_receiver_mobile VARCHAR(40);
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS default_zipcode VARCHAR(20);
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS default_address1 TEXT;
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS default_address2 TEXT;
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS default_address_old TEXT;
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS default_address_full TEXT;
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS default_sido VARCHAR(80);
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS default_sigungu VARCHAR(120);
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS default_eup_myeon_dong VARCHAR(120);
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS customs_clearance_code VARCHAR(80);
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS delivery_memo TEXT;

CREATE TABLE IF NOT EXISTS gm_member_address (
  address_id VARCHAR(40) NOT NULL,
  member_id VARCHAR(80) NOT NULL,
  address_name VARCHAR(80),
  receiver_name VARCHAR(120),
  receiver_phone VARCHAR(40),
  receiver_mobile VARCHAR(40),
  zipcode VARCHAR(20),
  address1 TEXT,
  address2 TEXT,
  address_old TEXT,
  address_full TEXT,
  sido VARCHAR(80),
  sigungu VARCHAR(120),
  eup_myeon_dong VARCHAR(120),
  customs_clearance_code VARCHAR(80),
  delivery_memo TEXT,
  is_default VARCHAR(1) NOT NULL DEFAULT 'N',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (address_id)
);

ALTER TABLE gm_member_address ADD COLUMN IF NOT EXISTS receiver_phone VARCHAR(40);
ALTER TABLE gm_member_address ADD COLUMN IF NOT EXISTS receiver_mobile VARCHAR(40);
ALTER TABLE gm_member_address ADD COLUMN IF NOT EXISTS zipcode VARCHAR(20);
ALTER TABLE gm_member_address ADD COLUMN IF NOT EXISTS address1 TEXT;
ALTER TABLE gm_member_address ADD COLUMN IF NOT EXISTS address2 TEXT;
ALTER TABLE gm_member_address ADD COLUMN IF NOT EXISTS address_old TEXT;
ALTER TABLE gm_member_address ADD COLUMN IF NOT EXISTS address_full TEXT;
ALTER TABLE gm_member_address ADD COLUMN IF NOT EXISTS sido VARCHAR(80);
ALTER TABLE gm_member_address ADD COLUMN IF NOT EXISTS sigungu VARCHAR(120);
ALTER TABLE gm_member_address ADD COLUMN IF NOT EXISTS eup_myeon_dong VARCHAR(120);
ALTER TABLE gm_member_address ADD COLUMN IF NOT EXISTS delivery_memo TEXT;

CREATE INDEX IF NOT EXISTS idx_gm_member_address_member_id
  ON gm_member_address (member_id);
CREATE INDEX IF NOT EXISTS idx_gm_member_address_region
  ON gm_member_address (sido, sigungu, eup_myeon_dong);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gm_member_address_member_default
  ON gm_member_address (member_id)
  WHERE is_default = 'Y';

ALTER TABLE gm_order ADD COLUMN IF NOT EXISTS receiver_address_old TEXT;
ALTER TABLE gm_order ADD COLUMN IF NOT EXISTS receiver_address_full TEXT;
ALTER TABLE gm_order ADD COLUMN IF NOT EXISTS receiver_sido VARCHAR(80);
ALTER TABLE gm_order ADD COLUMN IF NOT EXISTS receiver_sigungu VARCHAR(120);
ALTER TABLE gm_order ADD COLUMN IF NOT EXISTS receiver_eup_myeon_dong VARCHAR(120);
