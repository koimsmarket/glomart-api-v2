GM_SMARTFIT_SERVER_V006

수정 범위: SmartFit 전용 파일만 수정.
수정 금지 유지: gm_product/gm_category/builder/gm_basket/gm_orders/gm_order_items 및 관련 상품/카테고리/빌더/주문 흐름.

반영 내용:
1) create.html
- GM_PRODUCT_TRANSLATE.js 호출 제거, GM_CONTENT_TRANSLATE.js 기준 고정.
- 현재 작성언어=헤더 국기바 gm_lang 안내 추가.
- 작성자 닉네임 표시/입력명 수정, 회원 닉네임 기본값 후 수정 가능.
- 카테고리/공개여부/보관공간 선택 즉시 선택값 표시.
- 링크 ? 안내 및 허용 사이트 안내 추가.
- 소개글 ? 안내 추가, URL/연락처/광고/구매유도 차단.
- Android WebView 사진 선택 버튼을 display:none label 방식에서 버튼 click/touch 방식으로 변경.
- 이미지 최대 5장, JPG/PNG/WEBP 입력 허용, WebP 변환, 1장 300KB 이하, EXIF 제거 효과(캔버스 재인코딩), image_count만 저장.
- 입력 실시간 localStorage 임시저장, 재진입 시 복구 확인, 저장 성공 시 임시값 삭제.
- /api/gm/smartfit/space/save 또는 /template/save 실제 호출 연결.

2) routes/smartfit.js
- source_lang 원문 저장 기준.
- 링크 link01~link06 화이트리스트 서버 검증.
- 소개글 URL/연락처/HTML/구매유도 서버 검증.
- image_count만 저장, R2 경로는 규칙으로 계산해 응답.
- space/list, template/list 500 방지를 위해 V003/V013 컬럼 기준으로 정리.
- build-cart는 장바구니/주문 테이블 미수정, 후보 payload만 반환.

3) 24_gm_smartfit.sql
- source_lang, *_source, *_ko, search_source/search_ko, image_count, link01~link06 기준.
- 기존 구형 컬럼 데이터는 가능한 범위에서 신규 컬럼으로 이관 후 구형 다국어/URL 컬럼 제거.
- 상품/카테고리/빌더/주문/장바구니 테이블 수정 없음.

4) GM_SMARTFIT.js / GM_SMARTFIT_CREATE.js
- GM_CONTENT_TRANSLATE.translateText(text, sourceLang, targetLang) 호출 기준 보정.
- GM_PRODUCT_TRANSLATE fallback 제거.
- 구형 다국어 컬럼 기반 저장 헬퍼 제거.

주의:
- 실제 R2 업로드는 Cloudflare 계정/버킷/공개 도메인/키 등록 후 별도 연결 필요.
- 현재 생성 화면은 이미지 파일을 WebP 300KB 이하로 최적화하고 image_count를 저장하는 단계까지 반영.
