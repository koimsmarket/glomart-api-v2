// ==UserScript==
// @name         Glomart Auto Order CPKR
// @namespace    https://koims.market/auto-order
// @version      0.002
// @description  Glomart PC/App shared auto-order runner for Coupang CPKR. No server API access during order.
// @match        https://www.coupang.com/*
// @match        https://cart.coupang.com/*
// @match        https://checkout.coupang.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // glomart-api-v2 root 아래 /auto-order 배치 기준.
  // 필요하면 콘솔에서 window.GMAO_BASE를 먼저 지정해 우회 가능.
  const BASE = window.GMAO_BASE || 'https://port-0-glomart-api-v2-mordwrnh222b6c36.sel3.cloudtype.app/auto-order/js';
  const VERSION = '002';
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
    if (window.GM_AUTO_ORDER_CORE) window.GM_AUTO_ORDER_CORE.boot();
  })().catch(err => console.error('[GMAO] boot failed', err));
})();
