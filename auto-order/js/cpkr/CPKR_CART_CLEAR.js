(function () {
  'use strict';
  const U = window.GMAO_UTIL;

  const DOM = {
    headerCartCountEl() {
      return document.querySelector('#headerCartCount') || document.querySelector('em#headerCartCount');
    },
    headerCartCount() {
      const el = DOM.headerCartCountEl();
      if (!el) return null;
      const raw = U.txt(el);
      if (!raw) return 0;
      return parseInt(U.digits(raw), 10) || 0;
    },
    cartLink() {
      return document.querySelector('#wa-cart-link') || document.querySelector('a[href*="cart.coupang.com/cartView.pang"]');
    },
    soldOutClearButton() {
      // 캡처 확정 DOM: “품절/판매종료상품 전체삭제” 클릭 시 native confirm 발생
      return U.findButtonByText(['품절/판매종료상품 전체삭제', '판매종료상품 전체삭제', '전체삭제']);
    },
    individualDeleteButtons() {
      return U.unique(U.qsAll('button,a,span,div').filter(el => {
        if (!U.visible(el)) return false;
        const t = U.txt(el);
        if (t !== '삭제') return false;
        return !!U.closest(el, 'button,a,[role="button"],div');
      }).map(el => U.closest(el, 'button,a,[role="button"]') || el));
    },
    orderButton() {
      return U.findButtonByText(['상품 구매하기']);
    },
    emptySignal() {
      const t = U.txt(document.body);
      return /장바구니.*비어|담긴 상품이 없습니다|상품이 없습니다/.test(t) || !DOM.orderButton();
    }
  };

  async function openCartIfNeeded() {
    if (/cart\.coupang\.com/.test(location.hostname)) return;
    const link = DOM.cartLink();
    if (link) U.click(link, '헤더 장바구니');
    else location.href = 'https://cart.coupang.com/cartView.pang';
    await U.waitFor(() => /cart\.coupang\.com/.test(location.hostname), { timeout: 10000, label: 'cart location' });
  }

  async function deleteAllInCart() {
    await U.waitFor(() => document.body && U.txt(document.body).includes('장바구니'), { timeout: 12000, label: 'cart body' });

    const clear = DOM.soldOutClearButton();
    if (clear) {
      await U.withAutoConfirm(async () => {
        U.click(clear, '품절/판매종료상품 전체삭제');
        await U.tick();
      }, 'cart clear all');
      await U.sleep(300);
    }

    // 일반 상품은 개별 삭제. 장바구니 초기화 파일에서만 처리한다.
    for (let i = 0; i < 30; i++) {
      const btn = DOM.individualDeleteButtons()[0];
      if (!btn) break;
      await U.withAutoConfirm(async () => {
        U.click(btn, '개별 삭제');
        await U.tick();
      }, 'cart delete one');
      await U.sleep(250);
    }
  }

  const MOD = {
    async run() {
      U.log('cart clear start');
      const count = DOM.headerCartCount();
      U.log('header cart count once', count);

      // 사용자 확정: 주문 시작 전 1회만 검사. 0이면 초기화 생략.
      if (count === 0) return { ok: true, skipped: true, count };

      await openCartIfNeeded();
      await deleteAllInCart();
      await U.sleep(300);
      U.log('cart clear done');
      return { ok: true, skipped: false, count };
    },
    DOM
  };

  window.CPKR_CART_CLEAR = MOD;
})();
