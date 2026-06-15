(function(w,d){
  if(w.__GM_ACCOUNT_BOOT__) return;
  w.__GM_ACCOUNT_BOOT__=1;

  var API_BASE = w.GM_API_BASE || w.GM_SERVER_BASE || w.GM_SERVER_URL || 'https://port-0-glomart-api-v2-mordwrnh222b6c36.sel3.cloudtype.app';
  var LOGIN_URL = '/member/login.html?returnUrl=' + encodeURIComponent('/account/gm_account.html');

  function qs(s,root){ return (root||d).querySelector(s); }
  function txt(sel,v){ var el=qs(sel); if(el) el.textContent = v; }
  function num(v){ var n=Number(v); return isFinite(n)?Math.round(n):0; }
  function won(v){ return num(v).toLocaleString('ko-KR') + '원'; }
  function point(v){ return num(v).toLocaleString('ko-KR') + 'P'; }
  function clean(v){ return v==null?'':String(v).trim(); }
  function ss(k){ try{return sessionStorage.getItem(k)||'';}catch(e){return '';} }
  function ls(k){ try{return localStorage.getItem(k)||'';}catch(e){return '';} }
  function parseJson(s){ try{return s?JSON.parse(s):null;}catch(e){return null;} }
  function msg(t,show){ var el=qs('[data-gm-message]'); if(!el) return; el.textContent=t||''; el.classList.toggle('show', !!show); }
  function getMemberId(){
    var p=parseJson(ss('GM_MEMBER_PROFILE'))||parseJson(ss('gm_member_profile'))||parseJson(ls('GM_MEMBER_PROFILE'))||{};
    return clean(ss('GM_MEMBER_ID')||ss('member_id')||ss('cafe24_member_id')||p.member_id||p.cafe24_member_id||p.id||p.memberId);
  }
  async function api(path){
    var url = API_BASE.replace(/\/$/,'') + path;
    var r = await fetch(url,{credentials:'omit'});
    var j = await r.json().catch(function(){return {};});
    if(!r.ok || j.ok===false) throw new Error(j.error || ('HTTP '+r.status));
    return j;
  }
  function renderSteps(rows){
    var box=qs('[data-gm-network-steps]'); if(!box) return;
    rows=Array.isArray(rows)?rows:[];
    if(!rows.length){ box.innerHTML='<div class="gm-empty">조회된 네트워크 자료가 없습니다.</div>'; return; }
    var map={}; rows.forEach(function(r){ map[Number(r.step_no||r.step)||0]=r; });
    var html='';
    for(var i=1;i<=5;i++){
      var r=map[i]||{};
      html += '<div class="gm-step"><span>STEP '+i+'</span><strong>'+num(r.member_count).toLocaleString('ko-KR')+'</strong><em>'+won(r.confirmed_order_amount||r.order_amount)+'</em><em>'+won(r.final_incentive_amount||r.incentive_amount)+'</em></div>';
    }
    box.innerHTML=html;
  }
  function renderMonthly(rows){
    var box=qs('[data-gm-monthly-summary]'); if(!box) return;
    rows=Array.isArray(rows)?rows:[];
    if(!rows.length){ box.innerHTML='<div class="gm-empty">월별 포인트 내역이 없습니다.</div>'; return; }
    box.innerHTML = rows.map(function(r){ return '<div class="gm-row"><span>'+clean(r.period)+' / STEP '+clean(r.step_no)+'</span><strong>'+won(r.confirmed_order_amount)+'</strong><strong>'+won(r.final_incentive_amount)+'</strong></div>'; }).join('');
  }
  function amountText(r){
    var a=num(r.deposit_charge_amount)-num(r.deposit_use_amount)+num(r.bonus_grant_amount)-num(r.bonus_use_amount)+num(r.refund_amount)+num(r.commission_amount);
    var p=num(r.point_grant_amount)-num(r.point_use_amount);
    if(p) return point(p);
    return won(a);
  }
  function renderLedger(rows){
    var box=qs('[data-gm-ledger-list]'); if(!box) return;
    rows=Array.isArray(rows)?rows:[];
    if(!rows.length){ box.innerHTML='<div class="gm-empty">최근 내역이 없습니다.</div>'; return; }
    box.innerHTML = rows.map(function(r){
      return '<div class="gm-ledger-item"><div class="gm-ledger-top"><div><div class="gm-ledger-title">'+clean(r.type||'내역')+'</div><div class="gm-ledger-date">'+clean(r.created_at).slice(0,10)+'</div><div class="gm-ledger-desc">'+clean(r.description)+'</div></div><div class="gm-ledger-amount">'+amountText(r)+'</div></div></div>';
    }).join('');
  }
  async function load(){
    var memberId=getMemberId();
    if(!memberId){ location.href=LOGIN_URL; return; }
    msg('계정 정보를 불러오고 있습니다.', true);
    var j=await api('/api/gm/account/summary?member_id='+encodeURIComponent(memberId));
    if(!j.found){ msg('서버에 회원자료가 없습니다. 로그인 후 회원정보 동기화가 필요합니다.', true); return; }
    var m=j.member||{};
    txt('[data-gm-member-name]', clean(m.member_name)||memberId);
    txt('[data-gm-member-id]', memberId);
    var b=j.balances||{};
    txt('[data-gm-usable-balance]', won(b.usable_balance));
    txt('[data-gm-deposit-balance]', won(b.deposit_balance));
    txt('[data-gm-bonus-balance]', won(b.bonus_balance));
    txt('[data-gm-point-balance]', point(b.point_balance));
    renderSteps(j.network_steps);
    renderMonthly(j.monthly_summary);
    renderLedger(j.ledger_recent);
    msg('', false);
  }
  async function loadLedger(){
    var memberId=getMemberId(); if(!memberId){ location.href=LOGIN_URL; return; }
    msg('내역을 불러오고 있습니다.', true);
    var j=await api('/api/gm/account/ledger?limit=80&member_id='+encodeURIComponent(memberId));
    renderLedger(j.items);
    msg('', false);
  }
  d.addEventListener('click', function(e){
    if(e.target.closest('[data-gm-back]')){ history.length>1?history.back():location.href='/'; }
    if(e.target.closest('[data-gm-refresh]')) load().catch(function(err){msg(err.message,true);});
    if(e.target.closest('[data-gm-ledger-more]')) loadLedger().catch(function(err){msg(err.message,true);});
  });
  d.addEventListener('DOMContentLoaded', function(){ load().catch(function(err){ msg('계정 정보 조회 실패: '+err.message, true); }); });
})(window,document);
