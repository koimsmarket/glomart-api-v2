(function () {
  'use strict';
  const U = window.GMAO_UTIL;
  const Q = window.GM_AUTO_ORDER_QUEUE;

  const CPKR = {
    async run(order) {
      U.log('CPKR process start', order.order_id || '');
      const items = Array.isArray(order.items) ? order.items.filter(x => (x.source_mall || order.source_mall) === 'CPKR') : [];
      if (!items.length) throw new Error('CPKR items empty');

      // 1. 주문 시작 전 딱 1회. 장바구니 숫자 확인과 필요시 초기화는 이 파일 하나가 담당.
      Q.setState({ phase: 'cart_clear', order_id: order.order_id || '' });
      await window.CPKR_CART_CLEAR.run(order);

      // 2. 상품 상세 진입 + 옵션/수량 + 장바구니 담기 반복.
      for (let i = 0; i < items.length; i++) {
        Q.setState({ phase: 'product_add', item_index: i, source_key: items[i].source_key || '' });
        await window.CPKR_PRODUCT.addItem(items[i], order, i);
      }

      // 3. 장바구니 검증 + 총 상품 구매하기. 여기부터 checkout까지 about:blank 금지.
      Q.setState({ phase: 'cart_order' });
      await window.CPKR_CART.verifyAndOrder(items, order);

      // 4. 주문서 입력 + 결제하기 직전 정지.
      Q.setState({ phase: 'checkout' });
      await window.CPKR_CHECKOUT.fillAndStop(order);

      Q.setState({ phase: 'stopped_before_payment' });
      U.log('CPKR stopped before payment');
      return { ok: true, stopped_before_payment: true };
    },
    finishAndBlank() {
      // 한 주문이 사람이 결제/보류 처리로 끝난 뒤 다음 주문 시작 전만 사용.
      Q.setState({ phase: 'finished_blank' });
      U.goBlank();
    }
  };

  window.GM_AUTO_ORDER_CPKR = CPKR;
})();
