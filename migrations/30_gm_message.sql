-- 30_gm_message.sql
-- Glomart message system V002 consolidated initial creation
-- 3 separated flows:
-- 1) Glomart -> personal member
-- 2) Glomart -> broadcast/group message
-- 3) Member -> member/network share message
-- Expiry is controlled by gm_message_policy.retention_days + created_at, not expired_at.

ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS allow_message_personal CHAR(1) NOT NULL DEFAULT 'Y';
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS allow_message_broadcast CHAR(1) NOT NULL DEFAULT 'Y';
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS allow_message_ad CHAR(1) NOT NULL DEFAULT 'Y';
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS allow_message_share CHAR(1) NOT NULL DEFAULT 'Y';
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS notification_timezone_code VARCHAR(80) NOT NULL DEFAULT 'Asia/Seoul';
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS notification_timezone_label VARCHAR(80) NOT NULL DEFAULT 'KST (UTC+09:00)';
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS notification_time_start TIME NOT NULL DEFAULT '09:00';
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS notification_time_end TIME NOT NULL DEFAULT '21:00';

ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS message_send_chon_max INTEGER NOT NULL DEFAULT 1;
ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS message_send_grade INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS gm_message_policy (
  message_type VARCHAR(50) NOT NULL PRIMARY KEY,
  retention_days INTEGER NOT NULL DEFAULT 30,
  track_receive CHAR(1) NOT NULL DEFAULT 'N',
  track_read CHAR(1) NOT NULL DEFAULT 'Y',
  track_click CHAR(1) NOT NULL DEFAULT 'N',
  is_security CHAR(1) NOT NULL DEFAULT 'N',
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO gm_message_policy (message_type, retention_days, track_receive, track_read, track_click, is_security, note)
VALUES
  ('ORDER_SECURITY',365,'Y','Y','Y','Y','Deposit order security notice; immediate regardless of quiet hours'),
  ('SECURITY',365,'Y','Y','Y','Y','Security notice; immediate regardless of quiet hours'),
  ('ORDER',180,'Y','Y','N','N','Order message'),
  ('DELIVERY',180,'Y','Y','N','N','Delivery message'),
  ('CS',180,'Y','Y','N','N','Customer service answer'),
  ('SMARTFIT',60,'N','Y','Y','N','Glomart to member SmartFit status'),
  ('SMARTFIT_SHARE',30,'N','Y','Y','N','Member to member SmartFit template share'),
  ('SMARTFIT_TEMPLATE',30,'N','Y','Y','N','Member to member SmartFit template share'),
  ('NOTICE',30,'N','N','N','N','Simple broadcast notice; receive tracking optional per message'),
  ('ADVERTISEMENT',30,'Y','N','Y','N','Ad efficiency counts, default 30 days'),
  ('JOB',30,'Y','Y','Y','N','Job/living information broadcast'),
  ('COMMUNITY',30,'N','Y','Y','N','Community information'),
  ('SYSTEM',7,'N','N','N','N','Temporary system notice')
ON CONFLICT (message_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS gm_message_personal (
  id BIGSERIAL PRIMARY KEY,
  message_no VARCHAR(32) NOT NULL UNIQUE,
  member_id VARCHAR(80) NOT NULL,
  message_type VARCHAR(50) NOT NULL,
  title VARCHAR(200) NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  move_type VARCHAR(50),
  move_value VARCHAR(120),
  action_json JSONB,
  priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  is_read CHAR(1) NOT NULL DEFAULT 'N',
  read_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gm_message_personal_member_created
  ON gm_message_personal (member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_message_personal_type_created
  ON gm_message_personal (message_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_message_personal_unread
  ON gm_message_personal (member_id, is_read, created_at DESC);

CREATE TABLE IF NOT EXISTS gm_message_broadcast (
  id BIGSERIAL PRIMARY KEY,
  broadcast_no VARCHAR(32) NOT NULL UNIQUE,
  message_type VARCHAR(50) NOT NULL,
  title VARCHAR(200) NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  target_rule_json JSONB,
  move_type VARCHAR(50),
  move_value VARCHAR(120),
  action_json JSONB,
  track_receive CHAR(1) NOT NULL DEFAULT 'N',
  track_read CHAR(1) NOT NULL DEFAULT 'N',
  track_click CHAR(1) NOT NULL DEFAULT 'N',
  send_count INTEGER NOT NULL DEFAULT 0,
  receive_count INTEGER NOT NULL DEFAULT 0,
  read_count INTEGER NOT NULL DEFAULT 0,
  click_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  start_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  end_at TIMESTAMP,
  created_by VARCHAR(80),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gm_message_broadcast_status_start
  ON gm_message_broadcast (status, start_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_message_broadcast_type_created
  ON gm_message_broadcast (message_type, created_at DESC);

CREATE TABLE IF NOT EXISTS gm_message_broadcast_receive (
  broadcast_no VARCHAR(32) NOT NULL,
  member_id VARCHAR(80) NOT NULL,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TIMESTAMP,
  clicked_at TIMESTAMP,
  PRIMARY KEY (broadcast_no, member_id)
);

CREATE INDEX IF NOT EXISTS idx_gm_message_broadcast_receive_member
  ON gm_message_broadcast_receive (member_id, received_at DESC);

CREATE TABLE IF NOT EXISTS gm_message_share (
  id BIGSERIAL PRIMARY KEY,
  share_no VARCHAR(32) NOT NULL UNIQUE,
  sender_member_id VARCHAR(80) NOT NULL,
  share_type VARCHAR(50) NOT NULL DEFAULT 'SMARTFIT_TEMPLATE',
  ref_no VARCHAR(120),
  title VARCHAR(200) NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  target_rule_json JSONB,
  move_type VARCHAR(50),
  move_value VARCHAR(120),
  target_chon_max INTEGER NOT NULL DEFAULT 1,
  target_count INTEGER NOT NULL DEFAULT 0,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  read_count INTEGER NOT NULL DEFAULT 0,
  click_count INTEGER NOT NULL DEFAULT 0,
  save_count INTEGER NOT NULL DEFAULT 0,
  reader_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  clicker_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  saver_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gm_message_share_sender_created
  ON gm_message_share (sender_member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_message_share_type_created
  ON gm_message_share (share_type, created_at DESC);


CREATE TABLE IF NOT EXISTS gm_message_share_receiver (
  id BIGSERIAL PRIMARY KEY,
  share_no VARCHAR(32) NOT NULL,
  sender_member_id VARCHAR(80) NOT NULL,
  ref_no VARCHAR(120) NOT NULL,
  receiver_member_id VARCHAR(80) NOT NULL,
  chon_depth INTEGER NOT NULL DEFAULT 1,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TIMESTAMP,
  clicked_at TIMESTAMP,
  saved_at TIMESTAMP,
  UNIQUE (sender_member_id, ref_no, receiver_member_id)
);

CREATE INDEX IF NOT EXISTS idx_gm_message_share_receiver_share
  ON gm_message_share_receiver (share_no, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_message_share_receiver_receiver
  ON gm_message_share_receiver (receiver_member_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_message_share_receiver_template
  ON gm_message_share_receiver (sender_member_id, ref_no, receiver_member_id);



-- SmartFit space subscription: visitors can subscribe to a space and receive future template messages.
-- Minimal structure by design: space serial number + member id + timestamps.
CREATE TABLE IF NOT EXISTS gm_smartfit_space_subscriber (
  space_no VARCHAR(80) NOT NULL,
  member_id VARCHAR(80) NOT NULL,
  subscribed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unsubscribed_at TIMESTAMP,
  active_yn CHAR(1) NOT NULL DEFAULT 'Y',
  PRIMARY KEY (space_no, member_id)
);

CREATE INDEX IF NOT EXISTS idx_gm_smartfit_space_subscriber_member
  ON gm_smartfit_space_subscriber (member_id, active_yn, subscribed_at DESC);
CREATE INDEX IF NOT EXISTS idx_gm_smartfit_space_subscriber_space
  ON gm_smartfit_space_subscriber (space_no, active_yn, subscribed_at DESC);

CREATE TABLE IF NOT EXISTS gm_message_counter_daily (
  counter_date DATE NOT NULL,
  message_scope VARCHAR(30) NOT NULL,
  message_type VARCHAR(50) NOT NULL,
  send_count INTEGER NOT NULL DEFAULT 0,
  receive_count INTEGER NOT NULL DEFAULT 0,
  read_count INTEGER NOT NULL DEFAULT 0,
  click_count INTEGER NOT NULL DEFAULT 0,
  save_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (counter_date, message_scope, message_type)
);
