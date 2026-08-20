/* GM_AUTO_ORDER_DELIVERY_UI_V001 */
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

var root=document.getElementById('opsRoot');
root.innerHTML=
'<div class="ops-cards">'+
'<div class="ops-card"><span>전체 상품</span><strong id="cTotal">0</strong></div>'+
'<div class="ops-card"><span>배송준비</span><strong id="cReady">0</strong></div>'+
'<div class="ops-card"><span>배송중</span><strong id="cShipping">0</strong></div>'+
'<div class="ops-card"><span>배송완료</span><strong id="cDone">0</strong></div>'+
'<div class="ops-card"><span>송장 미확보</span><strong id="cNoInvoice">0</strong></div>'+
'<div class="ops-card"><span>배송 지연/예외</span><strong id="cException">0</strong></div>'+
'</div>'+
'<div class="ops-tools">'+
'<input id="q" type="search" placeholder="Glomart 주문번호 / 외부몰 주문번호 / 상품 / 회원ID 검색">'+
'<select id="mall"><option value="">전체 주문처</option><option value="CPKR">쿠팡</option><option value="ALKR">알리</option></select>'+
'<select id="status"><option value="">전체 배송상태</option><option value="READY">배송준비</option><option value="SHIPPING">배송중</option><option value="DELIVERED">배송완료</option><option value="NO_INVOICE">송장 미확보</option><option value="EXCEPTION">지연/예외</option></select>'+
'<button id="searchBtn" type="button">조회</button>'+
'</div>'+
'<div id="summary" class="ops-summary">조회 중...</div>'+
'<div class="ops-table-wrap"><table class="ops-table"><thead><tr>'+
'<th>주문일</th><th>Glomart 주문번호</th><th>외부몰</th><th>외부몰 주문번호</th><th>상품</th><th>수량</th><th>배송상태</th><th>택배사</th><th>송장번호</th><th>발송일</th><th>배송완료일</th><th>담당/계정</th><th>상세</th>'+
'</tr></thead><tbody id="rows"><tr><td colspan="13" class="ops-empty">조회 중...</td></tr></tbody></table></div>'+
'<div class="ops-note">실제 배송자료가 아직 없어도 이 화면은 0건으로 정상 동작합니다. 송장/배송상태가 저장되면 자동으로 목록에 표시됩니다.</div>';

async function load(){
  var p=new URLSearchParams({limit:'300'});
  if(document.getElementById('q').value.trim())p.set('q',document.getElementById('q').value.trim());
  if(document.getElementById('mall').value)p.set('mall_code',document.getElementById('mall').value);
  if(document.getElementById('status').value)p.set('status',document.getElementById('status').value);
  setText('summary','조회 중...');
  try{
    var r=await fetch('/api/auto-order/operations/delivery?'+p.toString(),{cache:'no-store'});
    var j=await r.json();if(!r.ok||!j.ok)throw new Error(j.detail||j.error||('HTTP '+r.status));
    var d=j.data||{},c=d.counts||{},rows=Array.isArray(d.rows)?d.rows:[];
    setText('cTotal',c.total||0);setText('cReady',c.ready||0);setText('cShipping',c.shipping||0);setText('cDone',c.delivered||0);setText('cNoInvoice',c.no_invoice||0);setText('cException',c.exception||0);
    setText('summary','총 '+Number(d.total||0).toLocaleString('ko-KR')+'건 · 현재 '+rows.length+'건 표시');
    var tb=document.getElementById('rows');
    if(!rows.length){tb.innerHTML='<tr><td colspan="13" class="ops-empty">배송 데이터가 없습니다.</td></tr>';return;}
    tb.innerHTML=rows.map(function(x,i){
      return '<tr data-i="'+i+'">'+
      '<td>'+dt(x.ordered_at)+'</td>'+
      '<td><strong>'+esc(x.order_no||'-')+'</strong><div class="muted">'+esc(x.member_id||'')+'</div></td>'+
      '<td>'+esc(x.mall_code||'-')+'</td>'+
      '<td>'+esc(x.mall_order_no||'-')+'</td>'+
      '<td class="product">'+esc(x.product_name||'-')+'<div class="muted">'+esc(x.option_text||'')+'</div></td>'+
      '<td class="num">'+esc(x.quantity||0)+'</td>'+
      '<td>'+badge(x.shipping_status)+'</td>'+
      '<td>'+esc(x.carrier_name||'-')+'</td>'+
      '<td>'+esc(x.tracking_number||'-')+'</td>'+
      '<td>'+dtt(x.shipping_started_at)+'</td>'+
      '<td>'+dtt(x.shipping_completed_at)+'</td>'+
      '<td>'+esc(x.admin_id||'-')+'<div class="muted">'+esc(x.mall_account_id||'')+'</div></td>'+
      '<td><button class="ops-link-btn" data-detail="'+i+'">보기</button></td></tr>';
    }).join('');
    tb.querySelectorAll('[data-detail]').forEach(function(b){b.addEventListener('click',function(){
      var x=rows[Number(b.getAttribute('data-detail'))]||{};
      toggleDetail(b,
        '<div><span>상품키</span><strong>'+esc(x.pi_ii_vi||'-')+'</strong></div>'+
        '<div><span>상품 주문상태</span><strong>'+esc(x.item_order_status||'-')+'</strong></div>'+
        '<div><span>주문 배송상태</span><strong>'+esc(x.order_shipping_status||'-')+'</strong></div>'+
        '<div><span>최근 갱신</span><strong>'+dtt(x.updated_at)+'</strong></div>'
      );
    });});
  }catch(e){
    setText('summary','조회 실패: '+(e&&e.message||e));
    document.getElementById('rows').innerHTML='<tr><td colspan="13" class="ops-empty">'+esc(e&&e.message||e)+'</td></tr>';
  }
}
document.getElementById('searchBtn').addEventListener('click',load);
document.getElementById('q').addEventListener('keydown',function(e){if(e.key==='Enter')load();});
document.getElementById('refreshBtn').addEventListener('click',load);
load();
})();
