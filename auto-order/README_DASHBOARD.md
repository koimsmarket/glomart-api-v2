# Glomart Auto Order Dashboard V013

## 기준 구조
- `index.html` : 대시보드 화면
- `dashboard.css` : 대시보드 전용 스타일
- `dashboard_ui.js` : 브라우저 UI/API 호출 전용
- `routes/auto_order_dashboard.js` : Express API route 전용
- `services/dashboard_service.js` : PostgreSQL 조회/집계 전용
- `sw.js` : PWA 캐시

## 호출 구조
`index.html -> dashboard_ui.js -> /api/auto-order/dashboard/* -> routes/auto_order_dashboard.js -> services/dashboard_service.js -> PostgreSQL`

## 중요 원칙
1. 서버에서 쿠팡/알리에 직접 접속하지 않는다.
2. 쿠팡/알리 접속 및 로그인/주문 실행은 관리자 PC PWA/모바일 클라이언트가 담당한다.
3. `server.js`는 공용 서버 파일이다. 대시보드 DB 로직을 넣지 않는다.
4. route에는 SQL/DB 집계 로직을 중복 작성하지 않는다.
5. 브라우저 대시보드 JS 이름은 `dashboard_ui.js` 하나만 사용한다.
6. 기존 자동주문 코어(`js/`, `js/cpkr/`, `GM_AUTO_ORDER.user.js`)는 유지한다.

## server.js 연결
운영 `server.js`에서 이 router를 한 번만 mount해야 한다.
프로젝트의 기존 Express 구성 방식에 맞춰 `auto-order/routes/auto_order_dashboard.js`를 require/use한다.
이 ZIP은 운영 `server.js`를 덮어쓰지 않는다.
