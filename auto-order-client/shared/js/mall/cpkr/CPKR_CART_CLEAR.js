/* CPKR_CART_CLEAR_V053
 * Single cart-cleaning module.
 * CPKR_CART_CLEAN is retired; all batch-start cart inspection/clearing lives here.
 * Confirmed cart row DOM:
 *   input.cart-quantity-input -> closest div[id^="item_"]
 */
(function(W,D){
  'use strict';
  if(W.CPKR_CART_CLEAR && W.CPKR_CART_CLEAR.version === '053') return;

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

    del.click();

    /*
     * Give Coupang time to process the one bulk delete request.
     * The orchestrator releases the page afterward; do not perform
     * repeated item-by-item DOM scans here.
     */
    await sleep(900);

    return {
      ok:true,
      requested:rs.length,
      initial_count:rs.length,
      method:'select-all-selected-delete',
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
    version:'053',
    snapshot:snapshot,
    clearAll:clearAll,
    run:run,
    isEmpty:function(){ return rows().length===0; },
    rows:rows,
    selectAllCheckbox:selectAllCheckbox,
    selectedDeleteButton:selectedDeleteButton
  };
})(window,document);
