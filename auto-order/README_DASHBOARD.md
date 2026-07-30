# GM_AUTO_ORDER_DASHBOARD_V005

기준: V004 대시보드 구조 + 기존 auto-order 자동주문 엔진 통합.

## 대시보드/관리 화면
- index.html
- dashboard.css
- dashboard.js
- order/order.html
- auto/auto_order.html
- delivery/delivery.html
- claim/claim.html
- cs/cs.html

## 기존 자동주문 엔진
기존 파일을 삭제하지 않고 CPKR V002 기준으로 보강했습니다.
- GM_AUTO_ORDER.user.js
- js/GM_AUTO_ORDER_CORE.js
- js/GM_AUTO_ORDER_QUEUE.js
- js/GM_AUTO_ORDER_UTIL.js
- js/cpkr/GM_AUTO_ORDER_CPKR.js
- js/cpkr/CPKR_CART_CLEAR.js
- js/cpkr/CPKR_PRODUCT.js
- js/cpkr/CPKR_CART.js
- js/cpkr/CPKR_CHECKOUT.js

## 중요 보안 구조
auto-order 전체 폴더를 express.static으로 공개하지 않습니다.
server.js는 대시보드 파일과 브라우저 실행용 js/ 경로만 명시적으로 공개합니다.
향후 auto-order/routes, services, workers, migrations, credentials 등 서버 파일이 생겨도
웹에서 직접 내려받을 수 없도록 하기 위한 구조입니다.

## 외부몰 접속 원칙
서버는 쿠팡/알리에 직접 접속하지 않습니다.
PC Tampermonkey/PWA 실행기 또는 Android WebView 클라이언트가 실제 외부몰 작업을 수행합니다.
