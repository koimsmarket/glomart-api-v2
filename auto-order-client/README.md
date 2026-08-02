# GM_AUTO_ORDER_UNIFIED_CLIENT_V001

## 목표
하나의 공용 JavaScript 주문 엔진을 PC와 Android에서 함께 사용한다.

- PC: PWA는 관제/설치 UI, Tampermonkey는 쿠팡 DOM 실행 셸
- Android: WebView 앱이 쿠팡을 열고 같은 공용 JS 엔진을 주입
- 주문 로직은 `shared/js` 한 곳에만 존재
- 결제하기 버튼은 자동 클릭하지 않고 직전 정지

## 기존 자료에서 이식한 코드
`GM_AUTO_ORDER_CPKR_V002`의 다음 모듈을 그대로 공용 엔진으로 이식했다.

- GM_AUTO_ORDER_UTIL.js
- GM_AUTO_ORDER_QUEUE.js
- GM_AUTO_ORDER_CORE.js
- CPKR_CART_CLEAR.js
- CPKR_PRODUCT.js
- CPKR_CART.js
- CPKR_CHECKOUT.js
- GM_AUTO_ORDER_CPKR.js

## 중요한 제약
일반 PWA는 브라우저 보안 정책 때문에 `coupang.com` DOM을 직접 조작할 수 없다. 따라서 PC에서는 PWA와 매우 얇은 Tampermonkey 실행 셸을 함께 사용한다. 비즈니스 로직은 중복되지 않는다.

## 서버 API 계약
공용 런타임은 아래 경로를 기대한다. 현재 서버의 실제 API에 맞춰 다음 단계에서 매핑한다.

- POST `/api/auto-order/runtime/register`
- POST `/api/auto-order/runtime/heartbeat`
- POST `/api/auto-order/runtime/claim`
- POST `/api/auto-order/runtime/work/:workId/state`

## 배치 경로
서버 정적 경로:

`/auto-order-client/shared/js/*`
`/auto-order-client/pc-pwa/*`

## 다음 단계
1. 현재 `gm_auto_order_work` 스키마에 맞춘 runtime API 연결
2. 실행기 등록/배정/heartbeat 구현
3. 작업 payload 매핑
4. 실제 쿠팡 DOM 테스트
5. Android APK 빌드와 PWA 설치 테스트
