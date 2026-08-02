// ==UserScript==
// @name         Glomart Auto Order PC Runner
// @namespace    https://koims.market/auto-order
// @version      0.008
// @description  쿠팡 PC 실행기. 수동 작업 배정과 상품 페이지 열기까지만 수행합니다.
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

  const VERSION = '0.008';
  const API_BASE =
    'https://port-0-glomart-api-v2-mordwrnh222b6c36.sel3.cloudtype.app';

  const DEFAULTS = {
    admin_id: 'derzon',
    mall_account_id: 'CPKR_MASTER',
    mall_code: 'CPKR'
  };

  let currentJob = GM_getValue('gmao_runner_job_v008', null);
  let workHeartbeatTimer = null;
  let clientHeartbeatTimer = null;

  function uuid() {
    if (crypto && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }

  function getClientId() {
    let clientId = GM_getValue('gmao_runner_client_id_v008', '');
    if (!clientId) {
      clientId = 'PC-RUNNER-' + uuid();
      GM_setValue('gmao_runner_client_id_v008', clientId);
    }
    return clientId;
  }

  function detectPageType() {
    const host = location.hostname;
    const path = location.pathname;
    if (host === 'cart.coupang.com') return 'CART';
    if (host === 'checkout.coupang.com') return 'CHECKOUT';
    if (/\/vp\/products\//.test(path)) return 'PRODUCT';
    return 'COUPANG';
  }

  function settings(extra) {
    return Object.assign({
      client_id: getClientId(),
      client_type: 'PC_RUNNER',
      admin_id: GM_getValue('gmao_admin_id', DEFAULTS.admin_id),
      mall_account_id: GM_getValue(
        'gmao_mall_account_id',
        DEFAULTS.mall_account_id
      ),
      mall_code: DEFAULTS.mall_code,
      cpkr_ready: true,
      app_version: VERSION,
      current_url: location.href,
      page_type: detectPageType(),
      current_work_id: currentJob ? currentJob.work_id : null,
      device: {
        platform: 'tampermonkey',
        userAgent: navigator.userAgent
      }
    }, extra || {});
  }

  function request(path, method, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: method || 'GET',
        url: API_BASE + path,
        headers: { 'Content-Type': 'application/json' },
        data: body ? JSON.stringify(body) : undefined,
        timeout: 15000,
        onload(response) {
          let data;
          try {
            data = response.responseText
              ? JSON.parse(response.responseText)
              : {};
          } catch {
            reject(
              new Error(
                'NON_JSON_' + response.status + ': ' +
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

  function productUrl(job) {
    const payload = job && (job.payload || job);
    const order = payload && payload.order;
    const item = payload && payload.items && payload.items[0];

    const candidates = [
      item && item.product_url,
      item && item.mall_product_url,
      item && item.external_product_url,
      item && item.source_url,
      order && order.product_url,
      order && order.mall_product_url,
      order && order.external_product_url
    ];

    return candidates.find(value => /^https?:\/\//i.test(String(value || ''))) || '';
  }

  function createButton(label, handler, danger) {
    const button = document.createElement('button');
    button.textContent = label;
    button.style.cssText = [
      'border:0',
      'border-radius:6px',
      'padding:7px 9px',
      'margin:6px 4px 0 0',
      'font:700 12px Arial,sans-serif',
      'cursor:pointer',
      'color:#fff',
      'background:' + (danger ? '#c9382b' : '#1463d6')
    ].join(';');
    button.addEventListener('click', handler);
    return button;
  }

  function ensurePanel() {
    let panel = document.getElementById('gmao-runner-panel-v008');
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = 'gmao-runner-panel-v008';
    panel.style.cssText = [
      'position:fixed',
      'right:12px',
      'bottom:12px',
      'z-index:2147483647',
      'width:330px',
      'background:#111827',
      'color:#d1fae5',
      'border:1px solid #334155',
      'border-radius:10px',
      'padding:12px',
      'font:12px/1.45 Arial,sans-serif',
      'box-shadow:0 4px 18px rgba(0,0,0,.30)'
    ].join(';');

    document.documentElement.appendChild(panel);
    return panel;
  }

  function render(message, error) {
    const panel = ensurePanel();
    panel.innerHTML = '';

    const title = document.createElement('div');
    title.textContent = 'Glomart Runner V008';
    title.style.cssText = 'font-weight:800;font-size:14px;margin-bottom:6px';
    panel.appendChild(title);

    const status = document.createElement('div');
    status.textContent = message;
    status.style.color = error ? '#fecaca' : '#d1fae5';
    status.style.whiteSpace = 'pre-wrap';
    panel.appendChild(status);

    const meta = document.createElement('div');
    meta.textContent =
      '\n' + getClientId() +
      '\n페이지: ' + detectPageType();
    meta.style.cssText = 'color:#93c5fd;white-space:pre-wrap;margin-top:4px';
    panel.appendChild(meta);

    if (!currentJob) {
      panel.appendChild(
        createButton('작업 가져오기', () => {
          claim().catch(showError);
        })
      );
      return;
    }

    const url = productUrl(currentJob);

    panel.appendChild(
      createButton('상품 페이지 열기', () => {
        if (!url) {
          showError(new Error('주문 데이터에 상품 URL이 없습니다.'));
          return;
        }
        location.href = url;
      })
    );

    panel.appendChild(
      createButton('작업 반환', () => {
        release().catch(showError);
      }, true)
    );
  }

  function showError(error) {
    render(
      '오류\n' + String(error && error.message || error),
      true
    );
  }

  async function register() {
    return request(
      '/api/auto-order/runtime/register',
      'POST',
      settings()
    );
  }

  async function clientHeartbeat() {
    return request(
      '/api/auto-order/runtime/heartbeat',
      'POST',
      settings({
        state: {
          phase: currentJob ? 'CLAIMED_WAITING_USER' : 'RUNNER_CONNECTED',
          page_type: detectPageType()
        }
      })
    );
  }

  async function workHeartbeat() {
    if (!currentJob) return;

    return request(
      '/api/auto-order/runtime/work/' +
      encodeURIComponent(currentJob.work_id) +
      '/heartbeat',
      'POST',
      settings({
        lock_token: currentJob.lock_token
      })
    );
  }

  function startWorkHeartbeat() {
    clearInterval(workHeartbeatTimer);

    if (!currentJob) return;

    workHeartbeatTimer = setInterval(() => {
      workHeartbeat().catch(showError);
    }, 30000);
  }

  async function claim() {
    if (currentJob) {
      render(
        '이미 작업을 보유 중입니다.\n작업 #' + currentJob.work_id
      );
      return currentJob;
    }

    render('작업 배정 요청 중…');

    const result = await request(
      '/api/auto-order/runtime/claim',
      'POST',
      settings()
    );

    if (!result.job) {
      render(
        '배정 가능한 작업 없음\n' +
        (result.reason || 'queue_empty')
      );
      return null;
    }

    currentJob = result.job;
    GM_setValue('gmao_runner_job_v008', currentJob);
    startWorkHeartbeat();

    const url = productUrl(currentJob);

    render(
      '작업 배정 완료\n' +
      '#' + currentJob.work_id + '\n' +
      currentJob.auto_order_no + '\n' +
      (url ? '상품 URL 확인됨' : '상품 URL 없음')
    );

    return currentJob;
  }

  async function release() {
    if (!currentJob) return;

    const job = currentJob;

    await request(
      '/api/auto-order/runtime/work/' +
      encodeURIComponent(job.work_id) +
      '/release',
      'POST',
      settings({
        lock_token: job.lock_token
      })
    );

    currentJob = null;
    GM_setValue('gmao_runner_job_v008', null);
    clearInterval(workHeartbeatTimer);
    workHeartbeatTimer = null;

    render('작업을 READY 상태로 반환했습니다.');
  }

  async function start() {
    try {
      await register();
      await clientHeartbeat();

      clientHeartbeatTimer = setInterval(() => {
        clientHeartbeat().catch(showError);
      }, 20000);

      if (currentJob) {
        startWorkHeartbeat();
        render(
          '기존 작업 복구\n' +
          '#' + currentJob.work_id + '\n' +
          currentJob.auto_order_no
        );
      } else {
        render('온라인\n수동 작업 배정 대기');
      }
    } catch (error) {
      showError(error);
    }
  }

  start();
})();
