# GM SmartFit Server V002

## 반영 내용
- `migrations/24_gm_smartfit.sql` 추가
- `routes/smartfit.js` 추가
- `server.js`, `index.js`에 `routes/smartfit` 등록
- SmartFit Category/Template 모두 글로벌 검색어 컬럼 반영
  - `search_ko`, `search_en`, `search_gm_lang`, `search_ru`, `search_hi`, `search_fr`, `search_es`
- 통계는 `stat_type + day_01~day_31` 월별 2차원 구조
- Template = Product, Category = Product Category 개념으로 집계
- `creator_member_id`, `member_id` 이벤트 필수 축 반영
- 여러 Template 동시 장바구니 생성 지원
- 동일 상품 자동 병합 금지, Template 소속 유지
- SmartFit item에는 가격/배송/재고/배송비 저장 금지
- 공개 정책
  - 일반회원: `purchase_count >= 1` 이후 public 가능
  - 관리자: `member_grade_code`가 `9`, `09`, `ADMIN`, `MANAGER` 또는 `member_grade`가 관리자/ADMIN/MANAGER이면 구매검증 없이 public 가능

## 주요 API
- `GET /api/gm/smartfit/health`
- `GET /api/gm/smartfit/category/list`
- `GET /api/gm/smartfit/category/search?q=`
- `GET /api/gm/smartfit/template/list?q=&category_code=&member_id=&mine=1`
- `GET /api/gm/smartfit/template/:template_id`
- `POST /api/gm/smartfit/template/save`
- `POST /api/gm/smartfit/template/public`
- `POST /api/gm/smartfit/build-cart`
- `POST /api/gm/smartfit/collection/add`
- `GET /api/gm/smartfit/collection/list?member_id=`
- `POST /api/gm/smartfit/event`
- `GET /api/gm/smartfit/stat/monthly?target=template|category&ym=YYYY_MM&id=`

## 주의
- 아직 실제 Cafe24 주문완료 이벤트와 연결하지 않았다. 다음 단계에서 주문 완료/취소/반품 시점에 `/api/gm/smartfit/event`를 호출하도록 연결한다.
- `module/smartfit/` 프론트 JS는 별도 단계에서 만든다.
