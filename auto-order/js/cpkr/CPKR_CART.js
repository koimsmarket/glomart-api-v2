(function () {
  'use strict';
  const U = window.GMAO_UTIL;

  const DOM = {
    orderButton() {
      return U.qsAll('button, a').find(el => U.visible(el) && /총\s*\d+\s*개\s*상품\s*구매하기/.test(U.txt(el))) ||
             U.findByText('button, a', '상품 구매하기');
    },
    itemText() { return U.txt(document.body); }
  };

  const MOD = {
    async verifyAndOrder(items, order) {
      if (!/cart\.coupang\.com/.test(location.hostname)) {
        location.href = 'https://cart.coupang.com/cartView.pang';
      }
      await U.waitFor(() => DOM.orderButton(), { timeout: 12000, label: 'cart order button' });
      const pageText = DOM.itemText();
      const missing = [];
      for (const it of items) {
        const name = it.product_name || it.title || '';
        if (name && !pageText.includes(name.slice(0, Math.min(12, name.length)))) missing.push(name);
      }
      if (missing.length) U.warn('cart verify weak/missing', missing);
      await U.tick();
      U.click(DOM.orderButton(), '총 상품 구매하기');
      await U.waitFor(() => /checkout\.coupang\.com/.test(location.hostname), { timeout: 10000, label: 'checkout location' });
      return { ok: true };
    }
  };

  window.CPKR_CART = MOD;
})();
