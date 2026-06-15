GM_MEMBER cafe24_raw_json 컬럼 누락 수정 패치

원인:
- 기존 DB에 gm_member 테이블이 이미 존재하면 CREATE TABLE IF NOT EXISTS 내부의 cafe24_raw_json 컬럼 생성이 실행되지 않음.
- 이후 07_gm_member_wallet.sql 마지막의 GIN INDEX 생성에서 cafe24_raw_json 컬럼을 참조하여 서버 DB 초기화가 실패함.

수정:
- migrations/07_gm_member_wallet.sql 안에 아래 구문을 인덱스 생성 전에 추가함.
  ALTER TABLE gm_member ADD COLUMN IF NOT EXISTS cafe24_raw_json JSONB;

적용:
- 서버의 기존 migrations/07_gm_member_wallet.sql 파일을 이 파일로 교체 후 재배포.
