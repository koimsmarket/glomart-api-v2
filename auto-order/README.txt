Glomart Auto Order CPKR V001

목적
- PC Tampermonkey에서 먼저 실행
- 서버 API 접속 없음
- 나중에 Android WebView에 동일 JS 포함 가능

설치
1) gm_auto_order 폴더를 Cafe24 또는 별도 정적 서버에 업로드
2) GM_AUTO_ORDER.user.js의 BASE 경로 확인
3) Tampermonkey에 GM_AUTO_ORDER.user.js 등록

실행
- 콘솔에서 주문 payload 저장:
  window.GMAO_SET_ORDER(payload)
- 실행:
  window.GMAO_START()

payload 예시
{
  source_mall: 'CPKR',
  order_id: 'ORDER_TEST_001',
  receiver: {
    name: '홍길동',
    phone: '01012345678',
    zipcode: '16485',
    road_address: '경기도 수원시 팔달구 중부대로 184-24',
    road_query: '중부대로 184',
    detail_address: '101호',
    memo: '문 앞'
  },
  payment_text: '계좌이체',
  items: [
    {
      source_mall: 'CPKR',
      source_url: 'https://www.coupang.com/vp/products/...',
      source_key: 'CPKR_product_item_vendor',
      product_name: '오뚜기 콤비네이션피자 415g, 5개',
      option_name: '415g, 5개',
      quantity: 1
    }
  ]
}

주의
- 결제하기 버튼은 자동 클릭하지 않음
- 장바구니→주문/결제 이동 중 about:blank 사용 안 함
- 주문 1건 종료 후 다음 주문 시작 전 about:blank 이동은 컨트롤러/운영자가 별도 처리
