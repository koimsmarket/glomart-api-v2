-- gm_member_device: one row per FCM token.
-- member_id alone cannot receive FCM; every active token is sent independently.
CREATE TABLE IF NOT EXISTS gm_member_device (
  id BIGSERIAL PRIMARY KEY,
  member_id TEXT NOT NULL,
  fcm_token TEXT NOT NULL UNIQUE,
  device_type TEXT NOT NULL DEFAULT 'ANDROID',
  device_lang TEXT NOT NULL DEFAULT '',
  push_enabled CHAR(1) NOT NULL DEFAULT 'Y',
  token_status TEXT NOT NULL DEFAULT 'ACTIVE',
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_success_at TIMESTAMPTZ NULL,
  last_failure_at TIMESTAMPTZ NULL,
  last_error_code TEXT NOT NULL DEFAULT '',
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_gm_member_device_push_enabled CHECK (push_enabled IN ('Y','N')),
  CONSTRAINT ck_gm_member_device_token_status CHECK (token_status IN ('ACTIVE','INVALID','DISABLED'))
);

CREATE INDEX IF NOT EXISTS ix_gm_member_device_member_active
  ON gm_member_device (member_id, token_status, push_enabled);

CREATE INDEX IF NOT EXISTS ix_gm_member_device_last_seen
  ON gm_member_device (last_seen_at);

-- Member's personal overseas phone number.
-- Existing phone/default_receiver_phone/default_receiver_mobile columns remain unchanged.
ALTER TABLE gm_member
  ADD COLUMN IF NOT EXISTS international_phone TEXT NOT NULL DEFAULT '';

