-- 41_gm_smartfit_subscribe.sql
-- Creator subscription and SmartFit message acceptance.
-- No timestamps: subscription existence and message_accept_yn are the only required state.

CREATE TABLE IF NOT EXISTS gm_smartfit_subscribe (
  member_id VARCHAR(80) NOT NULL,
  creator_member_id VARCHAR(80) NOT NULL,
  message_accept_yn CHAR(1) NOT NULL DEFAULT 'Y',
  PRIMARY KEY (member_id, creator_member_id),
  CONSTRAINT chk_gm_smartfit_subscribe_message_accept
    CHECK (message_accept_yn IN ('Y','N')),
  CONSTRAINT chk_gm_smartfit_subscribe_not_self
    CHECK (member_id <> creator_member_id)
);

CREATE INDEX IF NOT EXISTS idx_gm_smartfit_subscribe_creator_accept
  ON gm_smartfit_subscribe (creator_member_id, message_accept_yn, member_id);
