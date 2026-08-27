(function(){
  'use strict';
  var VERSION='GM_AUTO_ORDER_CONTROL_TOWER_UI_V007_DETAIL';
  var $=function(id){return document.getElementById(id);};

  function esc(v){
    return String(v==null?'':v)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function won(v){
    var n=Number(v||0);
    return (Number.isFinite(n)?n:0).toLocaleString('ko-KR')+'원';
  }
  function date(v){
    if(!v)return '-';
    var d=new Date(v);
    if(Number.isNaN(d.getTime()))return esc(v);
    return d.toLocaleDateString('ko-KR');
  }
  function cls(s){
    s=String(s||'').toUpperCase();
    if(s==='READY')return 'pill ready';
    if(s==='WAIT_PAYMENT')return 'pill wait';
    if(s==='RUNNING')return 'pill run';
    if(s==='FAILED')return 'pill fail';
    return 'pill';
  }
  function koStatus(s){
    s=String(s||'').toUpperCase();
    var map={
      WAIT_PAYMENT:'결제대기',
      READY:'실행대기',
      RUNNING:'실행중',
      FAILED:'실패',
      COMPLETED:'완료',
      CANCELLED:'취소',
      PENDING:'대기'
    };
    return map[s]||s||'-';
  }

  async function load(){
    $('summary').textContent='컨트롤타워 동기화 및 조회 중...';
    $('rows').innerHTML='<tr><td colspan="14" class="empty">조회 중...</td></tr>';

    var p=new URLSearchParams();
    var q=$('q').value.trim();
    var mall=$('mall').value;
    var status=$('status').value;
    if(q)p.set('q',q);
    if(mall)p.set('mall_code',mall);
    if(status)p.set('work_status',status);
    p.set('limit','200');
    p.set('sync_limit','300');

    try{
      var r=await fetch('/api/auto-order/control-tower?'+p.toString(),{cache:'no-store'});
      var j=await r.json();
      if(!r.ok||!j.ok)throw new Error(j.detail||j.error||('HTTP '+r.status));

      var data=j.data||{};
      var rows=Array.isArray(data.rows)?data.rows:[];
      var counts=data.visible_status_counts||{};

      $('cTotal').textContent=Number(data.total||0).toLocaleString('ko-KR');
      $('cWait').textContent=Number(counts.WAIT_PAYMENT||0).toLocaleString('ko-KR');
      $('cReady').textContent=Number(counts.READY||0).toLocaleString('ko-KR');
      $('cUnassigned').textContent=Number(data.unassigned_visible||0).toLocaleString('ko-KR');
      $('cAssigned').textContent=Number(data.assigned_visible||0).toLocaleString('ko-KR');

      var sync=j.sync||{};
      $('summary').textContent=
        '총 '+Number(data.total||0).toLocaleString('ko-KR')+'건 · 현재 '+rows.length+'건 표시'+
        ' / 최근 주문 '+Number(sync.scanned||0)+'건 점검'+
        ' / 주문대상 '+Number(sync.actionable_orders||sync.external_orders||0)+'건'+
        ' / '+VERSION;

      if(!rows.length){
        $('rows').innerHTML='<tr><td colspan="14" class="empty">자동주문 작업이 없습니다.</td></tr>';
        return;
      }

      $('rows').innerHTML=rows.map(function(x){
        var payment=x.payment_completed_at?'결제완료':'결제대기';
        var err=[x.last_error_code,x.last_error_message].filter(Boolean).join(' / ');
        return '<tr>'+
          '<td>'+date(x.ordered_at)+'</td>'+
          '<td><button class="order-detail-btn" data-order-no="'+esc(x.order_no)+'" type="button" aria-expanded="false">'+esc(x.order_no)+'</button><div class="muted">'+esc(x.auto_order_no)+'</div></td>'+
          '<td>'+esc(x.source_codes||'-')+'</td>'+
          '<td>'+esc(x.mall_code||'-')+'</td>'+
          '<td class="product">'+esc(x.product_names||'-')+'</td>'+
          '<td class="num">'+esc(x.received_item_count||0)+'</td>'+
          '<td>'+esc(payment)+'</td>'+
          '<td><span class="'+cls(x.work_status)+'">'+esc(koStatus(x.work_status))+'</span></td>'+
          '<td>'+esc(x.admin_id||'-')+'</td>'+
          '<td>'+esc(x.mall_account_id||'-')+'</td>'+
          '<td>'+esc(x.mall_order_no||'-')+'</td>'+
          '<td class="num"><strong>'+won(x.actual_payment_amount)+'</strong></td>'+
          '<td>'+esc(err||'-')+'</td>'+
          '<td>'+(
            ['WAIT_PAYMENT','PAYMENT_WAITING'].includes(String(x.work_status||'').toUpperCase())
              ? '<button class="pay-confirm-btn" data-order-no="'+esc(x.order_no)+'" type="button">결제확인</button>'
              : (String(x.work_status||'').toUpperCase()==='FAILED'
                  ? '<button class="retry-btn" data-work-id="'+esc(x.work_id)+'" type="button">재실행</button>'
                  : '-')
          )+'</td>'+
        '</tr>';
      }).join('');
    }catch(e){
      $('summary').textContent='컨트롤타워 조회 실패';
      $('rows').innerHTML='<tr><td colspan="14" class="empty">'+esc(e&&e.message||e)+'</td></tr>';
    }
  }


  function text(v){return (v==null||v==='')?'-':esc(v);}
  function qty(v){var n=Number(v||0);return Number.isFinite(n)?n.toLocaleString('ko-KR'):'0';}
  function moneyOrDash(v){return (v==null||v==='')?'-':won(v);}
  function detailDate(v){
    if(!v)return '-';
    var d=new Date(String(v).replace(/^"|"$/g,''));
    if(Number.isNaN(d.getTime()))return esc(v);
    return d.toLocaleString('ko-KR');
  }
  function detailCard(k,v,klass){
    return '<div class="detail-card"><div class="k">'+esc(k)+'</div><div class="v '+(klass||'')+'">'+v+'</div></div>';
  }
  function sum(arr,key){return (arr||[]).reduce(function(a,x){return a+Number((x&&x[key])||0);},0);}
  function renderDetail(data){
    data=data||{};
    var o=data.order||{};
    var items=Array.isArray(data.items)?data.items:[];
    var aos=Array.isArray(data.auto_orders)?data.auto_orders:[];
    var ais=Array.isArray(data.auto_items)?data.auto_items:[];
    var works=Array.isArray(data.works)?data.works:[];
    var logs=Array.isArray(data.logs)?data.logs:[];

    var customerTotal=Number(o.total_payment_price||o.expected_payment_amount||0);
    var autoExpected=sum(aos,'actual_payment_amount');
    var diff=autoExpected-customerTotal;
    var diffClass=diff===0?'compare-good':'compare-bad';

    var out='<div class="order-detail">';
    out+='<div class="detail-grid">'+
      detailCard('고객 주문 총액',won(customerTotal))+
      detailCard('상품 합계',won(o.total_product_price))+
      detailCard('배송비',won(Number(o.total_delivery_fee||0)+Number(o.extra_area_delivery_fee||0)))+
      detailCard('자동주문 예정 합계',won(autoExpected),diffClass)+
      detailCard('금액 차이',(diff>0?'+':'')+won(diff),diffClass)+
      detailCard('회원 / 수령인',text(o.member_id)+' / '+text(o.receiver_name))+
      detailCard('주문상태',text(o.order_status)+' / '+text(o.payment_status))+
      detailCard('주문일',detailDate(o.ordered_at))+
    '</div>';

    out+='<div class="detail-section"><div class="detail-title">고객 주문 원본 상품 ('+items.length+'건)</div><div class="detail-table-wrap"><table class="detail-table"><thead><tr>'+ 
      '<th>상품</th><th>옵션</th><th>수량</th><th>판매가</th><th>고객주문가</th><th>최종공급가</th><th>상품금액</th><th>배송비</th><th>출처/UID</th><th>링크</th>'+ 
      '</tr></thead><tbody>';
    if(!items.length) out+='<tr><td colspan="10" class="detail-empty">주문 상품이 없습니다.</td></tr>';
    else items.forEach(function(x){
      var option=[x.option_name,x.option_value].filter(Boolean).join(' / ')||'-';
      var delivery=Number(x.delivery_fee||0)+Number(x.extra_area_delivery_fee||0);
      out+='<tr>'+ 
        '<td class="wrap"><strong>'+text(x.product_name)+'</strong><div class="muted">'+text(x.pi_ii_vi)+'</div></td>'+ 
        '<td class="wrap">'+esc(option)+'</td>'+ 
        '<td class="num">'+qty(x.quantity)+'</td>'+ 
        '<td class="num">'+moneyOrDash(x.mall_sale_price)+'</td>'+ 
        '<td class="num">'+moneyOrDash(x.customer_order_price)+'</td>'+ 
        '<td class="num">'+moneyOrDash(x.final_supply_price)+'</td>'+ 
        '<td class="num"><strong>'+moneyOrDash(x.product_amount)+'</strong></td>'+ 
        '<td class="num">'+won(delivery)+'</td>'+ 
        '<td class="wrap">'+text(x.source_mall||x.mall_code)+'<div class="muted">'+text(x.source_uid)+'</div></td>'+ 
        '<td>'+(x.product_url?'<a class="detail-link" href="'+esc(x.product_url)+'" target="_blank" rel="noopener">상품보기</a>':'-')+'</td>'+ 
      '</tr>';
    });
    out+='</tbody></table></div></div>';

    out+='<div class="detail-section"><div class="detail-title">자동주문 실행 상품 ('+ais.length+'건)</div><div class="detail-table-wrap"><table class="detail-table"><thead><tr>'+ 
      '<th>자동주문번호</th><th>상품</th><th>옵션</th><th>접수수량</th><th>실제수량</th><th>원몰가</th><th>실행확인가</th><th>실제주문가</th><th>상태</th><th>오류</th>'+ 
      '</tr></thead><tbody>';
    if(!ais.length) out+='<tr><td colspan="10" class="detail-empty">아직 자동주문 상품 snapshot이 없습니다.</td></tr>';
    else ais.forEach(function(x){
      var qDiff=Number(x.ordered_quantity||0)>0 && Number(x.ordered_quantity)!==Number(x.quantity||0);
      var pDiff=x.ordered_price!=null && x.ordered_price!=='' && Number(x.ordered_price)!==Number(x.mall_sale_price||0);
      out+='<tr>'+ 
        '<td>'+text(x.auto_order_no)+'</td>'+ 
        '<td class="wrap"><strong>'+text(x.product_name)+'</strong><div class="muted">'+text(x.source_uid||x.pi_ii_vi)+'</div></td>'+ 
        '<td class="wrap">'+text([x.option_name,x.option_value].filter(Boolean).join(' / '))+'</td>'+ 
        '<td class="num">'+qty(x.quantity)+'</td>'+ 
        '<td class="num '+(qDiff?'compare-bad':'')+'">'+qty(x.ordered_quantity)+'</td>'+ 
        '<td class="num">'+moneyOrDash(x.mall_sale_price)+'</td>'+ 
        '<td class="num">'+moneyOrDash(x.order_attempt_price)+'</td>'+ 
        '<td class="num '+(pDiff?'compare-bad':'')+'">'+moneyOrDash(x.ordered_price)+'</td>'+ 
        '<td>'+text(x.process_status||x.item_order_status)+'</td>'+ 
        '<td class="detail-error">'+text([x.error_code,x.error_message].filter(Boolean).join(' / '))+'</td>'+ 
      '</tr>';
    });
    out+='</tbody></table></div></div>';

    out+='<div class="detail-section"><div class="detail-title">자동주문 작업 ('+works.length+'건)</div><div class="detail-table-wrap"><table class="detail-table"><thead><tr>'+ 
      '<th>Work</th><th>자동주문번호</th><th>유형</th><th>상태</th><th>관리자</th><th>몰 계정</th><th>요청</th><th>시작</th><th>완료</th><th>오류</th>'+ 
      '</tr></thead><tbody>';
    if(!works.length) out+='<tr><td colspan="10" class="detail-empty">작업 정보가 없습니다.</td></tr>';
    else works.forEach(function(x){
      out+='<tr><td>#'+text(x.work_id)+'</td><td>'+text(x.auto_order_no)+'</td><td>'+text(x.work_type)+'</td><td><span class="'+cls(x.work_status)+'">'+text(koStatus(x.work_status))+'</span></td>'+ 
        '<td>'+text(x.lock_admin_id||x.admin_id)+'</td><td>'+text(x.lock_mall_account_id||x.mall_account_id)+'</td>'+ 
        '<td>'+detailDate(x.requested_at)+'</td><td>'+detailDate(x.started_at)+'</td><td>'+detailDate(x.completed_at)+'</td>'+ 
        '<td class="detail-error">'+text([x.error_code,x.error_message].filter(Boolean).join(' / '))+'</td></tr>';
    });
    out+='</tbody></table></div></div>';

    if(logs.length){
      out+='<div class="detail-section"><div class="detail-title">주요 처리 이력 ('+logs.length+'건)</div><div class="detail-table-wrap"><table class="detail-table"><thead><tr><th>일시</th><th>작업</th><th>상태변경</th><th>Work</th><th>메시지</th></tr></thead><tbody>';
      logs.forEach(function(x){
        out+='<tr><td>'+detailDate(x.created_at)+'</td><td>'+text(x.action_type)+'</td><td>'+text(x.status_before)+' → '+text(x.status_after)+'</td><td>'+text(x.work_id)+'</td><td class="wrap">'+text(x.message)+'</td></tr>';
      });
      out+='</tbody></table></div></div>';
    }

    out+='</div>';
    return out;
  }

  async function toggleDetail(btn){
    var orderNo=btn.getAttribute('data-order-no');
    if(!orderNo)return;
    var mainRow=btn.closest('tr');
    var next=mainRow&&mainRow.nextElementSibling;
    if(next&&next.classList.contains('detail-row')){
      next.remove();
      btn.setAttribute('aria-expanded','false');
      return;
    }

    var tr=document.createElement('tr');
    tr.className='detail-row';
    tr.innerHTML='<td colspan="14"><div class="detail-loading">'+esc(orderNo)+' 상세내역 조회 중...</div></td>';
    mainRow.parentNode.insertBefore(tr,mainRow.nextSibling);
    btn.setAttribute('aria-expanded','true');

    try{
      var r=await fetch('/api/auto-order/control-tower/order/'+encodeURIComponent(orderNo)+'/detail',{cache:'no-store'});
      var j=await r.json();
      if(!r.ok||!j.ok)throw new Error(j.detail||j.error||('HTTP '+r.status));
      tr.firstElementChild.innerHTML=renderDetail(j.data||{});
    }catch(e){
      tr.firstElementChild.innerHTML='<div class="detail-empty detail-error">상세내역 조회 실패: '+esc(e&&e.message||e)+'</div>';
    }
  }

  async function sync(){
    $('syncBtn').disabled=true;
    $('syncBtn').textContent='동기화 중';
    try{
      var r=await fetch('/api/auto-order/control-tower/sync',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({limit:500})
      });
      var j=await r.json();
      if(!r.ok||!j.ok)throw new Error(j.detail||j.error||('HTTP '+r.status));
      await load();
    }catch(e){
      alert('자동주문 동기화 실패: '+(e&&e.message||e));
    }finally{
      $('syncBtn').disabled=false;
      $('syncBtn').textContent='주문 동기화';
    }
  }


  async function assignReady(){
    $('assignBtn').disabled=true;
    $('assignBtn').textContent='배정 중';
    try{
      var r=await fetch('/api/auto-order/control-tower/assign-ready',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({limit:300})
      });
      var j=await r.json();
      if(!r.ok||!j.ok)throw new Error(j.detail||j.error||('HTTP '+r.status));
      var d=j.data||{};
      if(Number(d.no_account||0)>0){
        alert(
          '배정 완료 '+Number(d.assigned||0)+'건\n'+
          '계정 미등록/비활성 '+Number(d.no_account||0)+'건\n\n'+
          '미배정 건은 gm_auto_order_account 등록 후 다시 배정하면 됩니다.'
        );
      }
      await load();
    }catch(e){
      alert('실행기 배정 실패: '+(e&&e.message||e));
    }finally{
      $('assignBtn').disabled=false;
      $('assignBtn').textContent='실행기 배정';
    }
  }


  async function confirmPayment(orderNo,btn){
    if(!orderNo)return;
    var raw=window.prompt(
      orderNo+' 주문의 현재까지 실제 입금 확인 금액을 입력하세요.\n'+
      '주문결과에서 사용된 예치금은 서버가 자동 합산합니다.',
      ''
    );
    if(raw===null)return;
    raw=String(raw).replace(/,/g,'').trim();
    if(!/^\d+$/.test(raw)){alert('입금 확인 금액을 숫자로 입력하세요.');return;}
    var actual=Number(raw);
    if(!Number.isFinite(actual)||actual<0){alert('입금 확인 금액이 올바르지 않습니다.');return;}

    if(btn){btn.disabled=true;btn.textContent='처리중';}
    try{
      var r=await fetch('/api/auto-order/control-tower/order/'+encodeURIComponent(orderNo)+'/payment-confirm',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({admin_id:'MANUAL',actual_payment_amount:actual})
      });
      var j=await r.json();
      if(!r.ok||!j.ok)throw new Error(j.detail||j.error||('HTTP '+r.status));

      var d=j.data||{};
      if(String(d.payment_status||'').toUpperCase()==='PAID'){
        alert(
          '결제확인 완료\n'+
          '주문번호: '+orderNo+'\n'+
          '실제 입금: '+won(d.actual_payment_amount)+'\n'+
          '예치금 사용: '+won(d.deposit_used_amount)+'\n'+
          '실행대기 전환: '+Number(d.works_ready||0)+'건'
        );
      }else{
        alert(
          '아직 완불되지 않았습니다.\n'+
          '주문번호: '+orderNo+'\n'+
          '실제 입금: '+won(d.actual_payment_amount)+'\n'+
          '이미 사용된 예치금: '+won(d.deposit_used_amount)+'\n'+
          '남은 결제금액: '+won(d.remaining_amount)+'\n\n'+
          '주문은 결제대기에 그대로 남습니다.'
        );
      }
      await load();
    }catch(e){
      alert('결제확인 실패: '+(e&&e.message||e));
    }finally{
      if(btn){btn.disabled=false;btn.textContent='결제확인';}
    }
  }

  async function retryFailed(workId,btn){
    if(!workId)return;
    if(!window.confirm('실패 작업 #'+workId+'을 장바구니 확인부터 다시 실행할까요?'))return;
    if(btn){btn.disabled=true;btn.textContent='복구중';}
    try{
      var r=await fetch('/api/auto-order/control-tower/work/'+encodeURIComponent(workId)+'/retry',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({admin_id:'MANUAL'})
      });
      var j=await r.json();
      if(!r.ok||!j.ok)throw new Error(j.detail||j.error||('HTTP '+r.status));
      await load();
    }catch(e){alert('재실행 복구 실패: '+(e&&e.message||e));}
    finally{if(btn){btn.disabled=false;btn.textContent='재실행';}}
  }

  $('rows').addEventListener('click',function(e){
    var detail=e.target.closest('.order-detail-btn');
    if(detail){toggleDetail(detail);return;}
    var pay=e.target.closest('.pay-confirm-btn');
    if(pay){confirmPayment(pay.getAttribute('data-order-no'),pay);return;}
    var retry=e.target.closest('.retry-btn');
    if(retry){retryFailed(retry.getAttribute('data-work-id'),retry);}
  });

  $('refreshBtn').addEventListener('click',load);
  $('searchBtn').addEventListener('click',load);
  $('syncBtn').addEventListener('click',sync);
  $('assignBtn').addEventListener('click',assignReady);
  $('q').addEventListener('keydown',function(e){if(e.key==='Enter')load();});
  load();
})();
