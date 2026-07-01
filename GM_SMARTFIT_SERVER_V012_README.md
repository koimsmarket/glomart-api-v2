# GM_SMARTFIT_SERVER_V012

## 확정 기준
- Template 원본은 복제하지 않는다.
- 사용자는 `gm_smartfit_collection`에 `template_id`만 등록한다.
- Template는 계량/참조 도구이며 실제 구매수량·주문금액은 장바구니/주문 테이블에서만 관리한다.
- Template 통계는 조회/저장/장바구니 빌드/상품 담기/리뷰 등 사용 이벤트 기준이다.
- Space / Template / Item 삭제는 휴지통 이동이며 복원 가능하다.
- 영구삭제는 타인 참조가 없을 때만 가능하다.
- 삭제 시 검색 노출은 중지된다.
- 회원 ID와 Space별 닉네임은 항상 공개, 실명은 `real_name_public`이 T일 때만 공개한다.

## 수정 파일
- migrations/24_gm_smartfit.sql
- routes/smartfit.js

## 자동주문서팀 전달 메모
SmartFit Template는 주문 원본이 아니다. Template 실행 시 상품목록을 사용자의 장바구니 후보로 넘기고, 이후 수량 변경/삭제/주문/결제는 장바구니·주문서 흐름에서 확정한다.
