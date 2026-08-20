(function(){
'use strict';
var $=function(id){return document.getElementById(id);};
var panel=document.querySelector('main.main section.panel');
if(!panel)return;
panel.innerHTML=
'<div class="panel-head"><h2>반품</h2></div>'+
'<div class="tower-cards">'+
'<div class="tower-card"><div class="label">전체 반품작업</div><div id="cTotal" class="value">0</div></div>'+
'<div class="tower-card"><div class="label">실행대기</div><div id="cReady" class="value">0</div></div>'+
'<div class="tower-card"><div class="label">실행중</div><div id="cRunning" class="value">0</div></div>'+
'<div class="tower-card"><div class="label">환불완료</div><div id="cDone" class="value">0</div></div>'+
'</div>'+
'<div class="tower-tools" style="grid-template-columns:minmax(220px,1fr) 140px 140px 100px;">'+
'<input id="q" class="wide" type="search" placeholder="주문번호 / 외부몰 주문번호 / 회원ID 검색">'+
'<select id="mall"><option value="">전체 실제 주문처</option><option value="CPKR">쿠팡</option><option value="ALKR">알리</option></select>'+
'<select id="status"><option value="">전체 상태</option><option value="READY">실행대기</option><option value="RUNNING">실행중</option><option value="COMPLETED">환불완료</option><option value="FAILED">실패</option></select>'+
'<button id="searchBtn" type="button">조회</button>'+
'</div>'+
'<div id="summary" class="tower-summary">조회 중...</div>'+
'<div class="tower-table-wrap"><table class="tower-table"><thead><tr>'+
'<th>요청일</th><th>Glomart 주문번호</th><th>외부몰 주문번호</th><th>상품</th><th>반품수량</th><th>반품상태</th><th>반품사유</th><th>예상 환불금액</th><th>상태</th><th>담당 관리자</th><th>몰 계정</th><th>오류</th><th>처리</th>'+
'</tr></thead><tbody id="rows"><tr><td colspan="13" class="empty">조회 중...</td></tr></tbody></table></div>';

function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function won(v){var n=Number(v||0);return (Number.isFinite(n)?n:0).toLocaleString('ko-KR')+'원';}
function dt(v){if(!v)return '-';var d=new Date(v);return Number.isNaN(d.getTime())?esc(v):d.toLocaleDateString('ko-KR');}
function st(s){s=String(s||'').toUpperCase();var m={READY:'실행대기',RUNNING:'실행중',COMPLETED:'환불완료',FAILED:'실패',REQUESTED:'요청'};return m[s]||s||'-';}

async function load(){
  $('summary').textContent='반품 작업 조회 중...';
  $('rows').innerHTML='<tr><td colspan="13" class="empty">조회 중...</td></tr>';
  var p=new URLSearchParams({type:'return',limit:'200'});
  var q=$('q').value.trim(), mall=$('mall').value, status=$('status').value;
  if(q)p.set('q',q); if(mall)p.set('mall_code',mall); if(status)p.set('status',status);
  try{
    var r=await fetch('/api/auto-order/claims?'+p.toString(),{cache:'no-store'});
    var j=await r.json();
    if(!r.ok||!j.ok)throw new Error(j.detail||j.error||('HTTP '+r.status));
    var rows=(j.data&&Array.isArray(j.data.rows))?j.data.rows:[];
    var counts=(j.data&&j.data.counts)||{};
    $('cTotal').textContent=Number(j.data&&j.data.total||rows.length||0).toLocaleString('ko-KR');
    $('cReady').textContent=Number(counts.READY||0).toLocaleString('ko-KR');
    $('cRunning').textContent=Number(counts.RUNNING||0).toLocaleString('ko-KR');
    $('cDone').textContent=Number(counts.COMPLETED||0).toLocaleString('ko-KR');
    $('summary').textContent='총 '+Number(j.data&&j.data.total||rows.length||0).toLocaleString('ko-KR')+'건 · 현재 '+rows.length+'건 표시';
    if(!rows.length){$('rows').innerHTML='<tr><td colspan="13" class="empty">반품 작업이 없습니다.</td></tr>';return;}
    $('rows').innerHTML=rows.map(function(x){
      return '<tr><td>'+dt(x.requested_at||x.created_at)+'</td><td>'+esc(x.order_no||'-')+'</td><td>'+esc(x.mall_order_no||'-')+'</td><td class="product">'+esc(x.product_name||x.product_names||'-')+'</td><td class="num">'+esc(x.quantity||x.return_quantity||0)+'</td><td>'+esc(x.request_type||x.return_status||'부분/전체')+'</td><td>'+esc(x.reason||x.reason_text||'-')+'</td><td class="num"><strong>'+won(x.refund_amount||x.expected_refund_amount)+'</strong></td><td>'+esc(st(x.status||x.work_status))+'</td><td>'+esc(x.admin_id||'-')+'</td><td>'+esc(x.mall_account_id||'-')+'</td><td>'+esc(x.error_message||x.error_code||'-')+'</td><td>-</td></tr>';
    }).join('');
  }catch(e){$('summary').textContent='반품 조회 실패';$('rows').innerHTML='<tr><td colspan="13" class="empty">'+esc(e&&e.message||e)+'</td></tr>';}
}
$('searchBtn').addEventListener('click',load);
$('q').addEventListener('keydown',function(e){if(e.key==='Enter')load();});
var rb=document.getElementById('refreshBtn'); if(rb)rb.addEventListener('click',load);
load();
})();
