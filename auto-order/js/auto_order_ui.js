'use strict';
(function(){
  const rows=document.getElementById('gmAoRows');
  const counts=document.getElementById('gmAoCounts');
  const btn=document.getElementById('gmAoRefresh');

  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>Number(v||0).toLocaleString('ko-KR')+'원';
  const label=s=>({WAIT_PAYMENT:'결제대기',PENDING:'주문대기',ASSIGNED:'배정완료',RUNNING:'처리중',WAITING_ADMIN:'확인필요',COMPLETED:'완료',FAILED:'실패'})[String(s||'').toUpperCase()]||String(s||'-');

  async function api(url,opt){
    const r=await fetch(url,opt);
    const j=await r.json().catch(()=>({}));
    if(!r.ok||j.ok===false) throw new Error(j.detail||j.error||('HTTP '+r.status));
    return j;
  }

  function render(data){
    const c={};
    data.forEach(x=>{const s=String(x.work_status||'').toUpperCase();c[s]=(c[s]||0)+1;});
    counts.innerHTML=
      '전체 <b>'+data.length+'</b>　'+
      '주문대기 <b>'+Number(c.PENDING||0)+'</b>　'+
      '결제대기 <b>'+Number(c.WAIT_PAYMENT||0)+'</b>　'+
      '처리중 <b>'+Number(c.RUNNING||0)+'</b>　'+
      '확인필요 <b>'+Number(c.WAITING_ADMIN||0)+'</b>';

    if(!data.length){
      rows.innerHTML='<tr><td colspan="11" style="padding:32px;text-align:center;color:#8b929b">자동주문 대상 주문이 없습니다.</td></tr>';
      return;
    }
    rows.innerHTML=data.map(x=>{
      const fee=Number(x.total_delivery_fee||0)+Number(x.extra_area_delivery_fee||0);
      const progress=Number(x.ordered_item_count||0)+'/'+Number(x.received_item_count||0);
      return '<tr style="border-bottom:1px solid #eceff2">'+
        '<td style="padding:11px 10px">'+esc(x.ordered_at||'-')+'</td>'+
        '<td style="padding:11px 10px"><b>'+esc(x.order_no)+'</b><div style="font-size:11px;color:#8a919a">'+esc(x.auto_order_no)+'</div></td>'+
        '<td style="padding:11px 10px">'+esc(x.orderer_name||x.receiver_name||x.member_id||'-')+'</td>'+
        '<td style="padding:11px 10px;text-align:center">'+esc(x.mall_code||'-')+'</td>'+
        '<td style="padding:11px 10px;text-align:center"><b>'+esc(progress)+'</b></td>'+
        '<td style="padding:11px 10px;text-align:right">'+money(x.total_product_price)+'</td>'+
        '<td style="padding:11px 10px;text-align:right">'+money(fee)+'</td>'+
        '<td style="padding:11px 10px;text-align:center">'+esc(x.payment_status||'-')+'</td>'+
        '<td style="padding:11px 10px;text-align:center"><b>'+esc(label(x.work_status))+'</b></td>'+
        '<td style="padding:11px 10px">'+esc(x.admin_id||'-')+'</td>'+
        '<td style="padding:11px 10px">'+esc(x.mall_account_id||'-')+'</td>'+
      '</tr>';
    }).join('');
  }

  async function load(sync){
    rows.innerHTML='<tr><td colspan="11" style="padding:32px;text-align:center;color:#8b929b">불러오는 중입니다.</td></tr>';
    try{
      if(sync) await api('/api/auto-order/orders/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      const j=await api('/api/auto-order/orders');
      render(Array.isArray(j.data)?j.data:[]);
    }catch(e){
      rows.innerHTML='<tr><td colspan="11" style="padding:32px;text-align:center;color:#c62828">불러오기 실패: '+esc(e.message)+'</td></tr>';
    }
  }

  if(btn) btn.addEventListener('click',()=>load(true));
  load(true);
})();