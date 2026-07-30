# GM_AUTO_ORDER_COMPLETE_V015

V015 기준 전체 auto-order 폴더입니다.

## 대시보드 데이터 연결
현재 Glomart 운영 스키마를 기준으로 집계합니다.

### 주문/결제
- 총 주문 금액: gm_order.total_payment_price
- 총 실 결제 금액: gm_order.actual_payment_amount + payment_status
- 환불 건/금액: payment_status=refunded 기준
  - 현재 gm_order에 전용 refund_amount가 없으므로 actual_payment_amount를 사용하고,
    값이 없을 때 total_payment_price를 보조값으로 사용합니다.

### 배송
- gm_order.shipping_status:
  pending / preparing / shipped / in_transit / delivered / returned
- gm_order_item.item_shipping_status도 함께 사용합니다.
- 송장 미확보: shipped/in_transit인데 tracking_number가 없는 주문
- 배송지연: shipped/in_transit 상태가 7일 이상 지속된 주문

### 취소/교환/반품/CS
- gm_order.cancel_status:
  none / requested / completed / rejected
- gm_cs:
  cs_type = cs / return / exchange / cancel / refund / delivery / payment
  cs_status = requested / processing / return_shipping / return_received /
              return_confirmed / reshipped / completed / cancelled

### 자동주문
- READY_TO_ORDER / ordered / pending / waiting → 자동주문대기
- AUTO_ORDERED / ORDERED_AT_MALL / PURCHASED /
  PAYMENT_WAITING / STOPPED_BEFORE_PAYMENT / COMPLETED / DONE → 자동주문 처리상태
- FAILED / LOGIN_REQUIRED / PRICE_CHANGED / OUT_OF_STOCK 등 예외 상태도 집계합니다.

주의:
현재 PC/Android 실행기 heartbeat/client registry는 아직 서버 DB에 없으므로
실행기 온라인 / 쿠팡 준비 / 알리 준비는 계속 0입니다.
이 부분은 쿠팡 자동주문 후처리 단계에서 별도 Client Registry로 연결합니다.

## GM Safe Update Builder 연동
Builder와 주문 대시보드는 합치지 않습니다.

- 주문 대시보드: 주문/자동주문/배송/클레임 운영
- GM Safe Update Builder: DB/Queue/Worker/용량 진단 및 안전 업데이트

대신 주문 대시보드가 기존 시스템 API:
GET /api/gm/dashboard/realtime
를 읽어 다음 정보를 상단에 표시합니다.
- DB 사용률
- Builder Queue pending
- Queue failed
- API 응답시간

그리고 /gm_data_builder.html 바로가기만 제공합니다.

따라서 두 화면은 같은 서버/DB 상태를 공유하지만 서로의 HTML/JS에 의존하지 않습니다.

## 호출 구조
index.html
  -> dashboard_ui.js
     -> /api/auto-order/dashboard/summary
     -> /api/auto-order/dashboard/clients
     -> /api/auto-order/dashboard/attention
     -> /api/gm/dashboard/realtime

server.js
  -> routes/auto_order_dashboard.js
     -> services/dashboard_service.js
        -> PostgreSQL

Builder
  -> /api/gm/dashboard/realtime
  -> /api/gm/dashboard/snapshot

## 외부몰 원칙
서버는 쿠팡/알리에 직접 접속하지 않습니다.
외부몰 주문 자동화는 지정 PC/PWA/Android 클라이언트가 수행합니다.
