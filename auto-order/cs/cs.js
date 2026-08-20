/* GM_AUTO_ORDER_CS_UI_V001 */
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
'<div class="ops-card"><span>전체 CS</span><strong id="cTotal">0</strong></div>'+
'<div class="ops-card"><span>요청</span><strong id="cRequested">0</strong></div>'+
'<div class="ops-card"><span>처리중</span><strong id="cProcessing">0</strong></div>'+
'<div class="ops-card"><span>완료</span><strong id="cDone">0</strong></div>'+
'<div class="ops-card"><span>미읽음 메시지</span><strong id="cUnread">0</strong></div>'+
'<div class="ops-card"><span>배송/결제 CS</span><strong id="cOther">0</strong></div>'+
'</div>'+
'<div class="ops-tools">'+
'<input id="q" type="search" placeholder="CS번호 / 주문번호 / 상품 / 메시지 검색">'+
'<select id="type"><option value="">전체 유형</option><option value="CS">일반CS</option><option value="DELIVERY">배송</option><option value="PAYMENT">결제</option><option value="CANCEL">취소</option><option value="EXCHANGE">교환</option><option value="RETURN">반품</option><option value="REFUND">환불</option></select>'+
'<select id="status"><option value="">전체 상태</option><option value="REQUESTED">요청</option><option value="PROCESSING">처리중</option><option value="COMPLETED">완료</option><option value="CANCELLED">취소</option></select>'+
'<button id="searchBtn" type="button">조회</button>'+
'</div>'+
'<div id="summary" class="ops-summary">조회 중...</div>'+
'<div class="ops-table-wrap"><table class="ops-table"><thead><tr>'+
'<th>요청일</th><th>CS번호</th><th>유형</th><th>주문번호</th><th>상품</th><th>상태</th><th>요약</th><th>메시지</th><th>미읽음</th><th>외부몰 주문번호</th><th>최근 메시지</th><th>상세</th>'+
'</tr></thead><tbody id="rows"><tr><td colspan="12" class="ops-empty">조회 중...</td></tr></tbody></table></div>'+
'<div class="ops-note">CS 데이터가 없으면 0건으로 표시됩니다. gm_cs / gm_cs_message가 생성되면 별도 변경 없이 이 화면에서 조회됩니다.</div>';

async function load(){
  var p=new URLSearchParams({limit:'300'});
  if(document.getElementById('q').value.trim())p.set('q',document.getElementById('q').value.trim());
  if(document.getElementById('type').value)p.set('type',document.getElementById('type').value);
  if(document.getElementById('status').value)p.set('status',document.getElementById('status').value);
  try{
    var r=await fetch('/api/auto-order/operations/cs?'+p.toString(),{cache:'no-store'});
    var j=await r.json();if(!r.ok||!j.ok)throw new Error(j.detail||j.error||('HTTP '+r.status));
    var d=j.data||{},c=d.counts||{},rows=Array.isArray(d.rows)?d.rows:[];
    setText('cTotal',c.total||0);setText('cRequested',c.requested||0);setText('cProcessing',c.processing||0);setText('cDone',c.completed||0);setText('cUnread',c.unread||0);setText('cOther',c.delivery_payment||0);
    setText('summary','총 '+Number(d.total||0).toLocaleString('ko-KR')+'건 · 현재 '+rows.length+'건 표시');
    var tb=document.getElementById('rows');
    if(!rows.length){tb.innerHTML='<tr><td colspan="12" class="ops-empty">CS 데이터가 없습니다.</td></tr>';return;}
    tb.innerHTML=rows.map(function(x,i){
      return '<tr>'+
      '<td>'+dtt(x.requested_at)+'</td><td><strong>'+esc(x.cs_no||'-')+'</strong></td>'+
      '<td>'+esc(x.cs_type||'-')+'</td><td>'+esc(x.order_no||'-')+'</td>'+
      '<td class="product">'+esc(x.product_name||'-')+'<div class="muted">'+esc(x.pi_ii_vi||'')+'</div></td>'+
      '<td>'+badge(x.normalized_status)+'</td><td class="product">'+esc(x.message_summary||'-')+'</td>'+
      '<td class="num">'+esc(x.message_count||0)+'</td><td class="num">'+esc(x.unread_count||0)+'</td>'+
      '<td>'+esc(x.mall_order_no||'-')+'</td><td class="product">'+esc(x.last_message||'-')+'</td>'+
      '<td><button class="ops-link-btn" data-detail="'+i+'">보기</button></td></tr>';
    }).join('');
    tb.querySelectorAll('[data-detail]').forEach(function(b){b.addEventListener('click',function(){
      var x=rows[Number(b.getAttribute('data-detail'))]||{};
      toggleDetail(b,
        '<div><span>회원ID</span><strong>'+esc(x.member_id||'-')+'</strong></div>'+
        '<div><span>최근 메시지 일시</span><strong>'+dtt(x.last_message_at)+'</strong></div>'+
        '<div><span>회수 송장</span><strong>'+esc([x.return_carrier,x.return_invoice_no].filter(Boolean).join(' / ')||'-')+'</strong></div>'+
        '<div><span>재배송 송장</span><strong>'+esc([x.reship_carrier,x.reship_invoice_no].filter(Boolean).join(' / ')||'-')+'</strong></div>'
      );
    });});
  }catch(e){setText('summary','조회 실패: '+(e&&e.message||e));document.getElementById('rows').innerHTML='<tr><td colspan="12" class="ops-empty">'+esc(e&&e.message||e)+'</td></tr>';}
}
document.getElementById('searchBtn').addEventListener('click',load);
document.getElementById('q').addEventListener('keydown',function(e){if(e.key==='Enter')load();});
document.getElementById('refreshBtn').addEventListener('click',load);
load();
})();
