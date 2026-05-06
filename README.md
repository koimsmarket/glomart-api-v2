# GLOMART Client Collect + Order V6

## 핵심 구조

- 서버가 쿠팡을 직접 수집하지 않음
- 쿠팡 페이지에서 실행되는 북마클릿이 상품 정보를 읽어 서버로 전송
- 서버는 JSON 캐시에 저장
- Glomart는 캐시 검색 결과를 표시
- 주문 버튼 클릭 시 내부 주문서 생성

## 주요 URL

- `/public/collector_bookmarklet.html`
- `/public/gm_coupang_user_collector.js`
- `POST /module/scrap/api/collect`
- `GET /module/scrap/api/cache/search?q=떡볶이`
- `GET /module/scrap/api/order/list`
