(function () {
  'use strict';
  const U = window.GMAO_UTIL;

  const DOM = {
    quantityBox() {
      return document.querySelector('.product-quantity') || document.querySelector('.prod-buy-quantity-and-footer') || document;
    },
    qtyInput() {
      const root = DOM.quantityBox();
      return root.querySelector('input[type="text"][maxlength="6"]') ||
        U.qsAll('input[type="text"]', root).find(i => U.visible(i) && /^\d+$/.test(i.value || ''));
    },
    plusButton() {
      const root = DOM.quantityBox();
      return U.qsAll('button', root).find(b => U.visible(b) && (U.txt(b).includes('수량더하기') || /icon-plus|plus/.test(b.innerHTML))) || null;
    },
    minusButton() {
      const root = DOM.quantityBox();
      return U.qsAll('button', root).find(b => U.visible(b) && (U.txt(b).includes('수량빼기') || /icon-minus|minus/.test(b.innerHTML))) || null;
    },
    cartButton() {
      // 캡처 확정 DOM: button.prod-cart-btn / data-agclick addCartButton / 텍스트 장바구니 담기
      return document.querySelector('button.prod-cart-btn:not([disabled])') ||
        U.qsAll('button').find(b => U.visible(b) && !U.isDisabled(b) && /addCartButton/.test(b.getAttribute('data-agclick') || '')) ||
        U.findButtonByText('장바구니 담기');
    },
    optionArea() {
      return document.querySelector('.option-table-v2') || document.querySelector('.prod-option') || document.querySelector('.prod-atf-contents') || document;
    },
    optionByText(text) {
      if (!text) return null;
      const root = DOM.optionArea();
      const target = U.norm(text);
      return U.qsAll('label,li,button,div', root).find(el => {
        if (!U.visible(el)) return false;
        const t = U.norm(U.txt(el));
        return t && (t.includes(target) || target.includes(t));
      }) || null;
    },
    optionByUnitText(text) {
      if (!text) return null;
      const m = String(text).match(/(\d+\s*개)/);
      if (!m) return null;
      return DOM.optionByText(m[1]);
    },
    cartCount() {
      const el = document.querySelector('#headerCartCount');
      return el ? (parseInt(U.digits(U.txt(el)), 10) || 0) : null;
    }
  };

  async function openProduct(item) {
    if (!item.source_url) throw new Error('missing source_url');
    if (location.href !== item.source_url) {
      // 상품 상세 진입 전에는 about:blank 허용. 주문 내부 파라미터 구간이 아니다.
      if (location.href !== 'about:blank') {
        location.href = 'about:blank';
        await U.sleep(120);
      }
      location.href = item.source_url;
    }
    await U.waitFor(() => /coupang\.com\/vp\/products/.test(location.href), { timeout: 12000, label: 'product url' });
    await U.waitFor(() => DOM.cartButton(), { timeout: 15000, label: '장바구니 담기 버튼' });
  }

  async function setOption(item) {
    const optionText = item.option_name || item.optionName || item.selected_option || '';
    let opt = null;
    if (optionText) opt = DOM.optionByText(optionText) || DOM.optionByUnitText(optionText);
    if (!opt && item.option_qty) opt = DOM.optionByText(String(item.option_qty) + '개');
    if (opt) {
      const clickable = U.closest(opt, 'label,button,li,[role="button"]') || opt;
      U.click(clickable, '옵션 선택');
      await U.tick();
    }
  }

  async function setQty(item) {
    const qty = parseInt(item.quantity || item.qty || 1, 10) || 1;
    const input = await U.waitFor(() => DOM.qtyInput(), { timeout: 6000, label: '수량 input' }).catch(() => null);
    if (input) {
      U.input(input, qty, '수량');
      await U.tick();
      return;
    }
    const plus = DOM.plusButton();
    for (let i = 1; i < qty && plus; i++) { U.click(plus, '수량더하기'); await U.tick(); }
  }

  const MOD = {
    async addItem(item, order, index) {
      U.log('product add start', index, item.source_key || item.source_url);
      await openProduct(item);
      await setOption(item);
      await setQty(item);
      const before = DOM.cartCount();
      const btn = await U.waitFor(() => DOM.cartButton(), { timeout: 6000, label: 'cart button ready' });
      U.click(btn, '장바구니 담기');
      await U.sleep(300);
      await U.waitFor(() => {
        const after = DOM.cartCount();
        return after == null || before == null || after >= before || U.txt(document.body).includes('장바구니');
      }, { timeout: 5000, label: 'cart add signal' }).catch(() => true);
      U.log('product add done', index);
      return { ok: true };
    },
    DOM
  };

  window.CPKR_PRODUCT = MOD;
})();
