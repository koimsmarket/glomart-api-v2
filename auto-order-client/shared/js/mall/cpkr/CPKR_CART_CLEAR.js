/* CPKR_CART_CLEAR_V057
 * Single cart-cleaning module.
 * CPKR_CART_CLEAN is retired; all batch-start cart inspection/clearing lives here.
 * Confirmed cart row DOM:
 *   input.cart-quantity-input -> closest div[id^="item_"]
 */
(function(W,D){
  'use strict';
  if(W.CPKR_CART_CLEAR && W.CPKR_CART_CLEAR.version === '057') return;

  function sleep(ms){ return new Promise(function(r){ setTimeout(r,ms); }); }
  function digits(v){ return String(v==null?'':v).replace(/\D/g,''); }

  function rows(){
    var out=[], seen=new Set();
    Array.prototype.slice.call(D.querySelectorAll('input.cart-quantity-input')).forEach(function(input){
      var row=input.closest && input.closest('div[id^="item_"]');
      if(!row || seen.has(row)) return;
      if(!row.querySelector('a[href*="/vp/products/"]')) return;
      seen.add(row); out.push(row);
    });
    return out;
  }

  function identity(row){
    var a=row && row.querySelector('a[href*="/vp/products/"]');
    var href=a && (a.getAttribute('href')||a.href) || '';
    var pid='', iid='', vid='';
    var pm=href.match(/\/vp\/products\/(\d+)/i); if(pm) pid=pm[1];
    try{
      var u=new URL(href, location.href);
      iid=digits(u.searchParams.get('itemId'));
      vid=digits(u.searchParams.get('vendorItemId'));
    }catch(_e){
      var im=href.match(/[?&]itemId=(\d+)/i), vm=href.match(/[?&]vendorItemId=(\d+)/i);
      if(im) iid=im[1]; if(vm) vid=vm[1];
    }
    return {pid:pid,iid:iid,vid:vid,puid:(pid&&iid&&vid?[pid,iid,vid].join('_'):'')};
  }

  function quantity(row){
    var input=row && row.querySelector('input.cart-quantity-input');
    var n=Number(input && input.value || 1);
    return isFinite(n)&&n>0 ? Math.floor(n) : 1;
  }

  function selectAllCheckbox(){
    var inputs=Array.prototype.slice.call(
      D.querySelectorAll('input[type="checkbox"]')
    );

    /*
     * Confirmed Coupang cart DOM:
     * input title="모든 상품을 결제상품으로 설정"
     * label text contains "전체 선택 (N / N)".
     */
    return inputs.find(function(input){
      var title=String(input.getAttribute('title')||'').trim();
      if(title==='모든 상품을 결제상품으로 설정') return true;

      var host=input.closest && input.closest('label');
      var text=String(host && host.textContent || '').replace(/\s+/g,' ').trim();
      return /전체\s*선택/.test(text);
    }) || null;
  }

  function selectedDeleteButton(){
    /*
     * Confirmed Coupang cart DOM:
     * <div ... hover:twc-cursor-pointer>선택삭제</div>
     * Use exact visible text so "품절/판매종료상품 전체삭제" is never chosen.
     */
    var nodes=Array.prototype.slice.call(
      D.querySelectorAll('button,a,[role="button"],div,span')
    );

    return nodes.find(function(el){
      return String(el.textContent||'').replace(/\s+/g,' ').trim()==='선택삭제';
    }) || null;
  }

  function ensureSelectAll(){
    var checkbox=selectAllCheckbox();
    if(!checkbox) throw new Error('CART_CLEAR_SELECT_ALL_NODE_MISSING');

    if(!checkbox.checked){
      checkbox.click();
    }
    return checkbox;
  }

  function snapshot(){
    return rows().map(function(row,index){
      var id=identity(row);
      return {
        index:index,
        row_id:row.id||'',
        pid:id.pid,
        iid:id.iid,
        vid:id.vid,
        puid:id.puid,
        quantity:quantity(row)
      };
    });
  }

  function armMainWorldDeleteConfirm(){
    /*
     * Tampermonkey sandbox window.confirm is not necessarily Coupang's
     * page-world confirm. Inject a one-shot hook into MAIN world.
     * It approves only the exact cart-delete question and restores itself
     * immediately after that one matching invocation (or after timeout).
     */
    var token='gmao-delete-confirm-'+Date.now()+'-'+Math.random().toString(36).slice(2);
    var script=D.createElement('script');
    script.textContent=
      '(function(){' +
      'var TOKEN='+JSON.stringify(token)+';' +
      'var MSG='+JSON.stringify('선택한 상품을 삭제하시겠습니까?')+';' +
      'var old=window.confirm;' +
      'var done=false;' +
      'function restore(){if(done)return;done=true;if(window.confirm===hook)window.confirm=old;}' +
      'function hook(m){var t=String(m||"").replace(/\\\\s+/g," ").trim();' +
        'if(t===MSG){restore();return true;}' +
        'return old.call(window,m);' +
      '}' +
      'window.confirm=hook;' +
      'setTimeout(restore,2500);' +
      '})();';
    (D.documentElement||D.head||D.body).appendChild(script);
    script.remove();
    return token;
  }


  async function clearAll(){
    /*
     * One cart operation:
     * 1) ensure all cart items are selected
     * 2) click the single "선택삭제" control
     * No per-item delete DOM lookup/click loop.
     */
    var rs=rows();
    if(!rs.length){
      return {ok:true,requested:0,initial_count:0,method:'already-empty'};
    }

    var checkbox=ensureSelectAll();
    await sleep(120);

    var del=selectedDeleteButton();
    if(!del) throw new Error('CART_CLEAR_SELECTED_DELETE_NODE_MISSING');

    armMainWorldDeleteConfirm();
    await sleep(30);
    del.click();

    /*
     * Confirm actual deletion. This is one bounded post-action check,
     * not a repeated item-by-item scrape.
     */
    var started=Date.now();
    var remaining=rows().length;
    while(Date.now()-started<3500){
      remaining=rows().length;
      if(remaining===0) break;
      await sleep(150);
    }

    if(remaining!==0){
      throw new Error('CART_CLEAR_NOT_EMPTY_AFTER_SELECTED_DELETE:' + remaining);
    }

    return {
      ok:true,
      requested:rs.length,
      initial_count:rs.length,
      remaining_count:0,
      method:'select-all-selected-delete-main-confirm',
      select_all_checked:!!checkbox.checked
    };
  }

  /* Backward-compatible entry point for any existing caller. */
  async function run(){
    var snap=snapshot();
    if(!snap.length) return {ok:true,skipped:true,count:0,snapshot:snap};
    var result=await clearAll();
    result.skipped=false;
    result.count=snap.length;
    result.snapshot=snap;
    return result;
  }

  W.CPKR_CART_CLEAR={
    version:'057',
    snapshot:snapshot,
    clearAll:clearAll,
    run:run,
    isEmpty:function(){ return rows().length===0; },
    rows:rows,
    selectAllCheckbox:selectAllCheckbox,
    selectedDeleteButton:selectedDeleteButton
  };
})(window,document);
