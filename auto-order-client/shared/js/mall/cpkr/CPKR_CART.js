(function () {
  'use strict';
  const U = window.GMAO_UTIL;

  const DOM = {
    orderButton() {
      // 캡처 확정 DOM: “총 2개 상품 구매하기”
      return U.qsAll('button,a').find(el => U.visible(el) && /총\s*\d+\s*개\s*상품\s*구매하기/.test(U.txt(el))) ||
        U.findButtonByText(['상품 구매하기', '구매하기']);
    },
    selectedAll() {
      return U.findByText('label,span,div', '전체 선택');
    },
    bodyText() { return U.txt(document.body); }
  };

  async function openCart() {
    if (!/cart\.coupang\.com/.test(location.hostname)) location.href = 'https://cart.coupang.com/cartView.pang';
    await U.waitFor(() => /cart\.coupang\.com/.test(location.hostname), { timeout: 10000, label: 'cart location' });
    await U.waitFor(() => DOM.orderButton(), { timeout: 12000, label: 'order button' });
  }

  const MOD = {
    async verifyAndOrder(items, order) {
      U.log('cart verify/order start');
      await openCart();
      const text = DOM.bodyText();
      const missing = [];
      for (const it of items) {
        const name = it.product_name || it.title || '';
        if (name && !text.includes(name.slice(0, Math.min(10, name.length)))) missing.push(name);
      }
      if (missing.length) U.warn('cart weak verify missing', missing);
      const btn = await U.waitFor(() => DOM.orderButton(), { timeout: 6000, label: '총 상품 구매하기' });
      // 장바구니→주문/결제는 about:blank 절대 금지. 쿠팡 버튼 클릭으로만 이동.
      U.click(btn, '총 상품 구매하기');
      await U.waitFor(() => /checkout\.coupang\.com/.test(location.hostname), { timeout: 12000, label: 'checkout location' });
      return { ok: true };
    },
    DOM
  };

  window.CPKR_CART = MOD;
})();
