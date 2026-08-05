/*
 * GMAO_RUNNER_RUNTIME_V015_STABLE_STORAGE
 *
 * [공용 실행 엔진 — PC/Android 앱 동시 실행 구조]
 * 이 파일은 PC Tampermonkey 전용 코드가 아니다.
 * PC에서는 GM_AUTO_ORDER_UNIFIED.user.js가 platform adapter를 제공하고,
 * Android 전용 관리자 앱에서는 WebView/Native Bridge adapter를 제공한다.
 * 두 실행 환경은 이 동일한 Runtime과 동일한 쿠팡 모듈을 함께 사용한다.
 *
 * 플랫폼 전용 API(GM_xmlhttpRequest, GM_getValue, AndroidBridge 등)는
 * 이 파일에 직접 추가하지 않고 각 platform adapter에서만 처리한다.
 *
 * [안정 저장키 원칙]
 * Runtime 버전이 올라가도 작업/검사/장바구니 상태 저장키는 stable_v1을 유지한다.
 * 서버 Runtime만 교체해도 기존 작업이 사라지지 않으며, 버전별 키를 새로 만들지 않는다.
 *
 * [동시 실행 원칙]
 * PC 실행기와 Android 앱은 각각 고유 client_id를 사용하며,
 * 서버 Lock을 통해 같은 작업을 동시에 처리하지 않는다.
 * 동일한 Runtime 코드를 사용하되 작업 소유권은 실행기별로 분리한다.
 */
(function (global) {
  'use strict';

  const DEFAULTS = {
    admin_id: 'derzon',
    mall_account_id: 'CPKR_MASTER',
    mall_code: 'CPKR'
  };

  let platform = null;
  let options = null;
  let currentJob = null;
  let lastInspection = null;
  let lastPreparation = null;
  let lastCartAction = null;
  let workHeartbeatTimer = null;
  let clientHeartbeatTimer = null;
  let panelRequested = false;

  function uuid() {
    if (crypto && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }

  function getClientId() {
    let clientId = platform.getValue('gmao_runner_client_id_stable_v1', '');
    if (!clientId) {
      clientId = String(platform.clientIdPrefix || platform.clientType || 'RUNNER') + '-' + uuid();
      platform.setValue('gmao_runner_client_id_stable_v1', clientId);
    }
    return clientId;
  }

  function detectPageType() {
    const currentUrl = platform && platform.currentUrl
      ? String(platform.currentUrl() || '')
      : '';
    let parsed;
    try {
      parsed = new URL(currentUrl);
    } catch (error) {
      return 'COUPANG';
    }

    if (parsed.hostname === 'cart.coupang.com') return 'CART';
    if (parsed.hostname === 'checkout.coupang.com') return 'CHECKOUT';
    if (/\/vp\/products\//.test(parsed.pathname)) return 'PRODUCT';
    return 'COUPANG';
  }

  function settings(extra) {
    return Object.assign({
      client_id: getClientId(),
      client_type: platform.clientType,
      admin_id: platform.getValue('gmao_admin_id', DEFAULTS.admin_id),
      mall_account_id: platform.getValue(
        'gmao_mall_account_id',
        DEFAULTS.mall_account_id
      ),
      mall_code: DEFAULTS.mall_code,
      cpkr_ready: true,
      app_version: options.version,
      current_url: platform.currentUrl(),
      page_type: detectPageType(),
      current_work_id: currentJob ? currentJob.work_id : null,
      inspection: lastInspection || null,
      preparation: lastPreparation || null,
      cart_action: lastCartAction || null,
      device: {
        platform: platform.platformName,
        userAgent: platform.userAgent()
      }
    }, extra || {});
  }

  function request(path, method, requestBody) {
    return platform.request(path, method || 'GET', requestBody);
  }

  function loadInspector() {
    if (global.GMAO_CPKR_PRODUCT_INSPECTOR) return Promise.resolve();
    return platform.loadScript(options.inspectorUrl, '상품 검사 모듈을 불러오지 못했습니다.');
  }

  function loadPreparer() {
    if (global.GMAO_CPKR_PRODUCT_PREPARER) return Promise.resolve();
    return platform.loadScript(options.preparerUrl, '상품 준비 모듈을 불러오지 못했습니다.');
  }

  function loadCartManager() {
    if (global.GMAO_CPKR_CART_MANAGER) return Promise.resolve();
    return platform.loadScript(options.cartManagerUrl, '장바구니 모듈을 불러오지 못했습니다.');
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
    let panel = document.getElementById('gmao-runner-panel-stable-v1');
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = 'gmao-runner-panel-stable-v1';
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

    platform.panelRoot().appendChild(panel);
    return panel;
  }

  function removePanel() {
    const panel = document.getElementById('gmao-runner-panel-stable-v1');
    if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
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
      '상품일치=' + (lastInspection.product_id_match ? '예' : '아니오'),
      '옵션후보=' + lastInspection.option_control_count,
      '수량=' + (lastInspection.quantity_control_found ? '확인' : '없음'),
      '장바구니=' + (lastInspection.cart_button_found ? '확인' : '없음')
    ].join(' ');
  }

  function render(message, error) {
    if (!currentJob && !panelRequested && !error) return;
    const panel = ensurePanel();
    panel.innerHTML = '';

    const title = document.createElement('div');
    title.textContent = 'Glomart Runner V015';
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
        platform.navigate(url);
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
      lastInspection.product_id_match
    ) {
      panel.appendChild(
        createButton('옵션/수량 준비', () => {
          prepareProductPage().catch(showError);
        })
      );
    }

    if (
      detectPageType() === 'PRODUCT' &&
      lastPreparation &&
      !lastCartAction
    ) {
      panel.appendChild(
        createButton('장바구니 담기', () => {
          addCurrentItemToCart().catch(showError);
        })
      );
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
    }

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

  function startWorkHeartbeat() {
    clearInterval(workHeartbeatTimer);
    if (!currentJob) return;

    workHeartbeatTimer = setInterval(() => {
      workHeartbeat().catch(showError);
    }, 30000);
  }

  async function claim() {
    panelRequested = true;
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
    lastInspection = null;
    lastPreparation = null;
    lastCartAction = null;
    platform.setValue('gmao_runner_job_stable_v1', currentJob);
    platform.setValue('gmao_runner_inspection_stable_v1', null);
    platform.setValue('gmao_runner_preparation_stable_v1', null);
    platform.setValue('gmao_runner_cart_stable_v1', null);
    startWorkHeartbeat();

    render(
      '작업 배정 완료\n' +
      '#' + currentJob.work_id + '\n' +
      currentJob.auto_order_no + '\n' +
      (productUrl(currentJob)
        ? 'CPKR UID 링크 생성 완료'
        : 'CPKR UID 형식 오류: 숫자_숫자_숫자 필요')
    );

    return currentJob;
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

    lastInspection =
      global.GMAO_CPKR_PRODUCT_INSPECTOR.inspect(expected);

    platform.setValue(
      'gmao_runner_inspection_stable_v1',
      lastInspection
    );

    await clientHeartbeat();

    if (lastInspection.login_required) {
      render('상품 페이지 검사 완료\n쿠팡 로그인이 필요합니다.', true);
      return lastInspection;
    }

    if (!lastInspection.product_id_match) {
      render(
        '상품 페이지 검사 완료\n주문 상품과 현재 상품이 다릅니다.',
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
      await global.GMAO_CPKR_PRODUCT_PREPARER.prepare(
        item,
        lastInspection
      );

    platform.setValue(
      'gmao_runner_preparation_stable_v1',
      lastPreparation
    );

    await loadInspector();

    const refreshedInspection =
      global.GMAO_CPKR_PRODUCT_INSPECTOR.inspect(
        Object.assign({}, item, {
          product_url: productUrl(currentJob)
        })
      );

    lastInspection = refreshedInspection;
    platform.setValue(
      'gmao_runner_inspection_stable_v1',
      refreshedInspection
    );

    await clientHeartbeat();

    render(
      '옵션/수량 준비 완료\n' +
      '장바구니 버튼은 누르지 않았습니다.'
    );

    return lastPreparation;
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

    await loadCartManager();

    lastCartAction =
      await global.GMAO_CPKR_CART_MANAGER.addToCart();

    platform.setValue(
      'gmao_runner_cart_stable_v1',
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
      platform.confirm(
        '장바구니 페이지로 이동하여 담긴 상품을 검증할까요?'
      )
    ) {
      global.GMAO_CPKR_CART_MANAGER.openCart();
    }

    return lastCartAction;
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
      global.GMAO_CPKR_CART_MANAGER.inspectCart(item);

    lastCartAction = Object.assign(
      {},
      lastCartAction || {},
      {
        ok: inspection.ok,
        method: 'cart-inspection',
        inspection
      }
    );

    platform.setValue(
      'gmao_runner_cart_stable_v1',
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
    lastInspection = null;
    lastPreparation = null;
    lastCartAction = null;
    platform.setValue('gmao_runner_job_stable_v1', null);
    platform.setValue('gmao_runner_inspection_stable_v1', null);
    platform.setValue('gmao_runner_preparation_stable_v1', null);
    platform.setValue('gmao_runner_cart_stable_v1', null);
    clearInterval(workHeartbeatTimer);
    workHeartbeatTimer = null;

    panelRequested = false;
    removePanel();
  }

  async function start(runtimePlatform, runtimeOptions) {
    platform = runtimePlatform;
    options = runtimeOptions;
    if (!platform || !options) throw new Error('RUNNER_PLATFORM_OR_OPTIONS_MISSING');

    const requiredAdapterFunctions = [
      'request', 'loadScript', 'getValue', 'setValue',
      'currentUrl', 'navigate', 'userAgent', 'panelRoot', 'confirm'
    ];
    for (const functionName of requiredAdapterFunctions) {
      if (typeof platform[functionName] !== 'function') {
        throw new Error('RUNNER_ADAPTER_MISSING_' + functionName);
      }
    }

    currentJob = platform.getValue('gmao_runner_job_stable_v1', null);
    lastInspection = platform.getValue('gmao_runner_inspection_stable_v1', null);
    lastPreparation = platform.getValue('gmao_runner_preparation_stable_v1', null);
    lastCartAction = platform.getValue('gmao_runner_cart_stable_v1', null);

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
        removePanel();
      }
    } catch (error) {
      showError(error);
    }
  }


  global.GMAO_AUTO_ORDER_RUNTIME = {
    version: '0.015',
    start,
    openPanel() {
      panelRequested = true;
      render(currentJob ? '현재 작업\n#' + currentJob.work_id : '온라인\n수동 작업 배정 대기');
    },
    claim,
    release,
    getCurrentJob() { return currentJob; }
  };

})(window);
