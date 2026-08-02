(function(){
  'use strict';

  function normalize(value) {
    return String(value == null ? '' : value)
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function text(node) {
    return String(node && node.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function visible(node) {
    if (!node) return false;
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number(style.opacity || 1) !== 0 &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function disabled(node) {
    return Boolean(
      node &&
      (
        node.disabled ||
        node.getAttribute('aria-disabled') === 'true' ||
        /disabled|soldout|out-of-stock/i.test(
          String(node.className || '')
        )
      )
    );
  }

  function dispatchInput(node, value) {
    const prototype = Object.getPrototypeOf(node);
    const descriptor = Object.getOwnPropertyDescriptor(
      prototype,
      'value'
    );

    if (descriptor && descriptor.set) {
      descriptor.set.call(node, String(value));
    } else {
      node.value = String(value);
    }

    node.dispatchEvent(
      new Event('input', { bubbles: true })
    );
    node.dispatchEvent(
      new Event('change', { bubbles: true })
    );
    node.blur();
  }

  function expectedOption(item) {
    const candidates = [
      item.option_name,
      item.optionName,
      item.selected_option,
      item.option_value,
      item.option_text,
      item.sku_name,
      item.variant_name
    ];

    return candidates
      .map(value => String(value || '').trim())
      .find(Boolean) || '';
  }

  function expectedQuantity(item) {
    const value =
      item.quantity ??
      item.qty ??
      item.order_quantity ??
      item.item_quantity ??
      1;

    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) && number > 0 ? number : 1;
  }

  function optionCandidates() {
    const selectors = [
      'select',
      '[role="option"]',
      '[class*="option"] button',
      '[class*="option"] li',
      '[class*="attribute"] button',
      '.option-table-v2 label',
      '.prod-option label'
    ];

    const result = [];
    const seen = new Set();

    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (!visible(node) || seen.has(node)) continue;
        seen.add(node);

        const value = text(node);
        if (!value || value.length > 250) continue;

        result.push(node);
      }
    }

    return result;
  }

  function quantityInput() {
    const selectors = [
      'input[name="quantity"]',
      'input[class*="quantity"]',
      '.quantity input',
      '[class*="quantity"] input',
      '.product-quantity input',
      'input[type="text"][maxlength="6"]'
    ];

    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (!visible(node) || disabled(node)) continue;
        return node;
      }
    }

    return null;
  }

  function quantityButton(direction) {
    const patterns =
      direction === 'plus'
        ? /수량\s*더하기|plus|increase|\+/i
        : /수량\s*빼기|minus|decrease|-/i;

    for (const button of document.querySelectorAll('button')) {
      if (!visible(button) || disabled(button)) continue;

      const haystack = [
        text(button),
        button.getAttribute('aria-label') || '',
        button.getAttribute('title') || '',
        String(button.className || '')
      ].join(' ');

      if (patterns.test(haystack)) return button;
    }

    return null;
  }

  async function wait(ms) {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  function findOptionMatch(expectedText) {
    const expected = normalize(expectedText);
    if (!expected) {
      return {
        required: false,
        matched: false,
        node: null,
        candidates: optionCandidates().length
      };
    }

    const candidates = optionCandidates();
    const scored = [];

    for (const node of candidates) {
      if (disabled(node)) continue;

      if (node.tagName === 'SELECT') {
        for (const option of node.options || []) {
          const current = normalize(option.textContent);
          if (!current) continue;

          let score = 0;
          if (current === expected) score = 100;
          else if (current.includes(expected)) score = 80;
          else if (expected.includes(current) && current.length >= 3) {
            score = 60;
          }

          if (score) {
            scored.push({
              node,
              option,
              score,
              text: option.textContent.trim()
            });
          }
        }
        continue;
      }

      const current = normalize(text(node));
      let score = 0;

      if (current === expected) score = 100;
      else if (current.includes(expected)) score = 80;
      else if (expected.includes(current) && current.length >= 3) {
        score = 60;
      }

      if (score) {
        scored.push({
          node,
          option: null,
          score,
          text: text(node)
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    const best = scored[0] || null;
    const ambiguous = Boolean(
      best &&
      scored[1] &&
      scored[1].score === best.score &&
      normalize(scored[1].text) !== normalize(best.text)
    );

    return {
      required: true,
      matched: Boolean(best) && !ambiguous,
      ambiguous,
      node: best && best.node,
      option: best && best.option,
      matched_text: best && best.text,
      score: best && best.score || 0,
      candidates: candidates.length
    };
  }

  async function selectOption(match) {
    if (!match.required) {
      return { changed: false, reason: 'option_not_required' };
    }

    if (!match.matched || !match.node) {
      throw new Error(
        match.ambiguous
          ? '옵션 후보가 여러 개라 자동 선택하지 않았습니다.'
          : '주문 옵션과 일치하는 옵션을 찾지 못했습니다.'
      );
    }

    if (match.node.tagName === 'SELECT' && match.option) {
      match.node.value = match.option.value;
      match.node.dispatchEvent(
        new Event('input', { bubbles: true })
      );
      match.node.dispatchEvent(
        new Event('change', { bubbles: true })
      );
      await wait(500);

      return {
        changed: true,
        method: 'select',
        matched_text: match.matched_text
      };
    }

    const clickable =
      match.node.closest(
        'button,label,li,[role="button"],[role="option"]'
      ) || match.node;

    if (disabled(clickable)) {
      throw new Error('선택하려는 옵션이 비활성화되어 있습니다.');
    }

    clickable.click();
    await wait(700);

    return {
      changed: true,
      method: 'click',
      matched_text: match.matched_text
    };
  }

  async function setQuantity(quantity) {
    const input = quantityInput();

    if (input) {
      const before = Number.parseInt(input.value, 10) || 1;

      if (before !== quantity) {
        dispatchInput(input, quantity);
        await wait(500);
      }

      const after = Number.parseInt(input.value, 10) || quantity;

      return {
        changed: before !== after,
        method: 'input',
        before,
        after,
        requested: quantity
      };
    }

    let current = 1;
    const plus = quantityButton('plus');
    const minus = quantityButton('minus');

    if (quantity > current && !plus) {
      throw new Error('수량 증가 버튼을 찾지 못했습니다.');
    }

    if (quantity < current && !minus) {
      throw new Error('수량 감소 버튼을 찾지 못했습니다.');
    }

    while (current < quantity) {
      plus.click();
      current += 1;
      await wait(250);
    }

    while (current > quantity) {
      minus.click();
      current -= 1;
      await wait(250);
    }

    return {
      changed: quantity !== 1,
      method: 'button',
      before: 1,
      after: current,
      requested: quantity
    };
  }

  async function prepare(item, inspection) {
    item = item || {};

    if (!inspection || inspection.page_type !== 'PRODUCT') {
      throw new Error('쿠팡 상품 상세 페이지가 아닙니다.');
    }

    if (inspection.login_required) {
      throw new Error('쿠팡 로그인이 필요합니다.');
    }

    if (!inspection.product_id_match) {
      throw new Error('주문 상품과 현재 상품이 다릅니다.');
    }

    const optionText = expectedOption(item);
    const quantity = expectedQuantity(item);
    const match = findOptionMatch(optionText);
    const optionResult = await selectOption(match);
    const quantityResult = await setQuantity(quantity);

    return {
      ok: true,
      option_expected: optionText,
      option_result: optionResult,
      quantity_result: quantityResult,
      prepared_at: new Date().toISOString()
    };
  }

  window.GMAO_CPKR_PRODUCT_PREPARER = {
    prepare,
    expectedOption,
    expectedQuantity,
    findOptionMatch
  };
})();
