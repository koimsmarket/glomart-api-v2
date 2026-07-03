(function () {
  'use strict';
  const U = window.GMAO_UTIL;

  const DOM = {
    qtyInput() {
      return document.querySelector('input[maxlength="6"][type="text"]') ||
             U.qsAll('input[type="text"]').find(i => U.visible(i) && /^\d+$/.test(i.value || ''));
    },
    plusButton() {
      return U.qsAll('button').find(b => U.visible(b) && (U.txt(b).includes('수량더하기') || b.innerHTML.includes('icon-plus')));
    },
    minusButton() {
      return U.qsAll('button').find(b => U.visible(b) && (U.txt(b).includes('수량빼기') || b.innerHTML.includes('icon-minus')));
    },
    cartButton() {
      return document.querySelector('button.prod-cart-btn') ||
             U.findByText('button', '장바구니 담기');
    },
    optionByText(text) {
      if (!text) return null;
      return U.qsAll('label, button, li, div').find(el => U.visible(el) && U.txt(el).includes(text));
    },
    optionRadioByQty(qty) {
      const labels = U.qsAll('label, li, div').filter(el => U.visible(el) && U.txt(el).includes(`${qty}개`));
      return labels[0] || null;
    },
    addedSignal() {
      return U.txt(document.body).includes('장바구니에 상품이 담겼습니다') ||
             U.txt(document.body).includes('장바구니') && document.querySelector('#headerCartCount');
    }
  };

  async function openProduct(item) {
    if (!item.source_url) throw new Error('missing source_url');
    if (location.href !== item.source_url) {
      // 상품 상세 진입 전은 blank 허용.
      if (location.href !== 'about:blank') location.href = 'about:blank';
      await U.sleep(120);
      location.href = item.source_url;
    }
    await U.waitFor(() => DOM.cartButton(), { timeout: 15000, label: 'product cart button' });
  }

  async function setOptionAndQty(item) {
    const optionText = item.option_name || item.optionName || '';
    if (optionText) {
      const opt = DOM.optionByText(optionText);
      if (opt) { U.click(opt, '옵션 선택'); await U.tick(); }
    } else if (item.option_qty) {
      const opt = DOM.optionRadioByQty(item.option_qty);
      if (opt) { U.click(opt, '옵션 수량 선택'); await U.tick(); }
    }

    const qty = parseInt(item.quantity || item.qty || 1, 10) || 1;
    const input = DOM.qtyInput();
    if (input) {
      U.input(input, qty, '수량');
      await U.tick();
    } else {
      const plus = DOM.plusButton();
      for (let i = 1; i < qty && plus; i++) { U.click(plus, '수량더하기'); await U.tick(); }
    }
  }

  const MOD = {
    async addItem(item, order, index) {
      U.log('add item', index, item.source_key || item.source_url);
      await openProduct(item);
      await setOptionAndQty(item);
      const btn = await U.waitFor(() => DOM.cartButton(), { timeout: 6000, label: 'cart button ready' });
      U.click(btn, '장바구니 담기');
      await U.sleep(350);
      return { ok: true };
    }
  };

  window.CPKR_PRODUCT = MOD;
})();
