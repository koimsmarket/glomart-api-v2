(function () {
  'use strict';
  const U = window.GMAO_UTIL;

  const DOM = {
    headerCartCount() {
      return document.querySelector('#headerCartCount') || document.querySelector('em[id="headerCartCount"]');
    },
    clearSoldOutAll() {
      return U.findByText('button,div,span,a', ['품절/판매종료상품 전체삭제', '전체삭제']);
    },
    deleteButtons() {
      return U.qsAll('button, a, div, span').filter(el => U.visible(el) && U.txt(el) === '삭제');
    },
    confirmButton() {
      const buttons = U.qsAll('button, input[type="button"], div[role="button"]');
      return buttons.find(b => U.visible(b) && U.txt(b) === '확인') ||
             U.qsAll('button').find(b => U.visible(b) && /확인/.test(U.txt(b)));
    },
    cartItems() {
      return U.qsAll('[component-id="item"], .cart-deal-item, li, .cart-list').filter(el => U.txt(el).match(/원|옵션|도착|배송/));
    }
  };

  async function goCart() {
    if (!/cart\.coupang\.com/.test(location.hostname)) {
      location.href = 'https://cart.coupang.com/cartView.pang';
      await U.waitFor(() => /cart\.coupang\.com/.test(location.hostname), { timeout: 8000, label: 'cart location' });
    }
    await U.waitFor(() => document.body && U.txt(document.body).includes('장바구니'), { timeout: 10000, label: 'cart body' });
  }

  const MOD = {
    async run() {
      const cntEl = DOM.headerCartCount();
      const count = cntEl ? (parseInt(U.digits(U.txt(cntEl)), 10) || 0) : null;
      U.log('cart clear count', count);
      if (count === 0) return { ok: true, skipped: true };

      await goCart();
      await U.tick();

      const clearAll = DOM.clearSoldOutAll();
      if (clearAll) {
        U.click(clearAll, '품절/판매종료상품 전체삭제');
        await U.tick();
        const ok = await U.waitFor(() => DOM.confirmButton(), { timeout: 3000, label: 'confirm button' }).catch(() => null);
        if (ok) U.click(ok, '삭제 확인');
        await U.sleep(400);
      }

      // 남은 일반 상품은 개별 삭제. 전체삭제가 모든 케이스를 커버하지 못할 때 대비.
      for (let round = 0; round < 20; round++) {
        const btn = DOM.deleteButtons()[0];
        if (!btn) break;
        U.click(btn, '개별 삭제');
        await U.tick();
        const ok = await U.waitFor(() => DOM.confirmButton(), { timeout: 2500, label: 'delete confirm' }).catch(() => null);
        if (ok) U.click(ok, '삭제 확인');
        await U.sleep(350);
      }

      return { ok: true };
    }
  };

  window.CPKR_CART_CLEAR = MOD;
})();
