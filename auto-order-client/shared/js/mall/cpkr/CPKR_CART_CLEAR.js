/* CPKR_CART_CLEAR_V047
 * Single cart-cleaning module.
 * CPKR_CART_CLEAN is retired; all batch-start cart inspection/clearing lives here.
 * Confirmed cart row DOM:
 *   input.cart-quantity-input -> closest div[id^="item_"]
 */
(function(W,D){
  'use strict';
  if(W.CPKR_CART_CLEAR && W.CPKR_CART_CLEAR.version === '047') return;

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

  function deleteButton(row){
    var nodes=Array.prototype.slice.call(row.querySelectorAll('button,a,[role="button"],div,span'));
    return nodes.find(function(el){
      if(String(el.textContent||'').trim()!=='삭제') return false;
      var tag=String(el.tagName||'').toUpperCase();
      if(tag==='BUTTON'||tag==='A'||el.getAttribute('role')==='button') return true;
      try { return getComputedStyle(el).cursor==='pointer'; } catch(_e) { return false; }
    }) || null;
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
        quantity:quantity(row),
        has_delete:!!deleteButton(row)
      };
    });
  }

  async function clearAll(){
    /* Collect once. No order comparison, no repeated full DOM scan. */
    var rs=rows();
    var buttons=rs.map(deleteButton);
    if(rs.length && buttons.some(function(b){return !b;})) {
      throw new Error('CART_CLEAR_DELETE_NODE_MISSING');
    }
    buttons.filter(Boolean).forEach(function(btn){
      try { btn.click(); } catch(_e) {}
    });
    await sleep(900);
    return {ok:true, requested:buttons.filter(Boolean).length, initial_count:rs.length};
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
    version:'047',
    snapshot:snapshot,
    clearAll:clearAll,
    run:run,
    isEmpty:function(){ return rows().length===0; },
    rows:rows
  };
})(window,document);
