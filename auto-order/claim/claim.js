/* GM_AUTO_ORDER_CLAIM_UI_V001 */
(function(){
'use strict';

function esc(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function dt(v){if(!v)return '-';var d=new Date(v);return Number.isNaN(d.getTime())?esc(v):d.toLocaleString('ko-KR');}
function dtt(v){if(!v)return '-';var d=new Date(v);return Number.isNaN(d.getTime())?esc(v):d.toLocaleString('ko-KR');}
function won(v){var n=Number(v||0);return (Number.isFinite(n)?n:0).toLocaleString('ko-KR')+'원';}
function statusClass(v){var s=String(v||'').toUpperCase();if(/FAIL|REJECT|ERROR/.test(s))return'fail';if(/COMPLETE|DELIVERED|DONE|CLOSED|CONFIRMED/.test(s))return'done';if(/RUN|PROCESS|SHIP|TRANSIT|RETURN_|RESHIP/.test(s))return'running';if(/WAIT|REQUEST|READY|HOLD|PENDING/.test(s))return'warn';return'';}
function badge(v){return '<span class="ops-status '+statusClass(v)+'">'+esc(v||'-')+'</span>';}
function setText(id,v){var e=document.getElementById(id);if(e)e.textContent=String(v==null?'':v);}
function toggleDetail(btn,html){var tr=btn.closest('tr'),next=tr&&tr.nextElementSibling;if(next&&next.classList.contains('ops-row-detail')){next.remove();return;}var d=document.createElement('tr');d.className='ops-row-detail';d.innerHTML='<td colspan="'+tr.children.length+'"><div class="ops-detail">'+html+'</div></td>';tr.after(d);}

var currentType='ALL',root=document.getElementById('opsRoot');
root.innerHTML=
'<div class="ops-tabs"><button data-type="ALL" class="active">전체</button><button data-type="CANCEL">취소</button><button data-type="EXCHANGE">교환</button><button data-type="RETURN">반품</button></div>'+
'<div class="ops-cards">'+
'<div class="ops-card"><span>전체 요청</span><strong id="cTotal">0</strong></div>'+
'<div class="ops-card"><span>요청</span><strong id="cRequested">0</strong></div>'+
'<div class="ops-card"><span>처리중</span><strong id="cProcessing">0</strong></div>'+
'<div class="ops-card"><span>완료</span><strong id="cDone">0</strong></div>'+
'<div class="ops-card"><span>실패/거절</span><strong id="cFailed">0</strong></div>'+
'<div class="ops-card"><span>철회</span><strong id="cWithdrawn">0</strong></div>'+
'</div>'+
'<div class="ops-tools">'+
'<input id="q" type="search" placeholder="주문번호 / 외부몰 주문번호 / 상품 / CS번호 검색">'+
'<select id="mall"><option value="">전체 주문처</option><option value="CPKR">쿠팡</option><option value="ALKR">알리</option></select>'+
'<select id="status"><option value="">전체 상태</option><option value="REQUESTED">요청</option><option value="PROCESSING">처리중</option><option value="COMPLETED">완료</option><option value="FAILED">실패/거절</option><option value="WITHDRAWN">철회</option></select>'+
'<button id="searchBtn" type="button">조회</button>'+
'</div>'+
'<div id="summary" class="ops-summary">조회 중...</div>'+
'<div class="ops-table-wrap"><table class="ops-table"><thead><tr>'+
'<th>요청일</th><th>유형</th><th>Glomart 주문번호</th><th>외부몰 주문번호</th><th>상품</th><th>수량</th><th>요청사유</th><th>상태</th><th>회수/재배송</th><th>담당/계정</th><th>외부 작업</th><th>상세</th>'+
'</tr></thead><tbody id="rows"><tr><td colspan="12" class="ops-empty">조회 중...</td></tr></tbody></table></div>'+
'<div class="ops-note">이 화면은 고객 요청부터 외부몰 취소/교환/반품 작업, 회수·재배송 상태까지 한곳에서 조회하는 운영 화면입니다. 실제 실행 버튼은 Runner 작업 연결 단계에서 추가합니다.</div>';

function typeKo(v){var s=String(v||'').toUpperCase();return s.indexOf('CANCEL')===0?'취소':s.indexOf('EXCHANGE')===0?'교환':s.indexOf('RETURN')===0?'반품':s||'-';}
async function load(){
  var p=new URLSearchParams({limit:'300'});
  if(currentType!=='ALL')p.set('type',currentType);
  if(document.getElementById('q').value.trim())p.set('q',document.getElementById('q').value.trim());
  if(document.getElementById('mall').value)p.set('mall_code',document.getElementById('mall').value);
  if(document.getElementById('status').value)p.set('status',document.getElementById('status').value);
  try{
    var r=await fetch('/api/auto-order/operations/claims?'+p.toString(),{cache:'no-store'});
    var j=await r.json();if(!r.ok||!j.ok)throw new Error(j.detail||j.error||('HTTP '+r.status));
    var d=j.data||{},c=d.counts||{},rows=Array.isArray(d.rows)?d.rows:[];
    setText('cTotal',c.total||0);setText('cRequested',c.requested||0);setText('cProcessing',c.processing||0);setText('cDone',c.completed||0);setText('cFailed',c.failed||0);setText('cWithdrawn',c.withdrawn||0);
    setText('summary','총 '+Number(d.total||0).toLocaleString('ko-KR')+'건 · 현재 '+rows.length+'건 표시');
    var tb=document.getElementById('rows');
    if(!rows.length){tb.innerHTML='<tr><td colspan="12" class="ops-empty">취소/교환/반품 요청이 없습니다.</td></tr>';return;}
    tb.innerHTML=rows.map(function(x,i){
      var logistics=[x.return_carrier,x.return_invoice_no,x.reship_carrier,x.reship_invoice_no].filter(Boolean).join(' / ')||'-';
      return '<tr>'+
      '<td>'+dtt(x.requested_at)+'</td><td>'+typeKo(x.claim_type)+'</td>'+
      '<td><strong>'+esc(x.order_no||'-')+'</strong><div class="muted">'+esc(x.cs_no||'')+'</div></td>'+
      '<td>'+esc(x.mall_order_no||'-')+'</td>'+
      '<td class="product">'+esc(x.product_name||'-')+'<div class="muted">'+esc(x.pi_ii_vi||'')+'</div></td>'+
      '<td class="num">'+esc(x.quantity||0)+'</td><td>'+esc(x.reason_text||'-')+'</td>'+
      '<td>'+badge(x.normalized_status)+'</td><td>'+esc(logistics)+'</td>'+
      '<td>'+esc(x.admin_id||'-')+'<div class="muted">'+esc(x.mall_account_id||'')+'</div></td>'+
      '<td>'+badge(x.work_status||'-')+'</td>'+
      '<td><button class="ops-link-btn" data-detail="'+i+'">보기</button></td></tr>';
    }).join('');
    tb.querySelectorAll('[data-detail]').forEach(function(b){b.addEventListener('click',function(){
      var x=rows[Number(b.getAttribute('data-detail'))]||{};
      toggleDetail(b,
        '<div><span>CS 상태 원문</span><strong>'+esc(x.raw_status||'-')+'</strong></div>'+
        '<div><span>회수완료일</span><strong>'+dtt(x.return_received_at)+'</strong></div>'+
        '<div><span>재배송일</span><strong>'+dtt(x.reship_at)+'</strong></div>'+
        '<div><span>오류</span><strong>'+esc([x.error_code,x.error_message].filter(Boolean).join(' / ')||'-')+'</strong></div>'
      );
    });});
  }catch(e){setText('summary','조회 실패: '+(e&&e.message||e));document.getElementById('rows').innerHTML='<tr><td colspan="12" class="ops-empty">'+esc(e&&e.message||e)+'</td></tr>';}
}
document.querySelectorAll('[data-type]').forEach(function(b){b.addEventListener('click',function(){
  currentType=b.getAttribute('data-type');document.querySelectorAll('[data-type]').forEach(function(x){x.classList.toggle('active',x===b);});load();
});});
document.getElementById('searchBtn').addEventListener('click',load);
document.getElementById('q').addEventListener('keydown',function(e){if(e.key==='Enter')load();});
document.getElementById('refreshBtn').addEventListener('click',load);
load();
})();
