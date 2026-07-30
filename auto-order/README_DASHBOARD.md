# GM_AUTO_ORDER_DASHBOARD_V006

V005 기준. Cafe24 주문 대시보드의 검증된 화면 구조를 참고하여
Glomart 대시보드를 같은 순서와 정보 밀도로 재구성했습니다.

## V006 주요 변경
- 상단 조건검색 추가
- 실시간 매출 현황을 Cafe24 구조처럼 변경
  - 총 주문 금액
  - 총 실 결제 금액
  - 총 환불 금액
  - 오늘 / 이번 달 / 바로가기
- 오늘의 할 일 추가
- 오늘 처리한 일 추가
- Glomart 전용 자동주문 운영 현황은 별도 카드로 유지
- Cafe24 HTML/JS/CSS 내부 코드는 복사하지 않고 신규 작성

## 외부몰 접속 원칙
서버는 쿠팡/알리에 직접 접속하지 않습니다.
실제 외부몰 작업은 지정 관리자 PC 또는 Android 클라이언트가 수행합니다.


## V007 데이터 연결
신규 서버 라우트:
- GET /api/auto-order/dashboard/summary
- GET /api/auto-order/dashboard/clients
- GET /api/auto-order/dashboard/attention

현재 summary/attention은 gm_order / gm_order_item을 실제 조회합니다.
DB 스키마 차이에 대응하기 위해 존재하는 컬럼만 동적으로 사용합니다.

실행기(client) 데이터는 아직 서버 Client Registry가 없으므로 빈 배열을 반환합니다.
다음 자동주문 연결 단계에서 PC PWA / Android 실행기 heartbeat와 함께 연결합니다.
