GM_SMARTFIT_SERVER_V004

기준
- GM_SMARTFIT_SERVER_DESIGN_V003 기준으로 SmartFit 전용 파일만 수정.
- 상품/카테고리/빌더/장바구니/주문 테이블 및 라우트는 수정하지 않음.

수정 파일
- migrations/24_gm_smartfit.sql
- routes/smartfit.js
- mobile/smartfit/create.html
- module/json/GM_CONTENT_TRANSLATE.js
- module/smartfit/GM_SMARTFIT.js
- module/smartfit/GM_SMARTFIT_SEARCH.js

핵심 변경
1. 언어
- 저장 기준: 작성자 선택 gm_lang 원문.
- source_lang 필수.
- 제목/소개글/검색어는 *_source 및 description/search_source에 원문 저장.
- 한국어 보조 검색값만 title_ko/search_ko로 저장.
- 25개 언어 컬럼 및 GM_PRODUCT_TRANSLATE.js 사용 제거.
- GM_CONTENT_TRANSLATE.js 사용 고정.

2. 이미지/R2
- DB에 이미지 URL 저장 안 함.
- image_count만 저장.
- 서버가 규칙으로 image_path/small_path 및 R2 public base가 있으면 image_url/small_url 생성.
- 환경변수 후보: R2_PUBLIC_BASE, GM_R2_PUBLIC_BASE, SMARTFIT_R2_PUBLIC_BASE.
- 현재 버킷/키가 없으므로 업로드 자체는 보류. URL 저장 API는 disabled.

3. R2 경로 규칙
- space/A00000001/image/I0001A.webp
- space/A00000001/small/I0001A.webp
- template/A00000001/image/T0001A.webp
- template/A00000001/small/T0001A.webp
- 200개 단위 폴더. 객체당 최대 5장(A~E).

주의
- 기존 DB에 과거 컬럼(template_title_en/search_en/image_url/youtube_url 등)이 남아 있을 수 있으나 V004 라우트는 사용하지 않음.
- 운영 전에는 migration 실행 후 /api/gm/smartfit/health 확인.
