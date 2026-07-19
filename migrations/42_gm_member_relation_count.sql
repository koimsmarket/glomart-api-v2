-- 42_gm_member_relation_count.sql
-- Precalculated SmartFit relation assets. gm_member is not updated/locked for these counters.
-- The existing event counter chain calculates this once at member registration and repairs rows where calculated_yn='F'.

CREATE TABLE IF NOT EXISTS gm_member_relation_count (
  member_id VARCHAR(80) PRIMARY KEY,

  up_1_count BIGINT NOT NULL DEFAULT 0,
  up_2_count BIGINT NOT NULL DEFAULT 0,
  up_3_count BIGINT NOT NULL DEFAULT 0,
  up_4_count BIGINT NOT NULL DEFAULT 0,
  up_5_count BIGINT NOT NULL DEFAULT 0,
  up_total_count BIGINT NOT NULL DEFAULT 0,

  down_1_count BIGINT NOT NULL DEFAULT 0,
  down_2_count BIGINT NOT NULL DEFAULT 0,
  down_3_count BIGINT NOT NULL DEFAULT 0,
  down_4_count BIGINT NOT NULL DEFAULT 0,
  down_5_count BIGINT NOT NULL DEFAULT 0,
  down_total_count BIGINT NOT NULL DEFAULT 0,

  message_accept_relation_depth SMALLINT NOT NULL DEFAULT 5,
  calculated_yn CHAR(1) NOT NULL DEFAULT 'F',

  CONSTRAINT chk_gm_member_relation_count_nonnegative CHECK (
    up_1_count >= 0 AND up_2_count >= 0 AND up_3_count >= 0 AND up_4_count >= 0 AND up_5_count >= 0 AND up_total_count >= 0 AND
    down_1_count >= 0 AND down_2_count >= 0 AND down_3_count >= 0 AND down_4_count >= 0 AND down_5_count >= 0 AND down_total_count >= 0
  ),
  CONSTRAINT chk_gm_member_relation_message_depth
    CHECK (message_accept_relation_depth BETWEEN 0 AND 5),
  CONSTRAINT chk_gm_member_relation_calculated
    CHECK (calculated_yn IN ('T','F'))
);

CREATE INDEX IF NOT EXISTS idx_gm_member_relation_count_calculated
  ON gm_member_relation_count (calculated_yn, member_id);
