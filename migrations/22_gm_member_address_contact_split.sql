-- 22_gm_member_address_contact_split.sql
-- Purpose: split receiver contact into 일반전화/휴대전화 and keep delivery memo on both member default address and address book.

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
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS delivery_memo TEXT;

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

ALTER TABLE gm_order ADD COLUMN IF NOT EXISTS receiver_address_old TEXT;
ALTER TABLE gm_order ADD COLUMN IF NOT EXISTS receiver_address_full TEXT;
ALTER TABLE gm_order ADD COLUMN IF NOT EXISTS receiver_sido VARCHAR(80);
ALTER TABLE gm_order ADD COLUMN IF NOT EXISTS receiver_sigungu VARCHAR(120);
ALTER TABLE gm_order ADD COLUMN IF NOT EXISTS receiver_eup_myeon_dong VARCHAR(120);
