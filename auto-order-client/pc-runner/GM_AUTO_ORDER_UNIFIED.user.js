// ==UserScript==
// @name         Glomart Auto Order PC Runner
// @namespace    https://koims.market/auto-order
// @version      0.032
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

  const VERSION = '0.033';
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
    '/auto-order-client/shared/js/mall/cpkr/CPKR_CHECKOUT.js?v=021';

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

  function payloadOf(job) {
    return job && (job.payload || job) || {};
  }

  function firstItem(job) {
    const payload = payloadOf(job);
    return payload.items && payload.items[0] || {};
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

  function productUrl(job) {
    const payload = payloadOf(job);
    const order = payload.order || {};
    const item = firstItem(job);

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

    for (const candidate of [item.pi_ii_vi, item.source_uid]) {
      const parsed = parseCpkrUid(candidate);
      if (parsed.ok) return parsed.product_url;
    }

    return '';
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
      '\n페이지: ' + detectPageType();
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

    if (detectPageType() === 'PRODUCT') {
      panel.appendChild(
        createButton('상품 페이지 검사', () => {
          inspectProductPage().catch(showError);
        })
      );
    }

    if (
      detectPageType() === 'PRODUCT' &&
      lastInspection &&
      !lastInspection.login_required &&
      lastInspection.puid_match
    ) {
      panel.appendChild(
        createButton('PUID 확인/수량 준비', () => {
          prepareProductPage().catch(showError);
        })
      );
    }

    if (
      detectPageType() === 'PRODUCT' &&
      lastPreparation
    ) {
      /*
       * V024 PRODUCT RETURN STATE
       * 장바구니 담기 후 상품페이지로 다시 돌아오면 lastCartAction이 남아 있다.
       * 기존 코드는 !lastCartAction 조건 때문에 모든 다음 단계 버튼을 숨겼다.
       * 이미 담기 성공 이력이 있으면 중복 담기하지 말고 장바구니로 복귀시키고,
       * 담기 이력이 없거나 실패했으면 기존 장바구니 담기 버튼을 다시 제공한다.
       */
      if (lastCartAction && lastCartAction.ok) {
        panel.appendChild(
          createButton('장바구니 열기 · 주문 계속', () => {
            openCurrentCart().catch(showError);
          })
        );
      } else {
        panel.appendChild(
          createButton('장바구니 담기', () => {
            addCurrentItemToCart().catch(showError);
          })
        );
      }
    }

    if (
      detectPageType() === 'CART' &&
      currentJob
    ) {
      panel.appendChild(
        createButton('장바구니 검증', () => {
          inspectCurrentCart().catch(showError);
        })
      );
      if (lastCartAction && lastCartAction.ok) {
        panel.appendChild(
          createButton('주문/결제 진행', () => {
            goCheckout().catch(showError);
          })
        );
      }
    }

    if (detectPageType() === 'CHECKOUT' && currentJob) {
      panel.appendChild(
        createButton('배송지 입력·저장 · 결제직전 정지', () => {
          fillCheckoutAndStop().catch(showError);
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
    clearInterval(workHeartbeatTimer);
    workHeartbeatTimer = null;
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

    render(
      '작업 배정 완료\n' +
      '#' + currentJob.work_id + '\n' +
      currentJob.auto_order_no + '\n' +
      (productUrl(currentJob)
        ? 'CPKR UID 링크 생성 완료'
        : 'CPKR UID 형식 오류: 숫자_숫자_숫자 필요')
    );

    if (detectPageType() === 'PRODUCT') {
      setTimeout(() => { autoInspectAndPrepareProductPage(); }, 700);
    }
    if (detectPageType() === 'AUTH') {
      setTimeout(() => { autoStepupAuth().catch(showError); }, 450);
    }

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

    const item = firstItem(currentJob);
    const expected = Object.assign(
      {},
      item,
      { product_url: productUrl(currentJob) }
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

    const item = firstItem(currentJob);

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
          product_url: productUrl(currentJob)
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
        '다음 단계: 장바구니 담기 테스트'
      );
    } catch (error) {
      showError(error);
    } finally {
      autoProductFlowRunning = false;
    }
  }

  async function addCurrentItemToCart() {
    if (!currentJob) {
      throw new Error('먼저 작업을 가져오세요.');
    }

    if (!lastPreparation) {
      throw new Error('먼저 옵션/수량 준비를 실행하세요.');
    }

    if (detectPageType() !== 'PRODUCT') {
      throw new Error('쿠팡 상품 상세 페이지에서 실행하세요.');
    }

    await assertOrderStillActive('BEFORE_ADD_TO_CART');
    await loadCartManager();

    lastCartAction =
      await window.GMAO_CPKR_CART_MANAGER.addToCart();

    GM_setValue(
      'gmao_runner_cart_v013',
      lastCartAction
    );

    await clientHeartbeat();

    render(
      '장바구니 담기 실행 완료\n' +
      (
        lastCartAction.ok
          ? '쿠팡 확인 신호가 감지되었습니다.'
          : '버튼은 클릭했지만 확인 신호는 감지되지 않았습니다.'
      )
    );

    if (
      detectPageType() !== 'CART' &&
      window.confirm(
        '장바구니 페이지로 이동하여 담긴 상품을 검증할까요?'
      )
    ) {
      window.GMAO_CPKR_CART_MANAGER.openCart();
    }

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


  async function inspectCurrentCart() {
    if (!currentJob) {
      throw new Error('먼저 작업을 가져오세요.');
    }

    if (detectPageType() !== 'CART') {
      throw new Error('쿠팡 장바구니 페이지에서 실행하세요.');
    }

    await loadCartManager();

    const item = firstItem(currentJob);
    const inspection =
      window.GMAO_CPKR_CART_MANAGER.inspectCart(item);

    lastCartAction = Object.assign(
      {},
      lastCartAction || {},
      {
        ok: inspection.ok,
        method: 'cart-inspection',
        inspection
      }
    );

    GM_setValue(
      'gmao_runner_cart_v013',
      lastCartAction
    );

    await clientHeartbeat();

    if (!inspection.ok) {
      render(
        '장바구니 검증 실패\n주문 상품을 찾지 못했습니다.',
        true
      );
      return inspection;
    }

    render(
      '장바구니 검증 완료\n주문 상품이 확인되었습니다.'
    );

    return inspection;
  }

  async function goCheckout() {
    /*
     * V021: 장바구니 검증 성공 여부는 ok=true만 기준으로 한다.
     * CPKR 모듈/메시지 경로에 따라 method 값이 cart-inspection 이외로 보존될 수 있으므로
     * method 문자열 때문에 정상 검증 후 주문/결제 버튼이 사라지지 않게 한다.
     * 다음 단계 클릭 직전의 고객취소 DB 재확인(BEFORE_CHECKOUT)은 반드시 유지한다.
     */
    if (!currentJob) throw new Error('먼저 작업을 가져오세요.');
    if (detectPageType() !== 'CART') throw new Error('쿠팡 장바구니 페이지에서 실행하세요.');
    if (!lastCartAction || !lastCartAction.ok) {
      throw new Error('먼저 장바구니 검증을 완료하세요.');
    }
    await assertOrderStillActive('BEFORE_CHECKOUT');

    /*
     * V022: 쿠팡 주문/결제 이동은 실제 DOM 버튼의 native click을 사용한다.
     * Tampermonkey sandbox에서 synthetic MouseEvent(view=window)를 만들면
     * Window 변환 오류가 날 수 있으므로 CPKR_CART.verifyAndOrder()의
     * 합성 클릭 경로는 이 단계에서 사용하지 않는다.
     * 장바구니 검증/선택상태는 직전 inspectCart 결과를 그대로 신뢰한다.
     */
    const button =
      document.querySelector('a.goPayment[data-pay-role="button"]') ||
      document.querySelector('a.goPayment') ||
      document.querySelector('[data-pay-role="button"]');

    if (!button) {
      throw new Error('쿠팡 주문/결제 진행 버튼을 찾지 못했습니다.');
    }

    render('주문/결제 페이지로 이동합니다.');

    if (typeof button.click === 'function') {
      button.click();
      return;
    }

    const href = button.getAttribute && button.getAttribute('href');
    if (href) {
      location.href = new URL(href, location.href).href;
      return;
    }

    throw new Error('쿠팡 주문/결제 버튼을 실행할 수 없습니다.');
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

    /* 결제 직전 단계 진입 전에도 반드시 최신 취소상태를 확인한다. */
    await assertOrderStillActive('BEFORE_CHECKOUT_FILL');

    setAddressBridge({
      state: 'REQUESTED',
      phase: '배송지 iframe 대기',
      work_id: currentJob.work_id,
      auto_order_no: currentJob.auto_order_no,
      receiver: receiver
    });

    await loadCheckout();
    const checkoutOrder = Object.assign({}, payload.order || {}, {
      receiver,
      shipping: receiver,
      address: receiver
    });
    const result = await window.CPKR_CHECKOUT.fillAndStop(checkoutOrder, {
      onProgress: function (phase) {
        render('배송지 자동입력 진행\n' + phase);
      },
      waitForAddressBridge: function () {
        return waitAddressBridgeDone(currentJob.work_id, 90000);
      }
    });

    await request(
      '/api/auto-order/runtime/work/' + encodeURIComponent(currentJob.work_id) + '/state',
      'POST',
      settings({
        lock_token: currentJob.lock_token,
        status: 'STOPPED_BEFORE_PAYMENT',
        detail: {
          phase: 'CHECKOUT_STOPPED_BEFORE_PAYMENT',
          message: '신규 배송지 저장/적용 후 결제하기 직전 정지',
          address_persisted: true,
          default_address: false
        }
      })
    );

    clearInterval(workHeartbeatTimer);
    GM_setValue('gmao_runner_job_v013', null);
    currentJob = null;
    render('결제하기 직전 정지 완료\n신규 배송지는 저장/적용했고 기본 배송지로는 지정하지 않았습니다.\n최종 결제는 사람이 확인 후 진행하세요.');
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
          render(
            '기존 작업 복구 완료\n' +
            '#' + currentJob.work_id + '\n' +
            currentJob.auto_order_no
          );
          if (detectPageType() === 'PRODUCT') {
            setTimeout(() => { autoInspectAndPrepareProductPage(); }, 700);
          }
          if (detectPageType() === 'AUTH') {
            setTimeout(() => { autoStepupAuth().catch(showError); }, 450);
          }
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
