# GM_SMARTFIT_SERVER_V010

## 수정 파일만 포함

- `migrations/24_gm_smartfit.sql`

## 수정 내용

- 기존 DB에 이미 `gm_smartfit_space` 테이블이 있는 경우 `owner_member_id` 컬럼 생성 전에 인덱스를 만들면서 실패하던 문제 수정.
- `owner_member_id`, `author_nickname`, `real_name_public`, `search_visible`, 휴지통 컬럼을 인덱스 생성 전에 먼저 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`로 보강.
- 신규 DB와 기존 초기 SmartFit DB 모두 같은 SQL로 실행 가능.
