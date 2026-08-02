// ==UserScript==
// @name         Glomart Auto Order PC Runner
// @namespace    https://koims.market/auto-order
// @version      0.007
// @description  쿠팡 브라우저 실행기 연결 및 heartbeat. V007에서는 주문을 실행하지 않습니다.
// @match        https://www.coupang.com/*
// @match        https://cart.coupang.com/*
// @match        https://checkout.coupang.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      port-0-glomart-api-v2-mordwrnh222b6c36.sel3.cloudtype.app
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '0.007';
  const API_BASE =
    'https://port-0-glomart-api-v2-mordwrnh222b6c36.sel3.cloudtype.app';

  const DEFAULTS = {
    admin_id: 'derzon',
    mall_account_id: 'CPKR_MASTER',
    mall_code: 'CPKR'
  };

  function uuid() {
    if (crypto && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return (
      Date.now().toString(36) +
      '-' +
      Math.random().toString(36).slice(2)
    );
  }

  function getClientId() {
    let clientId = GM_getValue('gmao_runner_client_id_v007', '');

    if (!clientId) {
      clientId = 'PC-RUNNER-' + uuid();
      GM_setValue('gmao_runner_client_id_v007', clientId);
    }

    return clientId;
  }

  function getSettings() {
    return {
      client_id: getClientId(),
      client_type: 'PC_RUNNER',
      admin_id: GM_getValue(
        'gmao_admin_id',
        DEFAULTS.admin_id
      ),
      mall_account_id: GM_getValue(
        'gmao_mall_account_id',
        DEFAULTS.mall_account_id
      ),
      mall_code: DEFAULTS.mall_code,
      cpkr_ready: true,
      app_version: VERSION,
      current_url: location.href,
      page_type: detectPageType(),
      device: {
        platform: 'tampermonkey',
        userAgent: navigator.userAgent
      }
    };
  }

  function detectPageType() {
    const host = location.hostname;
    const path = location.pathname;

    if (host === 'cart.coupang.com') return 'CART';
    if (host === 'checkout.coupang.com') return 'CHECKOUT';
    if (/\/vp\/products\//.test(path)) return 'PRODUCT';
    return 'COUPANG';
  }

  function request(path, method, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: method || 'GET',
        url: API_BASE + path,
        headers: {
          'Content-Type': 'application/json'
        },
        data: body ? JSON.stringify(body) : undefined,
        timeout: 15000,
        onload(response) {
          let data;

          try {
            data = response.responseText
              ? JSON.parse(response.responseText)
              : {};
          } catch (error) {
            reject(
              new Error(
                'NON_JSON_' +
                response.status +
                ': ' +
                response.responseText.slice(0, 160)
              )
            );
            return;
          }

          if (
            response.status < 200 ||
            response.status >= 300 ||
            data.ok === false
          ) {
            reject(
              new Error(
                data.detail ||
                data.error ||
                'HTTP_' + response.status
              )
            );
            return;
          }

          resolve(data);
        },
        onerror() {
          reject(new Error('NETWORK_ERROR'));
        },
        ontimeout() {
          reject(new Error('REQUEST_TIMEOUT'));
        }
      });
    });
  }

  function ensureBadge() {
    let badge = document.getElementById('gmao-runner-badge-v007');

    if (badge) return badge;

    badge = document.createElement('div');
    badge.id = 'gmao-runner-badge-v007';
    badge.style.cssText = [
      'position:fixed',
      'right:12px',
      'bottom:12px',
      'z-index:2147483647',
      'background:#111827',
      'color:#d1fae5',
      'border:1px solid #334155',
      'border-radius:9px',
      'padding:9px 11px',
      'font:12px/1.4 Arial,sans-serif',
      'box-shadow:0 4px 18px rgba(0,0,0,.25)',
      'max-width:300px',
      'white-space:pre-wrap'
    ].join(';');

    badge.textContent = 'Glomart Runner V007\n연결 준비 중…';
    document.documentElement.appendChild(badge);
    return badge;
  }

  function render(message, error) {
    const badge = ensureBadge();
    badge.style.color = error ? '#fecaca' : '#d1fae5';
    badge.textContent =
      'Glomart Runner V007\n' +
      message +
      '\n' +
      getSettings().client_id;
  }

  async function register() {
    const result = await request(
      '/api/auto-order/runtime/register',
      'POST',
      getSettings()
    );

    render(
      '서버 연결됨 · ' +
      detectPageType() +
      '\n' +
      (result.version || '')
    );

    return result;
  }

  async function heartbeat() {
    const payload = {
      ...getSettings(),
      state: {
        phase: 'RUNNER_CONNECTED',
        page_type: detectPageType()
      }
    };

    const result = await request(
      '/api/auto-order/runtime/heartbeat',
      'POST',
      payload
    );

    render(
      '온라인 · ' +
      detectPageType() +
      '\n마지막 heartbeat ' +
      new Date().toLocaleTimeString()
    );

    return result;
  }

  async function start() {
    try {
      await register();
      await heartbeat();

      setInterval(() => {
        heartbeat().catch(error => {
          render(
            'heartbeat 오류\n' +
            String(error.message || error),
            true
          );
        });
      }, 20000);
    } catch (error) {
      render(
        '연결 오류\n' +
        String(error.message || error),
        true
      );
    }
  }

  start();
})();
