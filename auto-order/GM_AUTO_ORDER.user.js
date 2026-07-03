// ==UserScript==
// @name         Glomart Auto Order CPKR
// @namespace    https://koims.market/gm_auto_order
// @version      0.001
// @description  Glomart PC/App shared auto-order runner for Coupang CPKR. No server API access.
// @match        https://www.coupang.com/*
// @match        https://cart.coupang.com/*
// @match        https://checkout.coupang.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const BASE = 'https://koims1287.cafe24.com/gm_auto_order/js';
  const VERSION = '001';
  const FILES = [
    `${BASE}/GM_AUTO_ORDER_UTIL.js?v=${VERSION}`,
    `${BASE}/GM_AUTO_ORDER_QUEUE.js?v=${VERSION}`,
    `${BASE}/GM_AUTO_ORDER_CORE.js?v=${VERSION}`,
    `${BASE}/cpkr/GM_AUTO_ORDER_CPKR.js?v=${VERSION}`,
    `${BASE}/cpkr/CPKR_CART_CLEAR.js?v=${VERSION}`,
    `${BASE}/cpkr/CPKR_PRODUCT.js?v=${VERSION}`,
    `${BASE}/cpkr/CPKR_CART.js?v=${VERSION}`,
    `${BASE}/cpkr/CPKR_CHECKOUT.js?v=${VERSION}`
  ];

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = resolve;
      s.onerror = () => reject(new Error('script load failed: ' + src));
      document.documentElement.appendChild(s);
    });
  }

  (async function boot() {
    for (const f of FILES) await loadScript(f);
    if (window.GM_AUTO_ORDER_CORE) {
      window.GM_AUTO_ORDER_CORE.boot();
    }
  })().catch(err => console.error('[GMAO] boot failed', err));
})();
