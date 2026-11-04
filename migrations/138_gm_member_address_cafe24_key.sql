-- GM_CAFE24_ADDRESS_KEY_V008 / migration 138
-- MANUAL EXECUTION ONLY. No preexisting data is modified or deleted.
ALTER TABLE gm_member_address ADD COLUMN IF NOT EXISTS cafe24_ma_idx VARCHAR(20);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gm_member_address_member_cafe24_ma_idx
  ON gm_member_address(member_id,cafe24_ma_idx)
  WHERE cafe24_ma_idx IS NOT NULL;
