-- 45_gm_member_recommender_attach_columns.sql
-- 기존 44번 Migration의 실행 여부와 무관하게 추천인 최초 추가/관계 계산용 컬럼을 보강한다.
-- 이미 컬럼과 인덱스가 존재하는 환경에서도 재실행할 수 있다.

ALTER TABLE gm_member
  ADD COLUMN IF NOT EXISTS recommender_updated_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS relation_calculated_yn CHAR(1) NOT NULL DEFAULT 'Y';

ALTER TABLE gm_member
  DROP CONSTRAINT IF EXISTS chk_gm_member_relation_calculated_yn;

ALTER TABLE gm_member
  ADD CONSTRAINT chk_gm_member_relation_calculated_yn
  CHECK (relation_calculated_yn IN ('Y','N'));

UPDATE gm_member
SET relation_calculated_yn='Y'
WHERE relation_calculated_yn IS NULL;

CREATE INDEX IF NOT EXISTS idx_gm_member_relation_pending
  ON gm_member (relation_calculated_yn, recommender_updated_at, member_id)
  WHERE relation_calculated_yn='N';
