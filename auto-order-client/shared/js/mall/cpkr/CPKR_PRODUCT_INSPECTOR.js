(function(){
  'use strict';

  function text(node) {
    return String(node && node.textContent || '').replace(/\s+/g, ' ').trim();
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

  function firstVisible(selectors) {
    for (const selector of selectors) {
      const nodes = document.querySelectorAll(selector);
      for (const node of nodes) {
        if (visible(node)) return node;
      }
    }
    return null;
  }

  function allVisible(selectors) {
    const result = [];
    const seen = new Set();

    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (!visible(node) || seen.has(node)) continue;
        seen.add(node);
        result.push(node);
      }
    }

    return result;
  }

  function detectLoginRequired() {
    const loginLink = firstVisible([
      'a[href*="/login"]',
      'a[href*="loginForm"]',
      '[class*="login"] a',
      '#login'
    ]);

    const bodyText = text(document.body);

    return Boolean(
      loginLink ||
      /로그인\s*해주세요|로그인이\s*필요|회원\s*로그인/.test(bodyText)
    );
  }

  function identityFromUrl(value) {
    try {
      const u = new URL(String(value || ''), location.origin);
      const m = u.pathname.match(/\/vp\/products\/(\d+)/);
      return {
        product_id: m ? m[1] : '',
        item_id: u.searchParams.get('itemId') || '',
        vendor_item_id: u.searchParams.get('vendorItemId') || ''
      };
    } catch (_) {
      return { product_id: '', item_id: '', vendor_item_id: '' };
    }
  }

  function productIdFromUrl(value) {
    return identityFromUrl(value).product_id;
  }

  function inspect(expected) {
    expected = expected || {};

    const titleNode = firstVisible([
      'h1.prod-buy-header__title',
      '.prod-buy-header__title',
      'h1[class*="title"]',
      'meta[property="og:title"]'
    ]);

    const priceNode = firstVisible([
      '.total-price strong',
      '.prod-sale-price .total-price',
      '[class*="sale-price"]',
      '[class*="price"] strong'
    ]);

    const quantityNode = firstVisible([
      'input[name="quantity"]',
      'input[class*="quantity"]',
      '.quantity input',
      '[class*="quantity"] input'
    ]);

    const cartButton = firstVisible([
      'button.prod-cart-btn',
      'button[class*="cart"]',
      '[data-item-id] button[class*="cart"]',
      'button'
    ]);

    const optionNodes = allVisible([
      'select',
      '[role="listbox"]',
      '[class*="option"] button',
      '[class*="option"] li',
      '[class*="attribute"] button'
    ]).filter(node => {
      const value = text(node);
      return value && value.length < 250;
    });

    const currentIdentity = identityFromUrl(location.href);
    const expectedIdentity = identityFromUrl(
      expected.product_url ||
      expected.mall_product_url ||
      expected.external_product_url ||
      ''
    );
    const currentProductId = currentIdentity.product_id;
    const expectedProductId = expected.product_id || expectedIdentity.product_id;
    const expectedItemId = String(expected.item_id || expectedIdentity.item_id || '');
    const expectedVendorItemId = String(expected.vendor_item_id || expectedIdentity.vendor_item_id || '');
    const productIdMatch = !expectedProductId || currentProductId === String(expectedProductId);
    const itemIdMatch = !expectedItemId || currentIdentity.item_id === expectedItemId;
    const vendorItemIdMatch = !expectedVendorItemId || currentIdentity.vendor_item_id === expectedVendorItemId;

    const title =
      titleNode && titleNode.tagName === 'META'
        ? titleNode.getAttribute('content') || ''
        : text(titleNode);

    const cartText = text(cartButton);
    const cartCandidate =
      cartButton &&
      /장바구니|담기|cart/i.test(cartText + ' ' + cartButton.className);

    return {
      ok: true,
      page_type: /\/vp\/products\//.test(location.pathname)
        ? 'PRODUCT'
        : 'OTHER',
      login_required: detectLoginRequired(),
      url: location.href,
      current_product_id: currentProductId,
      current_item_id: currentIdentity.item_id,
      current_vendor_item_id: currentIdentity.vendor_item_id,
      expected_product_id: String(expectedProductId || ''),
      expected_item_id: expectedItemId,
      expected_vendor_item_id: expectedVendorItemId,
      product_id_match: productIdMatch,
      item_id_match: itemIdMatch,
      vendor_item_id_match: vendorItemIdMatch,
      puid_match: productIdMatch && itemIdMatch && vendorItemIdMatch,
      title,
      price_text: text(priceNode),
      quantity_control_found: Boolean(quantityNode),
      cart_button_found: Boolean(cartCandidate),
      cart_button_text: cartCandidate ? cartText : '',
      option_control_count: optionNodes.length,
      option_samples: optionNodes.slice(0, 12).map(node => ({
        tag: node.tagName,
        text: text(node).slice(0, 120),
        disabled:
          Boolean(node.disabled) ||
          node.getAttribute('aria-disabled') === 'true'
      })),
      checked_at: new Date().toISOString()
    };
  }

  window.GMAO_CPKR_PRODUCT_INSPECTOR = {
    inspect,
    productIdFromUrl,
    identityFromUrl
  };
})();
