// GM_BUILDER_PURCHASE_CONFIRM_V001
(function(W,D){
  'use strict';
  function q(s){return D.querySelector(s);} function qa(s){return Array.prototype.slice.call(D.querySelectorAll(s));}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
  function money(v){const n=Number(v)||0;return Math.round(n).toLocaleString('ko-KR')+'원';}
  async function json(url,opt){const r=await fetch(url,opt);const j=await r.json().catch(()=>({}));if(!r.ok||j.ok===false)throw new Error(j.error||('HTTP '+r.status));return j;}
  function status(t,bad){const e=q('#purchaseConfirmStatus');if(e){e.textContent=t;e.style.color=bad?'#b91c1c':'';}}
  function selected(){return qa('#purchaseConfirmRows input[type=checkbox][data-order]:checked').map(x=>x.dataset.order);}
  function render(items){
    const tb=q('#purchaseConfirmRows'); if(!tb)return;
    if(!items.length){tb.innerHTML='<tr><td colspan="11">구매확정 대상이 없습니다.</td></tr>';return;}
    tb.innerHTML=items.map(x=>'<tr>'+ 
      '<td><input type="checkbox" data-order="'+esc(x.order_no)+'"></td>'+ 
      '<td>'+esc(x.order_no)+'</td><td>'+esc(x.member_id||'')+'</td>'+ 
      '<td>'+money(x.total_product_price)+'</td><td>'+money(x.point_used_amount)+'</td>'+ 
      '<td>'+money(x.product_paid_amount)+'</td><td>'+money(x.reward_expected)+'</td>'+ 
      '<td>'+money((Number(x.total_delivery_fee)||0)+(Number(x.extra_area_delivery_fee)||0))+'</td>'+ 
      '<td>'+esc(x.payment_status||'')+'</td><td>'+esc(x.seller_status||x.shipping_status||'')+'</td>'+ 
      '<td>'+(x.delivered_at?esc(String(x.delivered_at)):'-')+'</td></tr>').join('');
  }
  W.loadPurchaseConfirmCandidates=async function(){try{status('구매확정 대상 조회 중...');const j=await json('/api/gm/builder/purchase-confirm/candidates?limit=300');render(j.items||[]);status('대상 '+Number(j.count||0).toLocaleString('ko-KR')+'건 · 적립금은 순상품 실결제액 3%, 10원 미만 절사 · 배송비 제외');}catch(e){status('조회 실패: '+e.message,true);}};
  W.purchaseConfirmSelectAll=function(on){qa('#purchaseConfirmRows input[type=checkbox][data-order]').forEach(x=>x.checked=!!on);};
  W.confirmSelectedPurchases=async function(){const list=selected();if(!list.length){status('구매확정할 주문을 선택하세요.',true);return;}if(!confirm('선택한 '+list.length+'건을 구매확정하고 적립금 및 G-PAY 대리점 인센티브를 확정합니까?'))return;try{status('구매확정 처리 중...');const j=await json('/api/gm/builder/purchase-confirm/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({order_nos:list})});const failed=(j.results||[]).filter(x=>!x.ok);status('완료 '+(j.processed||0)+'건 / 실패 '+(j.failed||0)+'건'+(failed.length?' · '+failed.map(x=>x.order_no+': '+x.error).join(' | '):''),failed.length>0);await W.loadPurchaseConfirmCandidates();}catch(e){status('처리 실패: '+e.message,true);}};
  D.addEventListener('DOMContentLoaded',function(){if(q('#purchaseConfirmRows'))W.loadPurchaseConfirmCandidates();});
})(window,document);
