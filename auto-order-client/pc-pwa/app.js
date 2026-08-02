(function(){
  'use strict';

  const $ = id => document.getElementById(id);
  const API_BASE = location.origin;
  const STORE = window.GMAO_STORE;
  let claimedJob = null;

  function getClientId() {
    const key = 'gmao_pwa_client_id_v009';
    let value = localStorage.getItem(key);

    if (!value) {
      value = 'PC-PWA-' + crypto.randomUUID();
      localStorage.setItem(key, value);
    }

    return value;
  }

  function getSettings() {
    return {
      client_id: getClientId(),
      client_type: 'PC_PWA',
      admin_id: $('adminId').value.trim(),
      mall_account_id: $('mallAccountId').value.trim(),
      mall_code: 'CPKR',
      cpkr_ready: true,
      app_version: '0.009',
      device: {
        platform: 'pwa',
        userAgent: navigator.userAgent
      }
    };
  }

  async function request(path, options = {}) {
    const response = await fetch(
      API_BASE + path,
      Object.assign(
        {
          credentials: 'include',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' }
        },
        options
      )
    );

    const text = await response.text();
    let data;

    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(text.slice(0, 200));
    }

    if (!response.ok || data.ok === false) {
      throw new Error(
        data.detail ||
        data.error ||
        `HTTP ${response.status}`
      );
    }

    return data;
  }

  function renderStatus(value) {
    $('serverStatus').textContent =
      typeof value === 'string'
        ? value
        : JSON.stringify(value, null, 2);
  }

  function saveSettings() {
    const value = {
      admin_id: $('adminId').value.trim(),
      mall_account_id: $('mallAccountId').value.trim(),
      cpkr_ready: true
    };

    STORE.setSettings(value);

    renderStatus({
      message: '설정을 저장했습니다.',
      ...value,
      client_id: getClientId()
    });
  }

  function loadSettings() {
    const saved = STORE.getSettings();
    $('adminId').value = saved.admin_id || 'derzon';
    $('mallAccountId').value =
      saved.mall_account_id || 'CPKR_MASTER';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(
      /[&<>"']/g,
      char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[char]
    );
  }

  function money(value) {
    return Number(value || 0).toLocaleString('ko-KR') + '원';
  }

  async function registerClient() {
    saveSettings();

    const result = await request(
      '/api/auto-order/runtime/register',
      {
        method: 'POST',
        body: JSON.stringify(getSettings())
      }
    );

    renderStatus({
      message: '클라이언트 등록 완료',
      client: result.item
    });

    return result;
  }

  async function refresh() {
    const settings = getSettings();

    const query = new URLSearchParams({
      admin_id: settings.admin_id,
      mall_account_id: settings.mall_account_id,
      mall_code: 'CPKR',
      limit: '30'
    });

    const [statusResult, readyResult] = await Promise.all([
      request('/api/auto-order/runtime/status'),
      request('/api/auto-order/runtime/ready?' + query.toString())
    ]);

    renderStatus(statusResult);

    const runnerClients = (statusResult.clients || []).filter(client =>
      client.online &&
      client.client_type === 'PC_RUNNER' &&
      client.admin_id === settings.admin_id &&
      client.mall_account_id === settings.mall_account_id &&
      client.mall_code === 'CPKR'
    );

    const runnerStatus = document.getElementById('runnerStatus');

    if (runnerStatus) {
      if (runnerClients.length) {
        const latest = runnerClients[0];
        runnerStatus.textContent =
          '온라인 ' + runnerClients.length + '대 · ' +
          (latest.page_type || 'COUPANG') +
          ' · 마지막 연결 ' +
          (latest.last_seen_at || '-');
        runnerStatus.style.color = '#087443';
        runnerStatus.style.fontWeight = '700';
      } else {
        runnerStatus.textContent =
          '온라인 실행기 없음. Tampermonkey 실행기를 설치한 뒤 쿠팡 페이지를 여세요.';
        runnerStatus.style.color = '#b42318';
        runnerStatus.style.fontWeight = '700';
      }
    }

    const rows = readyResult.items || [];
    $('readyCount').textContent = rows.length + '건';

    if (!rows.length) {
      $('readyBody').innerHTML =
        '<tr><td colspan="6" class="empty">' +
        '조건에 맞는 READY 작업이 없습니다.' +
        '</td></tr>';
      return;
    }

    $('readyBody').innerHTML = rows.map(item => `
      <tr>
        <td class="mono">
          #${escapeHtml(item.work_id)}<br>
          ${escapeHtml(item.work_status)}
        </td>
        <td class="mono">${escapeHtml(item.auto_order_no)}</td>
        <td>
          ${escapeHtml(item.product_names || '-')}<br>
          <small>${escapeHtml(item.item_count)}개 품목</small>
        </td>
        <td>${money(item.expected_amount)}</td>
        <td>
          ${escapeHtml(item.admin_id || '-')}<br>
          ${escapeHtml(item.mall_account_id || '-')}
        </td>
        <td>
          <button data-claim="${escapeHtml(item.work_id)}">
            배정 테스트
          </button>
        </td>
      </tr>
    `).join('');

    document.querySelectorAll('[data-claim]').forEach(button => {
      button.onclick = () => runClaimTest(
        Number(button.dataset.claim)
      );
    });
  }

  async function runClaimTest(selectedWorkId) {
    if (claimedJob) {
      throw new Error(
        '먼저 기존 테스트 배정을 취소하세요.'
      );
    }

    await registerClient();

    const result = await request(
      '/api/auto-order/runtime/claim',
      {
        method: 'POST',
        body: JSON.stringify(getSettings())
      }
    );

    if (!result.job) {
      throw new Error(
        '배정할 작업이 없습니다: ' +
        (result.reason || 'queue_empty')
      );
    }

    claimedJob = result.job;

    if (
      selectedWorkId &&
      Number(claimedJob.work_id) !== Number(selectedWorkId)
    ) {
      await releaseClaim();
      throw new Error(
        '선택 작업과 서버 우선순위 배정 작업이 달라 ' +
        '즉시 READY로 반환했습니다.'
      );
    }

    $('claimResult').textContent =
      JSON.stringify(claimedJob, null, 2);

    $('release').disabled = false;
    await refresh();
  }

  async function releaseClaim() {
    if (!claimedJob) return;

    const job = claimedJob;

    await request(
      `/api/auto-order/runtime/work/${encodeURIComponent(job.work_id)}/release`,
      {
        method: 'POST',
        body: JSON.stringify({
          ...getSettings(),
          lock_token: job.lock_token
        })
      }
    );

    claimedJob = null;
    $('claimResult').textContent =
      '테스트 배정을 취소하고 READY 상태로 반환했습니다.';
    $('release').disabled = true;

    await refresh();
  }

  function guarded(action) {
    return async () => {
      try {
        await action();
      } catch (error) {
        renderStatus('오류: ' + String(error.message || error));
      }
    };
  }

  $('save').onclick = guarded(async () => saveSettings());
  $('register').onclick = guarded(registerClient);
  $('refresh').onclick = guarded(refresh);
  $('release').onclick = guarded(releaseClaim);

  loadSettings();
  refresh().catch(error => {
    renderStatus(
      '초기 조회 오류: ' +
      String(error.message || error)
    );
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('./sw.js')
      .catch(() => {});
  }
})();
