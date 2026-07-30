(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const fmt = v => Number(v || 0).toLocaleString('ko-KR');

  // Dashboard V001는 외부몰에 직접 접근하지 않는다.
  // 추후 모든 데이터는 Glomart auto-order 전용 API에서만 읽는다.
  const API = {
    summary: '/api/auto-order/dashboard/summary',
    clients: '/api/auto-order/dashboard/clients',
    attention: '/api/auto-order/dashboard/attention'
  };

  const numberIds = [
    'todayOrders','todayAmount','autoSuccess','delivered',
    'autoFailed','loginRequired','paymentWaiting','paymentWaiting2','priceChanged',
    'stockError','noInvoice','deliveryDelay','claimPending','pendingCs',
    'received','autoWaiting','preparing','shipping','delivered2',
    'coupangAuto','sourceOrderCollected','invoiceCollected','deliveryUpdated',
    'autoPostProcess','clientOnline','cpkrReady','alkrReady'
  ];

  function tick(){
    $('clock').textContent = new Date().toLocaleString('ko-KR', {hour12:false});
  }

  function reset(){
    numberIds.forEach(id => { if ($(id)) $(id).textContent = '0'; });
    $('modeText').textContent = 'SEMI_AUTO';
  }

  async function getJson(url){
    const r = await fetch(url, {credentials:'include', headers:{Accept:'application/json'}});
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }

  function setSummary(d){
    if (!d || typeof d !== 'object') return;
    const map = {
      todayOrders:d.today_orders, todayAmount:d.today_amount,
      autoSuccess:d.auto_order_success, delivered:d.delivered,
      autoFailed:d.auto_order_failed, loginRequired:d.login_required,
      paymentWaiting:d.payment_waiting, paymentWaiting2:d.payment_waiting,
      priceChanged:d.price_changed, stockError:d.stock_or_option_error,
      noInvoice:d.no_invoice, deliveryDelay:d.delivery_delay,
      claimPending:d.claim_pending, pendingCs:d.pending_cs,
      received:d.received, autoWaiting:d.auto_order_waiting,
      preparing:d.preparing, shipping:d.shipping, delivered2:d.delivered,
      coupangAuto:d.coupang_auto, sourceOrderCollected:d.source_order_collected,
      invoiceCollected:d.invoice_collected, deliveryUpdated:d.delivery_updated,
      autoPostProcess:d.auto_post_process, clientOnline:d.client_online,
      cpkrReady:d.cpkr_ready, alkrReady:d.alkr_ready
    };
    for (const [id,v] of Object.entries(map)) {
      if ($(id) && v !== undefined && v !== null) $(id).textContent = fmt(v);
    }
    if (d.mode) $('modeText').textContent = String(d.mode);
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
      getJson(API.summary), getJson(API.clients), getJson(API.attention)
    ]);
    if (result[0].status === 'fulfilled') setSummary(result[0].value.data || result[0].value);
    if (result[1].status === 'fulfilled') setClients(result[1].value.data || result[1].value);
    if (result[2].status === 'fulfilled') setAttention(result[2].value.data || result[2].value);
  }

  document.querySelectorAll('[data-pending]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      toast(`${a.dataset.pending} 화면은 대시보드 다음 단계에서 연결합니다.`);
    });
  });
  document.querySelectorAll('[data-target]').forEach(el => {
    el.addEventListener('click', () => toast('해당 상세 목록은 다음 단계에서 연결합니다.'));
  });

  $('refreshBtn').addEventListener('click', load);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  tick();
  setInterval(tick, 30000);
  load();
})();