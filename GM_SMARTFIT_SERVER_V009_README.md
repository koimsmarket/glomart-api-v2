# GM_SMARTFIT_SERVER_V009

수정 파일만 포함한 ZIP입니다.

## 반영 내용

- SmartFit Template 원본 복제 금지: 사용자는 `template_id`만 참조합니다.
- Template 실행 시 원본 상품목록을 기준으로 사용자의 장바구니에만 옮겨 담는 구조입니다.
- Space / Template / Item 모두 휴지통 정책 적용:
  - 삭제 = `is_deleted='T'`, `deleted_at`, `deleted_by` 기록
  - 삭제 시 검색 노출 중단: `search_visible='F'`
  - 복원 가능
  - 영구삭제는 휴지통에서만 가능
  - 타인이 이미 사용하는 Template/Space/Item은 영구삭제 차단
- Space 작성자 정책 반영:
  - 회원 ID는 항상 공개 기준
  - Space별 `author_nickname` 별도 저장
  - `member_nickname`을 기본값으로 사용 가능
  - 실명은 `real_name_public='T'`일 때만 표시
- `gm_member.member_nickname` 컬럼 추가
- SmartFit 저장/공간/휴지통 관련 API 보강

## 수정 파일

```text
migrations/07_gm_member_wallet.sql
migrations/24_gm_smartfit.sql
routes/smartfit.js
GM_SMARTFIT_SERVER_V009_README.md
```

## 주의

현재 운영 데이터가 없다는 전제에서 `24_gm_smartfit.sql`은 V009 기준 구조로 정리했습니다. 기존 데이터가 생긴 뒤에는 삭제/재생성보다 ALTER 마이그레이션 방식으로 가야 합니다.
