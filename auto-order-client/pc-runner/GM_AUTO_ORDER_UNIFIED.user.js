// ==UserScript==
// @name         Glomart Auto Order PC Runner
// @namespace    https://koims.market/auto-order
// @version      0.061
// @description  쿠팡 PC 실행기. Tampermonkey sandbox에서 모듈을 직접 로드하여 PUID 검증과 주문수량 준비를 자동 수행합니다.
// @match        https://www.coupang.com/*
// @match        https://cart.coupang.com/*
// @match        https://checkout.coupang.com/*
// @match        https://login.coupang.com/*
// @match        https://id.coupang.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      port-0-glomart-api-v2-mordwrnh222b6c36.sel3.cloudtype.app
// ==/UserScript==

(function () {
  'use strict';

  window.addEventListener('message', (ev) => {
    try {
      const d = ev && ev.data;
      if (!d || d.type !== 'GM_AUTO_ORDER_ADDRESS_DEBUG') return;
      const x = d.payload || {};
      const lines = [
        'ADDRESS DEBUG',
        'raddr1=' + String(x.raddr1 ?? ''),
        'raddr2=' + String(x.raddr2 ?? ''),
        'address1=' + String(x.address1 ?? ''),
        'address2=' + String(x.address2 ?? ''),
        'receiver_address2=' + String(x.receiver_address2 ?? ''),
        'receiverAddress2=' + String(x.receiverAddress2 ?? ''),
        'detailAddressOf=' + String(x.detailAddressOf ?? ''),
        'detail input found=' + String(!!x.detailInputFound),
        'detail input value=' + String(x.detailInputValue ?? ''),
        'save disabled=' + String(!!x.saveDisabled)
      ];
      if (typeof render === 'function') {
        render(lines.join('\n'));
      } else {
        console.log('[GM_AUTO_ORDER_ADDRESS_DEBUG_RUNNER]', x);
      }
    } catch (_) {}
  }, false);



  const VERSION = '0.061';
  const API_BASE =
    'https://port-0-glomart-api-v2-mordwrnh222b6c36.sel3.cloudtype.app';
  const INSPECTOR_URL =
    API_BASE +
    '/auto-order-client/shared/js/mall/cpkr/CPKR_PRODUCT_INSPECTOR.js?v=013';
  const PREPARER_URL =
    API_BASE +
    '/auto-order-client/shared/js/mall/cpkr/CPKR_PRODUCT_PREPARER.js?v=013';
  const CART_MANAGER_URL =
    API_BASE +
    '/auto-order-client/shared/js/mall/cpkr/CPKR_CART_MANAGER.js?v=013';
  const UTIL_URL =
    API_BASE +
    '/auto-order-client/shared/js/GM_AUTO_ORDER_UTIL.js?v=013';
  const CART_URL =
    API_BASE +
    '/auto-order-client/shared/js/mall/cpkr/CPKR_CART.js?v=013';
  const CHECKOUT_URL =
    API_BASE +
    '/auto-order-client/shared/js/mall/cpkr/CPKR_CHECKOUT.js?v=029';
  const CART_CLEAR_URL =
    API_BASE +
    '/auto-order-client/shared/js/mall/cpkr/CPKR_CART_CLEAR.js?v=047';
  const PRODUCT_ORDER_URL =
    API_BASE +
    '/auto-order-client/shared/js/mall/cpkr/CPKR_PRODUCT_ORDER.js?v=001';
  const CART_COMPARE_URL =
    API_BASE +
    '/auto-order-client/shared/js/mall/cpkr/CPKR_CART_COMPARE.js?v=001';

  const DEFAULTS = {
    admin_id: 'derzon',
    mall_account_id: 'CPKR_MASTER',
    mall_code: 'CPKR'
  };

  let currentJob = GM_getValue('gmao_runner_job_v013', null);
  let lastInspection = GM_getValue('gmao_runner_inspection_v013', null);
  let lastPreparation = GM_getValue('gmao_runner_preparation_v013', null);
  let lastCartAction = GM_getValue('gmao_runner_cart_v013', null);
  let workHeartbeatTimer = null;
  let clientHeartbeatTimer = null;
  let autoProductFlowRunning = false;

  /*
   * V033 CROSS-ORIGIN ADDRESS BRIDGE
   * checkout.coupang.com 부모 문서에서는 id.coupang.com/addressbook iframe 내부 DOM에
   * same-origin 정책상 접근할 수 없다. 같은 Tampermonkey 스크립트를 id.coupang.com에도
   * 실행하고 GM storage를 통해 배송지 payload/진행상태만 전달한다.
   */
  const ADDRESS_BRIDGE_KEY = 'gmao_cpkr_address_bridge_v033';

  const FLOW_KEY = 'gmao_cpkr_flow_v058';
  const BATCH_SESSION_KEY = 'gmao_cpkr_batch_session_v058';
  const BLANK_GATE_MS = 850;

  const FLOW = Object.freeze({
    BATCH_CART_SCAN: 'BATCH_CART_SCAN',
    BATCH_CART_CLEAR: 'BATCH_CART_CLEAR',
    BATCH_TO_WAIT: 'BATCH_TO_WAIT',
    ORDER_START: 'ORDER_START',
    SINGLE_PRODUCT: 'SINGLE_PRODUCT',
    MULTI_ADD_ITEMS: 'MULTI_ADD_ITEMS',
    MULTI_CART_SNAPSHOT: 'MULTI_CART_SNAPSHOT',
    MULTI_SNAPSHOT_RELEASE: 'MULTI_SNAPSHOT_RELEASE',
    MULTI_CART_APPLY: 'MULTI_CART_APPLY',
    MULTI_CART_CHECKOUT: 'MULTI_CART_CHECKOUT',
    CHECKOUT: 'CHECKOUT',
    BATCH_CLEAN_WAIT: 'BATCH_CLEAN_WAIT',
    STOPPED_BEFORE_PAYMENT: 'STOPPED_BEFORE_PAYMENT',
    FAILED_SKIP: 'FAILED_SKIP',
    COUPANG_BLOCKED_STOP: 'COUPANG_BLOCKED_STOP'
  });

  function flowGet(){ return GM_getValue(FLOW_KEY, null); }
  function flowSet(patch){
    const next=Object.assign({},flowGet()||{},patch||{},{updated_at:Date.now()});
    GM_setValue(FLOW_KEY,next); return next;
  }
  function flowClear(){ GM_setValue(FLOW_KEY,null); }
  function batchSessionGet(){
    return GM_getValue(BATCH_SESSION_KEY, null);
  }

  function batchSessionSet(patch){
    const next = Object.assign({}, batchSessionGet() || {}, patch || {}, {
      updated_at: Date.now()
    });
    GM_setValue(BATCH_SESSION_KEY, next);
    return next;
  }

  function batchSessionReady(){
    const x = batchSessionGet();
    return !!(x && x.cart_cleaned === true);
  }

  function orderItemCount(job){ const p=payloadOf(job), items=Array.isArray(p.items)?p.items:[]; return items.length; }

  function uuid() {
    if (crypto && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }

  function getClientId() {
    let clientId = GM_getValue('gmao_runner_client_id_v013', '');
    if (!clientId) {
      clientId = 'PC-RUNNER-' + uuid();
      GM_setValue('gmao_runner_client_id_v013', clientId);
    }
    return clientId;
  }

  function detectPageType() {
    if (location.hostname === 'cart.coupang.com') return 'CART';
    if (location.hostname === 'checkout.coupang.com') return 'CHECKOUT';
    if (location.hostname === 'login.coupang.com') return 'AUTH';
    if (location.hostname === 'id.coupang.com') return 'ADDRESS';
    if (/\/vp\/products\//.test(location.pathname)) return 'PRODUCT';
    return 'COUPANG';
  }

  function detectCoupangBlockPage() {
    const title = String(document.title || '').trim();
    const body = String(document.body && document.body.innerText || '').slice(0, 12000);

    if (
      /Access Denied/i.test(title) ||
      /Access Denied/i.test(body) ||
      /You don't have permission to access/i.test(body) ||
      /errors\.edgesuite\.net/i.test(body) ||
      /Reference\s*#?\d+\./i.test(body)
    ) {
      return {
        blocked: true,
        code: 'COUPANG_ACCESS_DENIED',
        title: title,
        url: location.href
      };
    }

    return { blocked: false };
  }

  function stopForCoupangBlock(info) {
    const detail = info || detectCoupangBlockPage();
    flowSet({
      stage: FLOW.COUPANG_BLOCKED_STOP,
      failure_reason: detail.code || 'COUPANG_ACCESS_DENIED',
      blocked_url: location.href,
      blocked_title: String(document.title || ''),
      blocked_at: Date.now()
    });

    lastCartAction = {
      ok: false,
      method: 'coupang-block-guard',
      error: detail.code || 'COUPANG_ACCESS_DENIED',
      url: location.href
    };
    GM_setValue('gmao_runner_cart_v013', lastCartAction);

    render(
      '쿠팡 접근 차단 감지 · 자동작업 즉시 정지\n' +
      (detail.code || 'COUPANG_ACCESS_DENIED') +
      '\n추가 클릭/DOM 작업/페이지 이동을 실행하지 않습니다.',
      true
    );
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
      inspection: lastInspection || null,
      preparation: lastPreparation || null,
      cart_action: lastCartAction || null,
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

  const moduleLoadPromises = new Map();

  function loadModuleIntoRunner(url, ready, label) {
    if (ready()) return Promise.resolve();

    if (moduleLoadPromises.has(url)) {
      return moduleLoadPromises.get(url);
    }

    const promise = new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: 15000,
        onload(response) {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(label + ' 모듈 HTTP_' + response.status));
            return;
          }

          try {
            /*
             * IMPORTANT:
             * <script src=...>로 주입하면 쿠팡 page context에 모듈이 생성되고,
             * Tampermonkey userscript sandbox의 window에서는 보이지 않을 수 있다.
             * 따라서 코드를 GM_xmlhttpRequest로 읽은 뒤 현재 Runner sandbox에서 실행한다.
             */
            /*
             * V025: 외부 CPKR 모듈은 Tampermonkey sandbox 안에서 실행된다.
             * 모듈이 new MouseEvent(type, { view: window, ... })를 사용하면
             * sandbox의 window proxy는 native UIEvent.view(Window)로 변환되지 않아
             * "Failed to convert value to 'Window'" 오류가 발생한다.
             *
             * 개별 CPKR 모듈의 클릭 코드를 임의로 수정하지 않고, 모듈 실행 스코프에
             * 안전한 MouseEvent 생성자를 주입한다. view는 클릭 동작에 필수값이 아니므로
             * 제거하고 실제 page document의 native MouseEvent로 생성한다.
             * 이 보호막은 CHECKOUT뿐 아니라 동적으로 로드되는 모든 CPKR 모듈에 적용한다.
             */
            const pageView = document && document.defaultView;
            const NativeMouseEvent =
              pageView && typeof pageView.MouseEvent === 'function'
                ? pageView.MouseEvent
                : MouseEvent;

            function SafeMouseEvent(type, init) {
              const safeInit = Object.assign({}, init || {});
              if (Object.prototype.hasOwnProperty.call(safeInit, 'view')) {
                delete safeInit.view;
              }
              return new NativeMouseEvent(type, safeInit);
            }
            SafeMouseEvent.prototype = NativeMouseEvent.prototype;

            const runModule = new Function(
              'window',
              'globalThis',
              'MouseEvent',
              response.responseText + '\n//# sourceURL=' + url
            );
            runModule(window, globalThis, SafeMouseEvent);
          } catch (error) {
            reject(new Error(label + ' 모듈 실행 실패: ' + error.message));
            return;
          }

          if (!ready()) {
            reject(new Error(label + ' 모듈 로드 후 API가 생성되지 않았습니다.'));
            return;
          }

          resolve();
        },
        onerror() {
          reject(new Error(label + ' 모듈 네트워크 오류'));
        },
        ontimeout() {
          reject(new Error(label + ' 모듈 로드 시간 초과'));
        }
      });
    });

    moduleLoadPromises.set(url, promise);
    promise.catch(() => moduleLoadPromises.delete(url));
    return promise;
  }

  function loadInspector() {
    return loadModuleIntoRunner(
      INSPECTOR_URL,
      () => Boolean(
        window.GMAO_CPKR_PRODUCT_INSPECTOR &&
        typeof window.GMAO_CPKR_PRODUCT_INSPECTOR.inspect === 'function'
      ),
      '상품 검사'
    );
  }

  function loadPreparer() {
    return loadModuleIntoRunner(
      PREPARER_URL,
      () => Boolean(
        window.GMAO_CPKR_PRODUCT_PREPARER &&
        typeof window.GMAO_CPKR_PRODUCT_PREPARER.prepare === 'function'
      ),
      '상품 준비'
    );
  }

  function loadCartManager() {
    return loadModuleIntoRunner(
      CART_MANAGER_URL,
      () => Boolean(
        window.GMAO_CPKR_CART_MANAGER &&
        typeof window.GMAO_CPKR_CART_MANAGER.inspectCart === 'function'
      ),
      '장바구니 관리'
    );
  }

  function loadExternal(url, ready, label) {
    return loadModuleIntoRunner(url, ready, label);
  }

  function loadUtil() {
    return loadExternal(UTIL_URL, () => Boolean(window.GMAO_UTIL), '공용 유틸');
  }

  async function loadCartFlow() {
    await loadUtil();
    return loadExternal(CART_URL, () => Boolean(window.CPKR_CART), '쿠팡 장바구니 주문');
  }

  async function loadCheckout() {
    await loadUtil();
    return loadExternal(CHECKOUT_URL, () => Boolean(window.CPKR_CHECKOUT), '쿠팡 주문서');
  }


  function loadCartClear() {
    return loadExternal(CART_CLEAR_URL, () => Boolean(window.CPKR_CART_CLEAR), '장바구니 청소');
  }

  async function loadProductOrder() {
    await loadCartManager();
    return loadExternal(PRODUCT_ORDER_URL, () => Boolean(window.CPKR_PRODUCT_ORDER), '상품 주문 액션');
  }

  function loadCartCompare() {
    return loadExternal(CART_COMPARE_URL, () => Boolean(window.CPKR_CART_COMPARE), '다건 장바구니 비교');
  }

  function payloadOf(job) {
    return job && (job.payload || job) || {};
  }

  function firstItem(job) {
    const payload = payloadOf(job);
    const items = Array.isArray(payload.items) ? payload.items.filter(Boolean) : [];
    const flow = flowGet() || {};
    const index = Math.max(0, Number(flow.item_index || 0));
    return items[index] || items[0] || {};
  }

  function parseCpkrUid(value) {
    const normalized = String(value || '')
      .trim()
      .replace(/^CPKR_/i, '');

    const match = normalized.match(/^(\d+)_(\d+)_(\d+)$/);

    if (!match) {
      return {
        ok: false,
        uid: normalized,
        product_url: '',
        error: 'invalid_cpkr_uid'
      };
    }

    return {
      ok: true,
      uid: normalized,
      product_id: match[1],
      item_id: match[2],
      vendor_item_id: match[3],
      product_url:
        'https://www.coupang.com/vp/products/' +
        encodeURIComponent(match[1]) +
        '?itemId=' + encodeURIComponent(match[2]) +
        '&vendorItemId=' + encodeURIComponent(match[3]),
      error: ''
    };
  }

  function itemAt(job, index) {
    const items = jobItems(job);
    return items[Math.max(0, Number(index || 0))] || null;
  }

  function productUrlForItem(item, job) {
    item = item || {};
    const payload = payloadOf(job);
    const order = payload.order || {};

    const directCandidates = [
      item.product_url,
      item.mall_product_url,
      item.external_product_url,
      item.source_url,
      order.product_url,
      order.mall_product_url,
      order.external_product_url
    ];

    const direct = directCandidates.find(value =>
      /^https?:\/\//i.test(String(value || ''))
    );
    if (direct) return direct;

    for (const candidate of [item.pi_ii_vi, item.source_uid, item.puid, item.product_uid]) {
      const parsed = parseCpkrUid(candidate);
      if (parsed.ok) return parsed.product_url;
    }
    return '';
  }

  function resetCurrentItemRuntime() {
    lastInspection = null;
    lastPreparation = null;
    lastCartAction = null;
    GM_setValue('gmao_runner_inspection_v013', null);
    GM_setValue('gmao_runner_preparation_v013', null);
    GM_setValue('gmao_runner_cart_v013', null);
  }

  function headerCartCount() {
    const node = document.querySelector('#headerCartCount');
    if (!node) return null;
    const raw = String(node.textContent || '').replace(/[^0-9]/g, '');
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  function currentOrderItem(job) {
    const items = jobItems(job);
    if (!items.length) return {};
    const flow = flowGet() || {};
    const index = flow.stage === FLOW.MULTI_ADD_ITEMS
      ? Math.max(0, Number(flow.item_index || 0))
      : 0;
    return items[index] || items[0] || {};
  }

  function currentProductUrl(job) {
    return productUrlForItem(currentOrderItem(job), job);
  }

  async function settleAfterProductPreparation() {
    /*
     * V045 behavior reference:
     * inspection/preparation completed first, then the operator clicked
     * "장바구니 담기" later.  In the automatic flow we must preserve that
     * state-settle gap.  This is one fixed wait only -- no DOM polling.
     */
    await new Promise(resolve => setTimeout(resolve, 1800));
  }

  function directCartUrl() {
    return 'https://cart.coupang.com/cartView.pang';
  }

  function releaseCoupangDom(label) {
    /*
     * Tampermonkey cannot continue executing after the same tab is navigated to
     * literal about:blank. For automatic one-tab operation we therefore destroy
     * the current Coupang DOM completely and do not query it again before the
     * next navigation. This is the operational blank gate used by the runner.
     */
    try {
      document.title = 'about:blank';
      document.documentElement.innerHTML =
        '<head><title>about:blank</title></head>' +
        '<body style="margin:0;background:#fff"></body>';
    } catch (_) {}
  }

  function blankGate(nextUrl, label) {
    const target = String(nextUrl || '');
    if (!target) throw new Error('NEXT_URL_MISSING');

    releaseCoupangDom(label);

    setTimeout(() => {
      location.replace(target);
    }, BLANK_GATE_MS);

    return true;
  }

  function blankWait(stage, message) {
    flowSet({ stage: stage });
    releaseCoupangDom(stage);

    setTimeout(() => {
      /*
       * Rebuild only the Glomart panel. No Coupang DOM is read again while
       * stopped at this agreed test boundary.
       */
      render(message);
    }, 50);
    return true;
  }


  function productUrl(job) {
    return productUrlForItem(firstItem(job), job);
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
    let panel = document.getElementById('gmao-runner-panel-v013');
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = 'gmao-runner-panel-v013';
    panel.style.cssText = [
      'position:fixed',
      'right:12px',
      'bottom:12px',
      'z-index:2147483647',
      'width:350px',
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

  function cartSummary() {
    if (!lastCartAction) return '';

    return [
      '장바구니:',
      lastCartAction.ok ? '확인' : '미확인',
      lastCartAction.method || ''
    ].join(' ');
  }

  function preparationSummary() {
    if (!lastPreparation) return '';

    return [
      '상품준비:',
      '옵션=' +
        (
          lastPreparation.option_result &&
          lastPreparation.option_result.changed
            ? '설정'
            : '변경없음'
        ),
      '수량=' +
        (
          lastPreparation.quantity_result &&
          lastPreparation.quantity_result.after
        )
    ].join(' ');
  }

  function inspectionSummary() {
    if (!lastInspection) return '';

    return [
      '페이지검사:',
      '로그인=' + (lastInspection.login_required ? '필요' : '정상'),
      'PUID일치=' + (lastInspection.puid_match ? '예' : '아니오'),
      '옵션후보=' + lastInspection.option_control_count,
      '수량=' + (lastInspection.quantity_control_found ? '확인' : '없음'),
      '장바구니=' + (lastInspection.cart_button_found ? '확인' : '없음')
    ].join(' ');
  }

  function render(message, error) {
    const panel = ensurePanel();
    panel.innerHTML = '';

    const title = document.createElement('div');
    title.textContent = 'Glomart Runner V' + VERSION.replace(/^0\./, '');
    title.style.cssText =
      'font-weight:800;font-size:14px;margin-bottom:6px';
    panel.appendChild(title);

    const status = document.createElement('div');
    status.textContent =
      message +
      (lastInspection ? '\n' + inspectionSummary() : '') +
      (lastPreparation ? '\n' + preparationSummary() : '') +
      (lastCartAction ? '\n' + cartSummary() : '');
    status.style.color = error ? '#fecaca' : '#d1fae5';
    status.style.whiteSpace = 'pre-wrap';
    panel.appendChild(status);

    const meta = document.createElement('div');
    meta.textContent =
      '\n' + getClientId() +
      '\n페이지: ' + detectPageType() +
      '\n연속세션청소=' + (batchSessionReady() ? '완료' : '필요');
    meta.style.cssText =
      'color:#93c5fd;white-space:pre-wrap;margin-top:4px';
    panel.appendChild(meta);

    if (!currentJob) {
      panel.appendChild(
        createButton('작업 가져오기', () => {
          claim().catch(showError);
        })
      );
      return;
    }

    const flow = initializeFlowForCurrentJob(false) || {};

    if (
      flow.stage !== FLOW.STOPPED_BEFORE_PAYMENT &&
      flow.stage !== FLOW.FAILED_SKIP &&
      flow.stage !== FLOW.COUPANG_BLOCKED_STOP
    ) {
      panel.appendChild(
        createButton('현재 단계 재개', () => {
          orchestrateCurrentFlow().catch(showError);
        })
      );
    }

    panel.appendChild(
      createButton('작업 반환', () => {
        release().catch(showError);
      }, true)
    );
  }

  const STALE_WORK_ERRORS = new Set([
    'work_not_found',
    'work_lock_invalid',
    'work_lock_invalid_or_expired',
    'work_not_running',
    'work_cancelled_by_customer'
  ]);

  function errorCode(error) {
    return String(error && error.message || error || '').trim();
  }

  function isStaleWorkError(error) {
    return STALE_WORK_ERRORS.has(errorCode(error));
  }

  function clearLocalWork() {
    currentJob = null;
    lastInspection = null;
    lastPreparation = null;
    lastCartAction = null;
    GM_setValue('gmao_runner_job_v013', null);
    GM_setValue('gmao_runner_inspection_v013', null);
    GM_setValue('gmao_runner_preparation_v013', null);
    GM_setValue('gmao_runner_cart_v013', null);
    flowClear();
    clearInterval(workHeartbeatTimer);
    workHeartbeatTimer = null;
  }

  function resetContinuousBatchSession() {
    GM_setValue(BATCH_SESSION_KEY, null);
    flowClear();
  }

  function handleWorkHeartbeatError(error) {
    if (isStaleWorkError(error)) {
      const code = errorCode(error);
      clearLocalWork();
      if (code === 'work_cancelled_by_customer') {
        render(
          '고객 주문취소 확인\n' +
          '자동주문을 즉시 중단하고 현재 작업을 비웠습니다.\n' +
          'Runner는 새 작업을 받을 수 있는 상태로 복귀했습니다.',
          true
        );
        return;
      }
      render(
        '서버에서 기존 작업 잠금이 종료된 것을 확인했습니다.\n' +
        'Runner의 오래된 작업을 자동 정리했습니다.\n' +
        code + '\n새 작업 가져오기가 가능합니다.'
      );
      return;
    }
    showError(error);
  }

  function showError(error) {
    const message = String(error && error.message || error);

    if (
      /COUPANG_ACCESS_DENIED|COUPANG_EDGE_BLOCKED|COUPANG_BLOCKED/.test(message)
    ) {
      stopForCoupangBlock({
        blocked: true,
        code: message.split(':')[0] || 'COUPANG_ACCESS_DENIED'
      });
      return;
    }

    render(
      '오류\n' + message,
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
          phase: currentJob
            ? (
              lastCartAction
                ? 'CART_ADDED'
                : (
                  lastPreparation
                    ? 'PRODUCT_PREPARED'
                    : (
                      lastInspection
                        ? 'PRODUCT_INSPECTED'
                        : 'CLAIMED_WAITING_USER'
                    )
                )
            )
            : 'RUNNER_CONNECTED',
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

  async function assertOrderStillActive(phase) {
    /*
     * [CUSTOMER CANCEL / FINAL ORDER GUARD / 중요: 삭제 금지]
     * 자동주문은 쿠팡의 다음 중요 액션을 누르기 직전에 서버 DB를 재확인한다.
     * 고객취소가 들어왔으면 heartbeat가 work_cancelled_by_customer를 반환하고
     * 현재 Runner 작업을 즉시 비운다. 취소 후 장바구니/주문서/최종주문 진행 금지.
     *
     * 향후 실제 FULL_AUTO 최종 주문 버튼을 구현할 때도 클릭 바로 직전에
     * assertOrderStillActive('BEFORE_FINAL_ORDER')를 반드시 호출해야 한다.
     */
    try {
      await workHeartbeat();
      return true;
    } catch (error) {
      handleWorkHeartbeatError(error);
      throw error;
    }
  }

  function startWorkHeartbeat() {
    clearInterval(workHeartbeatTimer);
    if (!currentJob) return;

    workHeartbeatTimer = setInterval(() => {
      workHeartbeat().catch(handleWorkHeartbeatError);
    }, 5000);
  }

  async function claim() {
    if (currentJob) {
      try {
        await workHeartbeat();
        render(
          '이미 유효한 작업을 보유 중입니다.\n작업 #' + currentJob.work_id
        );
        return currentJob;
      } catch (error) {
        if (!isStaleWorkError(error)) throw error;

        const staleCode = errorCode(error);
        clearLocalWork();
        render(
          '기존 로컬 작업이 서버에서 이미 종료되었습니다.\n' +
          staleCode + '\n새 작업을 다시 요청합니다…'
        );
      }
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
    lastInspection = null;
    lastPreparation = null;
    lastCartAction = null;
    GM_setValue('gmao_runner_job_v013', currentJob);
    GM_setValue('gmao_runner_inspection_v013', null);
    GM_setValue('gmao_runner_preparation_v013', null);
    GM_setValue('gmao_runner_cart_v013', null);
    startWorkHeartbeat();

    flowSet({
      work_id: currentJob.work_id,
      stage: FLOW.BATCH_CART_SCAN,
      item_count: orderItemCount(currentJob),
      item_index: 0,
      batch_cart_snapshot: null,
      batch_cart_cleared: false,
      cart_snapshot: null,
      cart_plan: null,
      correction_pass: 0
    });

    render(
      '작업 배정 완료\n' +
      '#' + currentJob.work_id + '\n' +
      currentJob.auto_order_no + '\n' +
      '쿠팡 헤더 장바구니 숫자 확인 후 필요할 때만 청소 시작'
    );

    setTimeout(() => { orchestrateCurrentFlow().catch(showError); }, 300);
    return currentJob;
  }

  function detectCoupangLoginState() {
    // Current Coupang desktop header exposes a real logout anchor only when
    // the browser session is authenticated. Do not infer login state from
    // href/HTML containing the word "login" because logout URLs also live
    // under login.coupang.com.
    const logout = document.querySelector(
      'a.logout-link, a[title="로그아웃"]'
    );
    if (logout) {
      return { logged_in: true, source: 'logout_link' };
    }

    const anchors = Array.from(document.querySelectorAll('a'));
    const logoutText = anchors.some((a) =>
      String(a.textContent || '').trim() === '로그아웃'
    );
    if (logoutText) {
      return { logged_in: true, source: 'logout_text' };
    }

    const loginText = anchors.some((a) =>
      String(a.textContent || '').trim() === '로그인'
    );
    if (loginText) {
      return { logged_in: false, source: 'login_link' };
    }

    return { logged_in: null, source: 'unknown' };
  }

  function normalizeInspectionLogin(inspection) {
    if (!inspection || typeof inspection !== 'object') return inspection;
    const state = detectCoupangLoginState();
    inspection.login_dom_state = state.source;
    if (state.logged_in === true) inspection.login_required = false;
    if (state.logged_in === false) inspection.login_required = true;
    return inspection;
  }

  async function inspectProductPage() {
    if (!currentJob) {
      throw new Error('먼저 작업을 가져오세요.');
    }
    if (detectPageType() !== 'PRODUCT') {
      throw new Error('쿠팡 상품 상세 페이지에서 실행하세요.');
    }

    await loadInspector();

    const item = currentOrderItem(currentJob);
    const expected = Object.assign(
      {},
      item,
      { product_url: currentProductUrl(currentJob) }
    );

    lastInspection = normalizeInspectionLogin(
      window.GMAO_CPKR_PRODUCT_INSPECTOR.inspect(expected)
    );

    GM_setValue(
      'gmao_runner_inspection_v013',
      lastInspection
    );

    await clientHeartbeat();

    if (lastInspection.login_required) {
      render('상품 페이지 검사 완료\n쿠팡 로그인이 필요합니다.', true);
      return lastInspection;
    }

    if (!lastInspection.puid_match) {
      render(
        '상품 페이지 검사 완료\nPUID(productId/itemId/vendorItemId)가 주문값과 다릅니다.',
        true
      );
      return lastInspection;
    }

    render(
      '상품 페이지 검사 완료\n' +
      (lastInspection.title || '상품명 확인 안 됨')
    );

    return lastInspection;
  }

  async function prepareProductPage() {
    if (!currentJob) {
      throw new Error('먼저 작업을 가져오세요.');
    }

    if (!lastInspection) {
      throw new Error('먼저 상품 페이지 검사를 실행하세요.');
    }

    await loadPreparer();

    const item = currentOrderItem(currentJob);

    lastPreparation =
      await window.GMAO_CPKR_PRODUCT_PREPARER.prepare(
        item,
        lastInspection
      );

    GM_setValue(
      'gmao_runner_preparation_v013',
      lastPreparation
    );

    await loadInspector();

    const refreshedInspection =
      window.GMAO_CPKR_PRODUCT_INSPECTOR.inspect(
        Object.assign({}, item, {
          product_url: currentProductUrl(currentJob)
        })
      );

    lastInspection = refreshedInspection;
    GM_setValue(
      'gmao_runner_inspection_v013',
      refreshedInspection
    );

    await clientHeartbeat();

    render(
      'PUID 확인/수량 준비 완료\n' +
      '옵션은 변경하지 않았고 수량만 확인/조정했습니다.'
    );

    return lastPreparation;
  }



  async function autoInspectAndPrepareProductPage() {
    if (autoProductFlowRunning) return;
    if (!currentJob || detectPageType() !== 'PRODUCT') return;

    autoProductFlowRunning = true;
    try {
      render('상품 페이지 자동 확인 중…\nPUID 검증 후 주문수량만 확인/조정합니다.');

      const inspection = await inspectProductPage();

      if (!inspection || inspection.login_required) return;
      if (!inspection.puid_match) return;

      const preparation = await prepareProductPage();
      const qtyResult = preparation && preparation.quantity_result || {};
      const requestedQty = Number(firstItem(currentJob).qty || firstItem(currentJob).quantity || 1);
      const actualQty = Number(qtyResult.after || 0);

      if (actualQty && requestedQty > 0 && actualQty !== requestedQty) {
        render(
          '자동 상품 준비 확인 필요\n' +
          'PUID는 일치하지만 주문수량 설정 결과가 다릅니다.\n' +
          '주문수량=' + requestedQty + ' / 화면수량=' + actualQty,
          true
        );
        return;
      }

      render(
        '자동 상품 준비 완료\n' +
        'PUID 일치 · 옵션 변경 없음 · 주문수량=' +
        (actualQty || requestedQty) + '\n' +
        '상품 준비 완료'
      );
    } catch (error) {
      showError(error);
    } finally {
      autoProductFlowRunning = false;
    }
  }

  async function addCurrentItemToCart() {
    if (!currentJob) throw new Error('먼저 작업을 가져오세요.');
    if (!lastPreparation) throw new Error('먼저 옵션/수량 준비를 실행하세요.');
    if (detectPageType() !== 'PRODUCT') throw new Error('쿠팡 상품 상세 페이지에서 실행하세요.');
    await assertOrderStillActive('BEFORE_ADD_TO_CART');

    // V059: restore the proven V045 cart-add execution path.
    // ProductOrder remains for Buy Now; cart add calls CartManager directly.
    await loadCartManager();
    lastCartAction = await window.GMAO_CPKR_CART_MANAGER.addToCart();
    GM_setValue('gmao_runner_cart_v013', lastCartAction);
    await clientHeartbeat();
    render('장바구니 담기 실행 완료\n' + (lastCartAction.ok ? '쿠팡 확인 신호가 감지되었습니다.' : '확인 신호를 확인하지 못했습니다.'));
    return lastCartAction;
  }

  async function openCurrentCart() {
    if (!currentJob) {
      throw new Error('먼저 작업을 가져오세요.');
    }

    await assertOrderStillActive('BEFORE_OPEN_CART');
    await loadCartManager();

    render('기존 장바구니 작업을 이어서 진행합니다.\n장바구니에서 주문 상품을 다시 검증하세요.');

    if (
      window.GMAO_CPKR_CART_MANAGER &&
      typeof window.GMAO_CPKR_CART_MANAGER.openCart === 'function'
    ) {
      window.GMAO_CPKR_CART_MANAGER.openCart();
      return true;
    }

    location.href = 'https://cart.coupang.com/cartView.pang';
    return true;
  }



  function jobItems(job) {
    const payload = payloadOf(job);
    return Array.isArray(payload.items) ? payload.items.filter(Boolean) : [];
  }

  function num(v, fallback) {
    const n = Number(String(v == null ? '' : v).replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : (fallback == null ? 0 : fallback);
  }

  function itemQty(item) {
    const candidates = [
      item && item.quantity,
      item && item.qty,
      item && item.order_qty,
      item && item.order_quantity,
      item && item.product_qty,
      item && item.count
    ];
    for (const v of candidates) {
      const n = num(v, 0);
      if (n > 0) return Math.floor(n);
    }
    return 1;
  }

  function cpkrIdentityFromItem(item) {
    item = item || {};

    function digits(v) {
      return String(v == null ? '' : v).replace(/\D/g, '');
    }

    function parseUrlIdentity(raw) {
      const value = String(raw || '').trim();
      if (!value) return null;
      try {
        const u = new URL(value, location.href);
        const pm = u.pathname.match(/\/vp\/products\/(\d+)/i);
        const pid = pm ? pm[1] : '';
        const iid = digits(u.searchParams.get('itemId'));
        const vid = digits(u.searchParams.get('vendorItemId'));
        if (pid && vid) {
          return {
            puid: pid && iid && vid ? [pid, iid, vid].join('_') : '',
            pid, iid, vid
          };
        }
      } catch (_) {}
      return null;
    }

    function parseLooseUid(raw) {
      const value = String(raw || '').trim();
      if (!value) return null;

      // First keep the established exact parser.
      const exact = parseCpkrUid(value);
      if (exact && exact.ok) {
        return {
          puid: [
            exact.product_id,
            exact.item_id,
            exact.vendor_item_id
          ].join('_'),
          pid: String(exact.product_id),
          iid: String(exact.item_id),
          vid: String(exact.vendor_item_id)
        };
      }

      // Accept stored forms such as CPKR:PID_IID_VID, PID-IID-VID,
      // or strings containing one three-number PUID sequence.
      const m = value.match(/(?:^|[^\d])(\d{6,})[_:\-\/](\d{6,})[_:\-\/](\d{6,})(?:[^\d]|$)/);
      if (m) {
        return {
          puid: [m[1], m[2], m[3]].join('_'),
          pid: m[1],
          iid: m[2],
          vid: m[3]
        };
      }
      return null;
    }

    // 1. Explicit PUID-like fields first.
    const uidCandidates = [
      item.puid,
      item.PUID,
      item.product_uid,
      item.productUid,
      item.pi_ii_vi,
      item.piIiVi,
      item.source_uid,
      item.sourceUid,
      item.mall_uid,
      item.mallUid,
      item.coupang_uid,
      item.cpkr_uid
    ];

    for (const raw of uidCandidates) {
      const parsed = parseLooseUid(raw);
      if (parsed) return parsed;
    }

    // 2. Explicit PID / IID / VID columns.
    const directPid = digits(
      item.product_id || item.productId || item.pid ||
      item.mall_product_id || item.mallProductId ||
      item.source_product_id || item.sourceProductId
    );

    const directIid = digits(
      item.item_id || item.itemId || item.iid ||
      item.mall_item_id || item.mallItemId ||
      item.source_item_id || item.sourceItemId
    );

    const directVid = digits(
      item.vendor_item_id || item.vendorItemId ||
      item.vendor_id || item.vendorId || item.vid ||
      item.mall_vendor_item_id || item.mallVendorItemId ||
      item.source_vendor_item_id || item.sourceVendorItemId
    );

    if (directPid && directVid) {
      return {
        puid: directPid && directIid && directVid
          ? [directPid, directIid, directVid].join('_')
          : '',
        pid: directPid,
        iid: directIid,
        vid: directVid
      };
    }

    // 3. Product URL fields — Coupang cart URLs often expose PID + vendorItemId
    // even when itemId is omitted.
    const urlCandidates = [
      item.product_url,
      item.productUrl,
      item.mall_product_url,
      item.mallProductUrl,
      item.external_product_url,
      item.externalProductUrl,
      item.source_url,
      item.sourceUrl,
      item.url,
      item.link
    ];

    for (const raw of urlCandidates) {
      const parsed = parseUrlIdentity(raw);
      if (parsed) return parsed;
    }

    // 4. Common nested source/mall/product objects, but only known ID/url fields.
    const nested = [
      item.source,
      item.mall,
      item.product,
      item.external,
      item.cpkr,
      item.coupang
    ].filter(x => x && typeof x === 'object');

    for (const obj of nested) {
      const nestedResult = cpkrIdentityFromItem(obj);
      if (nestedResult && nestedResult.pid && nestedResult.vid) {
        return nestedResult;
      }
    }

    return { puid: '', pid: directPid, iid: directIid, vid: directVid };
  }

  /*
   * V048: cart DOM implementation moved to server modules.
   * - CPKR_CART_CLEAR.js: batch-start snapshot / clear
   * - CPKR_CART_COMPARE.js: multi-order snapshot / compare / adjustment / checkout
   * Runner owns only orchestration and state.
   */

  function flowMatchesCurrentJob(flow) {
    return !!(
      flow &&
      currentJob &&
      Number(flow.work_id || 0) === Number(currentJob.work_id || 0)
    );
  }

  function initializeFlowForCurrentJob(force) {
    if (!currentJob) return null;
    const existing = flowGet();

    if (!force && flowMatchesCurrentJob(existing)) return existing;

    return flowSet({
      work_id: currentJob.work_id,
      stage: FLOW.BATCH_CART_SCAN,
      item_count: orderItemCount(currentJob),
      item_index: 0,
      batch_cart_snapshot: null,
      batch_cart_cleared: false,
      cart_snapshot: null,
      cart_plan: null,
      correction_pass: 0
    });
  }

  async function continueImmediatelyAfterCartReady(reason) {
    if (!currentJob) throw new Error('현재 주문이 없습니다.');

    flowSet({
      stage: FLOW.ORDER_START,
      cart_ready_reason: String(reason || ''),
      cart_ready_at: Date.now()
    });

    /*
     * Do not stop at about:blank after cart cleanup.
     * ORDER_START owns the single/multi split and opens the first product URL.
     */
    await continueOrderAfterBatchWait();
  }

  async function continueOrderAfterBatchWait() {
    if (!currentJob) throw new Error('현재 주문이 없습니다.');

    const count = orderItemCount(currentJob);
    if (count <= 0) throw new Error('ORDER_ITEM_EMPTY');

    resetCurrentItemRuntime();

    const nextStage = count === 1
      ? FLOW.SINGLE_PRODUCT
      : FLOW.MULTI_ADD_ITEMS;

    flowSet({
      stage: nextStage,
      item_count: count,
      item_index: 0
    });

    const item = itemAt(currentJob, 0);
    const url = productUrlForItem(item, currentJob);
    if (!url) throw new Error('CPKR_PRODUCT_URL_MISSING');

    render(
      count === 1
        ? '단건 주문 시작\n장바구니를 사용하지 않고 바로구매로 진행합니다.'
        : '다건 주문 시작\n각 상품을 장바구니에 순서대로 담습니다.'
    );

    blankGate(url, 'ORDER_START');
    return true;
  }

  async function runSingleProductFlow() {
    if (detectPageType() !== 'PRODUCT') {
      const url = productUrl(currentJob);
      if (!url) throw new Error('CPKR_PRODUCT_URL_MISSING');
      blankGate(url, 'SINGLE_PRODUCT');
      return;
    }

    const inspection = await inspectProductPage();
    if (!inspection || inspection.login_required) return;
    if (!inspection.puid_match) throw new Error('PRODUCT_PUID_MISMATCH');

    await prepareProductPage();
    await settleAfterProductPreparation();
    await singleBuyNow();
  }

  async function runMultiProductFlow() {
    const flow = flowGet() || {};
    const items = jobItems(currentJob);
    const index = Math.max(0, Number(flow.item_index || 0));
    const item = items[index];

    if (!item) throw new Error('MULTI_ITEM_INDEX_INVALID');

    if (detectPageType() !== 'PRODUCT') {
      const url = productUrlForItem(item, currentJob);
      if (!url) throw new Error('CPKR_PRODUCT_URL_MISSING');
      blankGate(url, 'MULTI_ITEM_' + index);
      return;
    }

    const inspection = await inspectProductPage();
    if (!inspection || inspection.login_required) return;
    if (!inspection.puid_match) throw new Error('PRODUCT_PUID_MISMATCH');

    await prepareProductPage();

    render(
      '상품 준비 완료 · 쿠팡 상태 반영 대기 후 장바구니 담기\n' +
      'PUID/옵션/수량 준비값은 더 이상 변경하지 않습니다.'
    );
    await settleAfterProductPreparation();

    const added = await addCurrentItemToCart();
    if (!added || !added.ok) throw new Error('ADD_TO_CART_NOT_CONFIRMED');

    const nextIndex = index + 1;

    if (nextIndex < items.length) {
      resetCurrentItemRuntime();
      flowSet({
        stage: FLOW.MULTI_ADD_ITEMS,
        item_index: nextIndex
      });

      const nextUrl = productUrlForItem(items[nextIndex], currentJob);
      if (!nextUrl) throw new Error('CPKR_PRODUCT_URL_MISSING');
      blankGate(nextUrl, 'MULTI_NEXT_ITEM');
      return;
    }

    resetCurrentItemRuntime();
    flowSet({
      stage: FLOW.MULTI_CART_SNAPSHOT,
      item_index: nextIndex
    });

    blankGate(directCartUrl(), 'MULTI_CART_SNAPSHOT');
  }

  async function continueMultiAfterCompare(plan, snapshot) {
    const flow = flowGet() || {};
    const correctionPass = Math.max(0, Number(flow.correction_pass || 0));

    lastCartAction = {
      ok: !!plan.ok,
      method: 'multi-cart-compare',
      snapshot,
      plan,
      correction_pass: correctionPass
    };
    GM_setValue('gmao_runner_cart_v013', lastCartAction);
    await clientHeartbeat();

    if (plan.ok) {
      flowSet({
        stage: FLOW.MULTI_CART_CHECKOUT,
        cart_snapshot: snapshot,
        cart_plan: plan
      });

      render(
        '다건 장바구니 검증 일치\n' +
        '주문상품=' + plan.target_count +
        ' · 장바구니=' + plan.cart_count +
        '\n전체선택 후 주문/결제로 진행합니다.'
      );

      blankGate(directCartUrl(), 'MULTI_CART_CHECKOUT');
      return;
    }

    if (correctionPass >= 1) {
      const reason =
        'CART_FINAL_MISMATCH' +
        ' missing=' + plan.missing.length +
        ' extra=' + plan.extra.length +
        ' qty=' + plan.qty_mismatch.length;

      flowSet({
        stage: FLOW.FAILED_SKIP,
        cart_snapshot: snapshot,
        cart_plan: plan,
        failure_reason: reason
      });

      render(
        '장바구니 최종 검증 불일치 · 반복하지 않고 주문 패스\n' +
        reason,
        true
      );
      return;
    }

    flowSet({
      stage: FLOW.MULTI_CART_APPLY,
      cart_snapshot: snapshot,
      cart_plan: plan,
      correction_pass: 1
    });

    render(
      '장바구니 불일치 · 1회 보정 진행\n' +
      '누락=' + plan.missing.length +
      ' · 추가=' + plan.extra.length +
      ' · 수량차이=' + plan.qty_mismatch.length
    );

    blankGate(directCartUrl(), 'MULTI_CART_APPLY');
  }

  async function applyMultiCartPlanOnce() {
    const flow = flowGet() || {};
    const plan = flow.cart_plan;
    if (!plan) throw new Error('MULTI_CART_PLAN_MISSING');
    if (detectPageType() !== 'CART') {
      blankGate(directCartUrl(), 'MULTI_CART_APPLY');
      return;
    }

    await assertOrderStillActive('BEFORE_CART_CORRECTION');
    await loadCartCompare();

    const applied = await window.CPKR_CART_COMPARE.applyPlan(plan);
    if (!applied || applied.ok === false) {
      throw new Error('CART_CORRECTION_FAILED');
    }

    /*
     * One correction only. Re-enter cart and take one final snapshot.
     * No correction loop is allowed.
     */
    flowSet({
      stage: FLOW.MULTI_CART_SNAPSHOT,
      correction_pass: 1,
      cart_apply_result: applied
    });
    blankGate(directCartUrl(), 'MULTI_FINAL_VERIFY');
  }

  async function checkoutVerifiedMultiCart() {
    if (detectPageType() !== 'CART') {
      blankGate(directCartUrl(), 'MULTI_CART_CHECKOUT');
      return;
    }

    await assertOrderStillActive('BEFORE_MULTI_CHECKOUT');
    await loadCartCompare();

    /*
     * The cart was already verified from a detached snapshot.
     * Do not perform another comparison here; select all and enter checkout.
     */
    flowSet({ stage: FLOW.CHECKOUT });
    render('다건 장바구니 검증 완료 · 전체선택 후 주문/결제로 이동합니다.');
    await window.CPKR_CART_COMPARE.selectAllAndCheckout();
  }


  async function orchestrateCurrentFlow() {
    if (!currentJob) return;

    const block = detectCoupangBlockPage();
    if (block.blocked) {
      stopForCoupangBlock(block);
      return;
    }

    const flow = initializeFlowForCurrentJob(false) || {};
    const stage = flow.stage || FLOW.BATCH_CART_SCAN;
    const page = detectPageType();

    if (page === 'AUTH') {
      await autoStepupAuth();
      return;
    }

    switch (stage) {
      case FLOW.ORDER_START:
        await continueOrderAfterBatchWait();
        return;

      case FLOW.BATCH_CART_SCAN: {
        /*
         * V054: first decision uses only Coupang's header cart badge.
         * #headerCartCount == 0  -> no cart page / no cart cleanup.
         * #headerCartCount > 0   -> enter cart and bulk-clear.
         * If the badge is unavailable, fall back to the cart page once.
         */
        const liveCount = headerCartCount();

        if (liveCount === 0) {
          batchSessionSet({
            cart_cleaned: true,
            cleaned_at: Date.now(),
            method: 'header-count-zero'
          });
          flowSet({
            stage: FLOW.ORDER_START,
            batch_cart_snapshot: [],
            batch_cart_cleared: true,
            header_cart_count: 0
          });
          render(
            '장바구니 확인 완료\n' +
            '헤더 장바구니=0 · 청소 불필요 · 주문을 바로 시작합니다.'
          );
          await continueImmediatelyAfterCartReady('header-count-zero');
          return;
        }

        if (liveCount !== null && liveCount > 0) {
          flowSet({
            stage: FLOW.BATCH_CART_CLEAR,
            header_cart_count: liveCount
          });
          blankGate(directCartUrl(), 'BATCH_CART_CLEAR');
          return;
        }

        if (page !== 'CART') {
          blankGate(directCartUrl(), 'BATCH_CART_SCAN_FALLBACK');
          return;
        }

        await loadCartClear();
        const snapshot = window.CPKR_CART_CLEAR.snapshot();

        if (!snapshot.length) {
          batchSessionSet({
            cart_cleaned: true,
            cleaned_at: Date.now(),
            method: 'cart-fallback-empty'
          });
          flowSet({
            stage: FLOW.ORDER_START,
            batch_cart_snapshot: [],
            batch_cart_cleared: true
          });
          render(
            '장바구니 확인 완료\n' +
            '장바구니 비어 있음 · 주문을 바로 시작합니다.'
          );
          await continueImmediatelyAfterCartReady('cart-fallback-empty');
          return;
        }

        flowSet({
          stage: FLOW.BATCH_CART_CLEAR,
          batch_cart_snapshot: snapshot
        });
        await orchestrateCurrentFlow();
        return;
      }

      case FLOW.BATCH_CART_CLEAR: {
        if (page !== 'CART') {
          blankGate(directCartUrl(), 'BATCH_CART_CLEAR');
          return;
        }

        await loadCartClear();
        const cleared = await window.CPKR_CART_CLEAR.clearAll();
        if (!cleared || cleared.ok !== true) {
          throw new Error('CART_CLEAR_NOT_CONFIRMED');
        }

        batchSessionSet({
          cart_cleaned: true,
          cleaned_at: Date.now(),
          method: 'cleared',
          deleted_count: Number(cleared.requested || 0)
        });

        flowSet({
          stage: FLOW.ORDER_START,
          batch_cart_cleared: true,
          batch_clear_result: cleared
        });

        render(
          '장바구니 청소 완료 · 주문을 바로 시작합니다.\n' +
          '삭제요청=' + Number(cleared.requested || 0)
        );

        await continueImmediatelyAfterCartReady('cart-cleared');
        return;
      }

      case FLOW.BATCH_CLEAN_WAIT:
        await continueImmediatelyAfterCartReady('legacy-clean-wait-recovery');
        return;

      case FLOW.SINGLE_PRODUCT:
        await runSingleProductFlow();
        return;

      case FLOW.MULTI_ADD_ITEMS:
        await runMultiProductFlow();
        return;

      case FLOW.MULTI_CART_SNAPSHOT: {
        if (page !== 'CART') {
          blankGate(directCartUrl(), 'MULTI_CART_SNAPSHOT');
          return;
        }

        await loadCartCompare();
        const snapshot = window.CPKR_CART_COMPARE.snapshot();

        flowSet({
          stage: FLOW.MULTI_SNAPSHOT_RELEASE,
          cart_snapshot: snapshot
        });

        /*
         * Release the Coupang DOM first. Comparison is then performed only
         * against the detached snapshot and our order payload.
         */
        releaseCoupangDom('MULTI_SNAPSHOT_RELEASE');

        setTimeout(() => {
          try {
            const f = flowGet() || {};
            const detached = Array.isArray(f.cart_snapshot) ? f.cart_snapshot : [];
            const plan = window.CPKR_CART_COMPARE.compare(
              jobItems(currentJob),
              detached
            );
            continueMultiAfterCompare(plan, detached).catch(showError);
          } catch (error) {
            showError(error);
          }
        }, 80);
        return;
      }

      case FLOW.MULTI_SNAPSHOT_RELEASE: {
        await loadCartCompare();
        const detached = Array.isArray(flow.cart_snapshot) ? flow.cart_snapshot : [];
        const plan = window.CPKR_CART_COMPARE.compare(
          jobItems(currentJob),
          detached
        );
        await continueMultiAfterCompare(plan, detached);
        return;
      }

      case FLOW.MULTI_CART_APPLY:
        await applyMultiCartPlanOnce();
        return;

      case FLOW.MULTI_CART_CHECKOUT:
        await checkoutVerifiedMultiCart();
        return;

      case FLOW.CHECKOUT:
        if (page !== 'CHECKOUT') return;
        await fillCheckoutAndStop();
        return;

      case FLOW.STOPPED_BEFORE_PAYMENT:
        render('결제 직전 정지 상태');
        return;

      case FLOW.FAILED_SKIP:
        render('주문 실패 기록 후 패스 상태', true);
        return;

      case FLOW.COUPANG_BLOCKED_STOP:
        render(
          '쿠팡 접근 차단 상태 · 자동작업 정지\n' +
          '사용자가 정상 접속을 확인하기 전까지 재시도하지 않습니다.',
          true
        );
        return;

      default:
        throw new Error('UNKNOWN_FLOW_STAGE:' + stage);
    }
  }

  async function singleBuyNow() {
    if (!currentJob) throw new Error('현재 주문이 없습니다.');
    if (detectPageType() !== 'PRODUCT') throw new Error('상품 상세 페이지에서 실행하세요.');
    await assertOrderStillActive('BEFORE_BUY_NOW');
    await loadProductOrder();
    flowSet({stage:FLOW.CHECKOUT,item_count:1});
    return window.CPKR_PRODUCT_ORDER.buyNow();
  }

  function nativeInputValue(input, value) {
    const proto = input instanceof HTMLInputElement ? HTMLInputElement.prototype : null;
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(input, String(value == null ? '' : value));
    else input.value = String(value == null ? '' : value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function fetchLockedCredential() {
    if (!currentJob) throw new Error('추가인증용 현재 작업이 없습니다.');
    const result = await request(
      '/api/auto-order/runtime/work/' + encodeURIComponent(currentJob.work_id) + '/credential',
      'POST',
      settings({ lock_token: currentJob.lock_token })
    );
    const c = result && result.credential || {};
    if (!c.password) throw new Error('CPKR_MASTER 비밀번호가 컨트롤타워에 등록되지 않았습니다.');
    return c;
  }

  function findPasswordMethodButton() {
    const all = Array.from(document.querySelectorAll('button,a,[role="button"],div'));
    return all.find(el => {
      if (!el || !el.getBoundingClientRect) return false;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const t = String(el.textContent || '').replace(/\s+/g, ' ').trim();
      return /비밀번호\s*확인/.test(t) && t.length < 80;
    }) || null;
  }

  async function autoStepupAuth() {
    if (!currentJob || detectPageType() !== 'AUTH') return false;

    // 인증방법 선택 화면이면 "비밀번호 확인"을 자동 선택한다.
    const pwdInput = document.querySelector('#auth-password-input,input[name="password"][type="password"]');
    if (!pwdInput) {
      const methodButton = findPasswordMethodButton();
      if (methodButton) {
        GM_setValue('gmao_runner_auth_status_v023', { state: 'PASSWORD_METHOD_SELECTED', ts: Date.now() });
        render('쿠팡 추가인증 감지\n비밀번호 확인 방식을 선택합니다.');
        methodButton.click();
        return true;
      }
      return false;
    }

    await assertOrderStillActive('BEFORE_STEPUP_AUTH');
    let credential = await fetchLockedCredential();
    GM_setValue('gmao_runner_auth_status_v023', { state: 'PASSWORD_FILLING', ts: Date.now() });
    render('쿠팡 추가인증 감지\nCPKR_MASTER 비밀번호를 자동 입력합니다.');

    nativeInputValue(pwdInput, credential.password);
    credential.password = '';
    await new Promise(resolve => setTimeout(resolve, 250));

    const submit = document.querySelector('button[type="submit"].authentication-password__submit-btn,button[type="submit"]');
    if (!submit) throw new Error('쿠팡 추가인증 계속하기 버튼을 찾지 못했습니다.');
    if (submit.disabled) {
      pwdInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    GM_setValue('gmao_runner_auth_status_v023', { state: 'PASSWORD_SUBMITTED', ts: Date.now() });
    submit.click();
    return true;
  }

  function setAddressBridge(value) {
    GM_setValue(ADDRESS_BRIDGE_KEY, Object.assign({ ts: Date.now() }, value || {}));
  }

  function getAddressBridge() {
    return GM_getValue(ADDRESS_BRIDGE_KEY, null);
  }

  async function waitAddressBridgeDone(workId, timeoutMs) {
    const started = Date.now();
    const timeout = timeoutMs || 90000;
    while (Date.now() - started < timeout) {
      const state = getAddressBridge();
      if (state && String(state.work_id) === String(workId)) {
        if (state.state === 'DONE') return state;
        if (state.state === 'ERROR') throw new Error(state.error || 'ADDRESS_BRIDGE_ERROR');
        if (state.phase) render('배송지 iframe 자동입력 진행\n' + state.phase);
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('ADDRESS_BRIDGE_TIMEOUT');
  }

  async function runAddressIframeBridge() {
    if (location.hostname !== 'id.coupang.com') return false;
    /* 추가인증 등 다른 id.coupang.com iframe에는 절대 배송지 자동입력을 실행하지 않는다. */
    if (!/^\/addressbook\//.test(location.pathname)) return true;

    /* 배송지 iframe이 먼저 열린 상태에서 부모가 나중에 버튼을 눌러 REQUESTED를 기록할 수 있다.
     * 따라서 1회 조회 후 종료하지 않고 이 frame 안에서 요청을 기다린다. */
    let bridge = null;
    const waitStarted = Date.now();
    while (Date.now() - waitStarted < 300000) {
      const candidate = getAddressBridge();
      if (candidate && candidate.state === 'REQUESTED' && candidate.receiver) {
        bridge = candidate;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!bridge) return true;

    try {
      await loadCheckout();
      setAddressBridge(Object.assign({}, bridge, { state: 'RUNNING', phase: '배송지 iframe 진입 확인' }));
      const result = await window.CPKR_CHECKOUT.fillAddressOnly(bridge.receiver, function (phase) {
        setAddressBridge(Object.assign({}, bridge, { state: 'RUNNING', phase: phase }));
      }, {
        action: bridge.action || 'ADD',
        current_address_text: bridge.current_address_text || ''
      });
      setAddressBridge(Object.assign({}, bridge, {
        state: 'DONE',
        phase: '배송지 저장/적용 완료',
        result: result || { ok: true }
      }));
    } catch (error) {
      setAddressBridge(Object.assign({}, bridge, {
        state: 'ERROR',
        phase: '배송지 iframe 처리 실패',
        error: String(error && error.message || error)
      }));
    }
    return true;
  }

  async function fillCheckoutAndStop() {
    if (!currentJob) throw new Error('먼저 작업을 가져오세요.');
    if (detectPageType() !== 'CHECKOUT') throw new Error('쿠팡 주문/결제 페이지에서 실행하세요.');

    const payload = payloadOf(currentJob);
    const receiver = payload.receiver || {};
    if (!receiver.name || !receiver.phone || !receiver.zipcode || !receiver.road_address) {
      throw new Error('Glomart 배송지 payload가 불완전합니다.');
    }

    await assertOrderStillActive('BEFORE_CHECKOUT_FILL');
    await loadCheckout();

    const checkoutOrder = Object.assign({}, payload.order || {}, {
      receiver,
      shipping: receiver,
      address: receiver
    });

    const addressPlan = window.CPKR_CHECKOUT.inspectAddress(checkoutOrder);
    const branchLabel = addressPlan.branch === 'EMPTY'
      ? '1/3 배송지 없음 → 추가'
      : addressPlan.branch === 'SAME'
        ? '2/3 배송지 일치 → 그대로 진행'
        : '3/3 배송지 다름 → 현재 배송지 수정';
    render('배송지 분기 확인\n' + branchLabel);

    if (addressPlan.action !== 'KEEP') {
      setAddressBridge({
        state: 'REQUESTED',
        phase: addressPlan.action === 'EDIT' ? '현재 배송지 수정 대기' : '신규 배송지 추가 대기',
        work_id: currentJob.work_id,
        auto_order_no: currentJob.auto_order_no,
        action: addressPlan.action,
        current_address_text: addressPlan.current_text || '',
        receiver: receiver
      });
    } else {
      setAddressBridge({
        state: 'SKIPPED',
        phase: '현재 배송지와 주문 배송지 일치',
        work_id: currentJob.work_id,
        auto_order_no: currentJob.auto_order_no,
        action: 'KEEP',
        receiver: receiver
      });
    }

    const result = await window.CPKR_CHECKOUT.fillAndStop(checkoutOrder, {
      addressPlan: addressPlan,
      onProgress: function (phase) {
        render('배송지 처리 진행\n' + branchLabel + '\n' + phase);
      },
      waitForAddressBridge: function () {
        return waitAddressBridgeDone(currentJob.work_id, 90000);
      }
    });

    const action = result && result.address_result && result.address_result.action || addressPlan.action;
    const persisted = action === 'ADD' || action === 'EDIT';
    const message = action === 'KEEP'
      ? '기존 배송지 일치 확인 후 결제하기 직전 정지'
      : (action === 'EDIT'
          ? '기존 배송지를 주문 배송지로 수정/선택 후 결제하기 직전 정지'
          : '배송지 신규 추가/선택 후 결제하기 직전 정지');

    await request(
      '/api/auto-order/runtime/work/' + encodeURIComponent(currentJob.work_id) + '/state',
      'POST',
      settings({
        lock_token: currentJob.lock_token,
        status: 'STOPPED_BEFORE_PAYMENT',
        detail: {
          phase: 'CHECKOUT_STOPPED_BEFORE_PAYMENT',
          message: message,
          address_branch: addressPlan.branch,
          address_action: action,
          address_persisted: persisted,
          default_address: false
        }
      })
    );

    clearInterval(workHeartbeatTimer);
    GM_setValue('gmao_runner_job_v013', null);
    currentJob = null;
    render('결제하기 직전 정지 완료\n' + message + '\n최종 결제는 사람이 확인 후 진행하세요.');
    return result;
  }

  async function release() {
    if (!currentJob) return;

    const job = currentJob;

    try {
      await request(
        '/api/auto-order/runtime/work/' +
        encodeURIComponent(job.work_id) +
        '/release',
        'POST',
        settings({
          lock_token: job.lock_token
        })
      );

      clearLocalWork();
      render('작업을 서버 READY 상태로 반환했고 Runner도 비웠습니다.');
    } catch (error) {
      if (!isStaleWorkError(error)) throw error;

      const staleCode = errorCode(error);
      clearLocalWork();
      render(
        '서버에서는 이 작업이 이미 반환/종료된 상태입니다.\n' +
        'Runner에 남아 있던 오래된 작업만 정리했습니다.\n' +
        staleCode + '\n새 작업 가져오기가 가능합니다.'
      );
    }
  }

  async function start() {
    try {
      /* id.coupang.com 배송지 iframe은 PC Runner 등록/heartbeat를 중복 실행하지 않는다. */
      if (location.hostname === 'id.coupang.com') {
        await runAddressIframeBridge();
        return;
      }

      await register();
      await clientHeartbeat();

      clientHeartbeatTimer = setInterval(() => {
        clientHeartbeat().catch(showError);
      }, 20000);

      if (currentJob) {
        try {
          await workHeartbeat();
          startWorkHeartbeat();
          const flow = initializeFlowForCurrentJob(false);
          render(
            '기존 작업 복구 완료\n' +
            '#' + currentJob.work_id + '\n' +
            currentJob.auto_order_no + '\n' +
            '단계=' + String(flow && flow.stage || '')
          );
          setTimeout(() => {
            orchestrateCurrentFlow().catch(showError);
          }, 500);
        } catch (error) {
          if (isStaleWorkError(error)) {
            const staleCode = errorCode(error);
            clearLocalWork();
            render(
              '기존 로컬 작업은 서버에서 더 이상 유효하지 않습니다.\n' +
              staleCode + '\n자동 정리 완료 · 새 작업 배정 대기'
            );
          } else {
            startWorkHeartbeat();
            showError(error);
          }
        }
      } else {
        render('온라인\n수동 작업 배정 대기');
      }
    } catch (error) {
      showError(error);
    }
  }

  start();
})();
