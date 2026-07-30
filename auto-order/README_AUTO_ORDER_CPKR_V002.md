# Glomart Auto Order CPKR V002

## 확정 원칙

- 서버 API 직접 호출 없음. PC Tampermonkey/나중에 Android WebView에서 동일 JS 사용.
- `auto-order/`는 `glomart-api-v2` root 아래 배치.
- 장바구니 숫자 확인 + 필요시 초기화는 `CPKR_CART_CLEAR.js`가 주문 시작 전 딱 1회만 수행.
- 상품 상세 진입 전은 `about:blank` 허용.
- 장바구니 담기 이후 `cart -> checkout` 내부 흐름은 `about:blank` 절대 금지.
- 결제하기 버튼은 자동 클릭하지 않고 빨간 outline 표시 후 정지.
- 한 주문을 사람이 결제/보류 처리한 뒤 다음 주문 시작 전에만 `window.GMAO_NEXT_BLANK()` 사용.

## 파일 구조

```text
auto-order/
├── GM_AUTO_ORDER.user.js
├── README.md
└── js/
    ├── GM_AUTO_ORDER_CORE.js
    ├── GM_AUTO_ORDER_QUEUE.js
    ├── GM_AUTO_ORDER_UTIL.js
    └── cpkr/
        ├── GM_AUTO_ORDER_CPKR.js
        ├── CPKR_CART_CLEAR.js
        ├── CPKR_PRODUCT.js
        ├── CPKR_CART.js
        └── CPKR_CHECKOUT.js
```

## 실행

```js
window.GMAO_SET_ORDER(payload);
window.GMAO_START();
```

## payload 예시

```js
{
  source_mall: 'CPKR',
  order_id: 'ORDER_TEST_001',
  receiver: {
    name: '홍길동',
    phone: '01012345678',
    zipcode: '16485',
    road_query: '중부대로 184',
    road_address: '경기도 수원시 팔달구 중부대로 184-24',
    jibun_address: '경기도 수원시 팔달구 인계동 326-9',
    detail_address: '101호',
    memo: '문 앞'
  },
  payment_text: '계좌이체',
  items: [
    {
      source_mall: 'CPKR',
      source_url: 'https://www.coupang.com/vp/products/60867163?itemId=17098034962&vendorItemId=92530966752',
      source_key: 'CPKR_60867163_17098034962_92530966752',
      product_name: '오뚜기 콤비네이션피자 415g, 5개',
      option_name: '415g, 5개',
      quantity: 1
    }
  ]
}
```
