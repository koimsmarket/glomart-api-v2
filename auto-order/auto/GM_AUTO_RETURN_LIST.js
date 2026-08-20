/* GM_AUTO_RETURN_LIST_V006 */
(function(w){
'use strict';
var MODE='return';
var mountedRoot=null;

function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function dt(v){if(!v)return '-';var d=new Date(v);return Number.isNaN(d.getTime())?esc(v):d.toLocaleString('ko-KR');}
function ko(s){s=String(s||'').toUpperCase();var m={REQUESTED:'요청',READY:'실행대기',RUNNING:'실행중',COMPLETED:'완료',FAILED:'실패',CANCELLED:'철회/취소'};return m[s]||s||'-';}
function root(){return mountedRoot;}
function el(id){var r=root();return r?r.querySelector('#'+id):null;}

function shell(){
  var r=root();if(!r)return;
  r.innerHTML=
    '<div class="panel-head"><h2>반품 작업</h2></div>'+
    '<div class="tower-cards" style="grid-template-columns:repeat(6,1fr)">'+
      '<div class="tower-card"><div class="label">전체</div><div id="gmCsTotal" class="value">0</div></div>'+
      '<div class="tower-card"><div class="label">요청</div><div id="gmCsRequested" class="value">0</div></div>'+
      '<div class="tower-card"><div class="label">실행대기</div><div id="gmCsReady" class="value">0</div></div>'+
      '<div class="tower-card"><div class="label">실행중</div><div id="gmCsRunning" class="value">0</div></div>'+
      '<div class="tower-card"><div class="label">완료</div><div id="gmCsCompleted" class="value">0</div></div>'+
      '<div class="tower-card"><div class="label">실패</div><div id="gmCsFailed" class="value">0</div></div>'+
    '</div>'+
    '<div class="tower-tools" style="grid-template-columns:minmax(220px,1fr) 140px 140px 100px;">'+
      '<input id="gmCsQ" class="wide" type="search" placeholder="주문번호 / 외부몰 주문번호 / 상품 / 회원ID 검색">'+
      '<select id="gmCsMall"><option value="">전체 실제 주문처</option><option value="CPKR">쿠팡</option><option value="ALKR">알리</option></select>'+
      '<select id="gmCsStatus"><option value="">전체 상태</option><option value="REQUESTED">요청</option><option value="READY">실행대기</option><option value="RUNNING">실행중</option><option value="COMPLETED">완료</option><option value="FAILED">실패</option><option value="CANCELLED">철회/취소</option></select>'+
      '<button id="gmCsSearch" type="button">조회</button>'+
    '</div>'+
    '<div id="gmCsSummary" class="tower-summary">조회 중...</div>'+
    '<div class="tower-table-wrap"><table class="tower-table"><thead><tr>'+
      '<th>요청일</th><th>Glomart 주문번호</th><th>외부몰</th><th>외부몰 주문번호</th><th>상품</th><th>수량</th><th>요청범위</th><th>사유</th><th>작업상태</th><th>담당 관리자</th><th>몰 계정</th><th>오류</th><th>처리</th>'+
    '</tr></thead><tbody id="gmCsRows"><tr><td colspan="13" class="empty">조회 중...</td></tr></tbody></table></div>';

  el('gmCsSearch').addEventListener('click',load);
  el('gmCsQ').addEventListener('keydown',function(e){if(e.key==='Enter')load();});
}

async function load(){
  var summary=el('gmCsSummary'),rowsEl=el('gmCsRows');
  if(!summary||!rowsEl)return;

  summary.textContent='조회 중...';
  rowsEl.innerHTML='<tr><td colspan="13" class="empty">조회 중...</td></tr>';

  var p=new URLSearchParams();
  p.set('type',MODE);
  p.set('limit','200');
  var q=el('gmCsQ').value.trim();
  var mall=el('gmCsMall').value;
  var status=el('gmCsStatus').value;
  if(q)p.set('q',q);
  if(mall)p.set('mall_code',mall);
  if(status)p.set('work_status',status);

  try{
    var rr=await fetch('/api/auto-order/control-tower/cs?'+p.toString(),{cache:'no-store'});
    var j=await rr.json();
    if(!rr.ok||!j.ok)throw new Error(j.detail||j.error||('HTTP '+rr.status));

    var d=j.data||{};
    var rows=Array.isArray(d.rows)?d.rows:[];
    var c=d.counts||{};

    el('gmCsTotal').textContent=Number(d.total||0).toLocaleString('ko-KR');
    el('gmCsRequested').textContent=Number(c.REQUESTED||0).toLocaleString('ko-KR');
    el('gmCsReady').textContent=Number(c.READY||0).toLocaleString('ko-KR');
    el('gmCsRunning').textContent=Number(c.RUNNING||0).toLocaleString('ko-KR');
    el('gmCsCompleted').textContent=Number(c.COMPLETED||0).toLocaleString('ko-KR');
    el('gmCsFailed').textContent=Number(c.FAILED||0).toLocaleString('ko-KR');

    summary.textContent='총 '+Number(d.total||0).toLocaleString('ko-KR')+'건 · 현재 '+rows.length+'건 표시';

    if(!rows.length){
      rowsEl.innerHTML='<tr><td colspan="13" class="empty">반품 요청이 없습니다.</td></tr>';
      return;
    }

    rowsEl.innerHTML=rows.map(function(x){
      var scope=x.pi_ii_vi?'상품':'외부주문';
      var err=[x.error_code,x.error_message].filter(Boolean).join(' / ');
      return '<tr>'+
        '<td>'+dt(x.requested_at)+'</td>'+
        '<td><strong>'+esc(x.order_no||'-')+'</strong><div class="muted">'+esc(x.cs_no||'')+'</div></td>'+
        '<td>'+esc(x.mall_code||'-')+'</td>'+
        '<td>'+esc(x.mall_order_no||'-')+'</td>'+
        '<td class="product">'+esc(x.product_name||'-')+'<div class="muted">'+esc(x.pi_ii_vi||'')+'</div></td>'+
        '<td class="num">'+esc(x.quantity||0)+'</td>'+
        '<td>'+scope+'</td>'+
        '<td>'+esc(x.reason_text||'-')+'</td>'+
        '<td>'+esc(ko(x.work_status))+'</td>'+
        '<td>'+esc(x.admin_id||'-')+'</td>'+
        '<td>'+esc(x.mall_account_id||'-')+'</td>'+
        '<td>'+esc(err||'-')+'</td>'+
        '<td>-</td>'+
      '</tr>';
    }).join('');
  }catch(e){
    summary.textContent='조회 실패';
    rowsEl.innerHTML='<tr><td colspan="13" class="empty">'+esc(e&&e.message||e)+'</td></tr>';
  }
}

function mount(r){
  mountedRoot=r;
  if(!r)return;
  shell();
  load();
}
function refresh(){
  if(root())load();
}
w.GM_AUTO_RETURN_LIST={mount:mount,refresh:refresh};
})(window);

