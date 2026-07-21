-- 44_gm_member_recommender_attach.sql
-- 추천인 없이 가입한 회원이 가입 후 제한 시간 안에 최초 추천인을 추가했을 때
-- 익일 새벽 2시 관계 카운터 재계산 대상으로 표시한다.

ALTER TABLE gm_member
  ADD COLUMN IF NOT EXISTS recommender_updated_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS relation_calculated_yn CHAR(1) NOT NULL DEFAULT 'Y';

ALTER TABLE gm_member
  DROP CONSTRAINT IF EXISTS chk_gm_member_relation_calculated_yn;

ALTER TABLE gm_member
  ADD CONSTRAINT chk_gm_member_relation_calculated_yn
  CHECK (relation_calculated_yn IN ('Y','N'));

CREATE INDEX IF NOT EXISTS idx_gm_member_relation_pending
  ON gm_member (relation_calculated_yn, recommender_updated_at, member_id)
  WHERE relation_calculated_yn='N';
