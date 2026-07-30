(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const fmt = v => Number(v || 0).toLocaleString('ko-KR');

  // Dashboard V006:
  // Cafe24 주문 대시보드의 검증된 정보 구조를 참고하되,
  // 데이터/로직은 Glomart 전용 API만 사용한다.
  // 서버에서 쿠팡/알리에 직접 접속하지 않는다.
  const API = {
    summary: '/api/auto-order/dashboard/summary',
    clients: '/api/auto-order/dashboard/clients',
    attention: '/api/auto-order/dashboard/attention'
  };

  const numberIds = [
    'todayOrderAmount','monthOrderAmount','todayOrders','monthOrders',
    'todayPaidAmount','monthPaidAmount','todayPaidCount','monthPaidCount',
    'todayRefundAmount','monthRefundAmount','todayRefundCount','monthRefundCount',
    'autoWaiting','preparing','deliveryHold','deliveryReady','shipping',
    'cancelRequest','cancelProcessing','exchangeRequest','exchangeProcessing',
    'returnRequest','returnProcessing','refundWaiting',
    'autoSuccess','paymentDone','deliveryReadyDone','shippingStarted','delivered',
    'cancelDone','exchangeDone','returnDone','refundDone',
    'clientOnline','cpkrReady','alkrReady','paymentWaiting',
    'autoFailed','loginRequired','priceChanged','stockError','noInvoice',
    'deliveryDelay','pendingCs'
  ];

  function tick(){
    const d = new Date();
    $('clock').textContent = d.toLocaleString('ko-KR', {hour12:false});
  }

  function reset(){
    numberIds.forEach(id => { if ($(id)) $(id).textContent = '0'; });
    $('modeText').textContent = 'SEMI_AUTO';
    $('realtimeUpdated').textContent = '최종 업데이트 일시 : - (실시간 조회)';
  }

  async function getJson(url){
    const r = await fetch(url, {
      credentials:'include',
      cache:'no-store',
      headers:{Accept:'application/json'}
    });
    const text = await r.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_) {}
    if (!r.ok) throw new Error(`${url} HTTP ${r.status}: ${body?.detail || body?.error || text.slice(0,160) || 'request failed'}`);
    if (!body || body.ok === false) throw new Error(`${url}: ${body?.detail || body?.error || 'invalid response'}`);
    return body;
  }

  function setValue(id, value){
    if ($(id) && value !== undefined && value !== null) $(id).textContent = fmt(value);
  }

  function setSummary(d){
    if (!d || typeof d !== 'object') return;

    const map = {
      todayOrderAmount:d.today_order_amount ?? d.today_amount,
      monthOrderAmount:d.month_order_amount ?? d.month_amount,
      todayOrders:d.today_orders,
      monthOrders:d.month_orders,
      todayPaidAmount:d.today_paid_amount,
      monthPaidAmount:d.month_paid_amount,
      todayPaidCount:d.today_paid_count,
      monthPaidCount:d.month_paid_count,
      todayRefundAmount:d.today_refund_amount,
      monthRefundAmount:d.month_refund_amount,
      todayRefundCount:d.today_refund_count,
      monthRefundCount:d.month_refund_count,

      autoWaiting:d.auto_order_waiting,
      preparing:d.preparing,
      deliveryHold:d.delivery_hold,
      deliveryReady:d.delivery_ready,
      shipping:d.shipping,
      cancelRequest:d.cancel_request,
      cancelProcessing:d.cancel_processing,
      exchangeRequest:d.exchange_request,
      exchangeProcessing:d.exchange_processing,
      returnRequest:d.return_request,
      returnProcessing:d.return_processing,
      refundWaiting:d.refund_waiting,

      autoSuccess:d.auto_order_success,
      paymentDone:d.payment_done,
      deliveryReadyDone:d.delivery_ready_done,
      shippingStarted:d.shipping_started,
      delivered:d.delivered,
      cancelDone:d.cancel_done,
      exchangeDone:d.exchange_done,
      returnDone:d.return_done,
      refundDone:d.refund_done,

      clientOnline:d.client_online,
      cpkrReady:d.cpkr_ready,
      alkrReady:d.alkr_ready,
      paymentWaiting:d.payment_waiting,
      autoFailed:d.auto_order_failed,
      loginRequired:d.login_required,
      priceChanged:d.price_changed,
      stockError:d.stock_or_option_error,
      noInvoice:d.no_invoice,
      deliveryDelay:d.delivery_delay,
      pendingCs:d.pending_cs
    };

    Object.entries(map).forEach(([id,v]) => setValue(id,v));
    if (d.mode) $('modeText').textContent = String(d.mode);
    if (d.updated_at || d.server_time) {
      const dt = new Date(d.updated_at || d.server_time);
      if (!Number.isNaN(dt.getTime())) {
        $('realtimeUpdated').textContent =
          '최종 업데이트 일시 : ' + dt.toLocaleString('ko-KR',{hour12:false}) + ' (실시간 조회)';
      }
    }
  }

  function esc(v){
    return String(v ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[c]);
  }

  function setClients(rows){
    const el = $('clientRows');
    if (!Array.isArray(rows) || !rows.length) {
      el.innerHTML = '<tr class="empty"><td colspan="7">등록된 실행기 데이터가 없습니다.</td></tr>';
      return;
    }
    el.innerHTML = rows.map(r => `<tr>
      <td>${esc(r.client_name || r.client_id)}</td>
      <td>${esc(r.client_type)}</td>
      <td>${esc(r.admin_id)}</td>
      <td>${esc(r.cpkr_status)}</td>
      <td>${esc(r.alkr_status)}</td>
      <td>${esc(r.current_job_id || '-')}</td>
      <td>${esc(r.last_seen_at || '-')}</td>
    </tr>`).join('');
  }

  function setAttention(rows){
    const el = $('attentionRows');
    if (!Array.isArray(rows) || !rows.length) {
      el.innerHTML = '<tr class="empty"><td colspan="7">처리 필요 주문 데이터가 없습니다.</td></tr>';
      return;
    }
    el.innerHTML = rows.map(r => `<tr>
      <td>${esc(r.ordered_at)}</td>
      <td>${esc(r.order_no)}</td>
      <td>${esc(r.source_mall)}</td>
      <td>${esc(r.product_name)}</td>
      <td>${esc(r.auto_order_status)}</td>
      <td>${esc(r.delivery_status)}</td>
      <td>${esc(r.attention_reason)}</td>
    </tr>`).join('');
  }

  function toast(msg){
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { el.hidden = true; }, 1800);
  }

  async function load(){
    tick();
    reset();
    const result = await Promise.allSettled([
      getJson(API.summary),
      getJson(API.clients),
      getJson(API.attention)
    ]);
    const errors = [];
    if (result[0].status === 'fulfilled') setSummary(result[0].value.data || result[0].value);
    else errors.push('summary: ' + result[0].reason?.message);

    if (result[1].status === 'fulfilled') setClients(result[1].value.data || result[1].value);
    else errors.push('clients: ' + result[1].reason?.message);

    if (result[2].status === 'fulfilled') setAttention(result[2].value.data || result[2].value);
    else errors.push('attention: ' + result[2].reason?.message);

    if (errors.length) {
      console.error('[GM_DASHBOARD_API_ERROR_V011]', errors);
      $('realtimeUpdated').textContent = '데이터 연결 오류 - Console 확인';
      toast(errors[0]);
    }
  }

  $('searchForm').addEventListener('submit', e => {
    e.preventDefault();
    const type = $('searchType').value;
    const keyword = $('searchKeyword').value.trim();
    if (!keyword) {
      $('searchKeyword').focus();
      return;
    }
    location.href = './order/order.html?search_type=' +
      encodeURIComponent(type) + '&keyword=' + encodeURIComponent(keyword);
  });

  document.querySelectorAll('[data-target]').forEach(el => {
    el.addEventListener('click', () => toast('해당 상세 화면은 주문관리 기능 연결 단계에서 활성화합니다.'));
  });

  $('refreshBtn').addEventListener('click', load);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  tick();
  setInterval(tick, 30000);
  load();
})();