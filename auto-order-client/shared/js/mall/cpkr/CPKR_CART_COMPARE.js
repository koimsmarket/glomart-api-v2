/* CPKR_CART_COMPARE_V001
 * MULTI-order cart reconciliation module.
 * Compare happens from a snapshot. Orchestrator owns about:blank and page transitions.
 */
(function(W,D){
  'use strict';
  if(W.CPKR_CART_COMPARE) return;
  function digits(v){return String(v==null?'':v).replace(/\D/g,'');}
  function num(v,d){var n=Number(String(v==null?'':v).replace(/[^\d.-]/g,''));return isFinite(n)?n:(d||0);}
  function parseUid(v){
    var s=String(v||'').trim().replace(/^CPKR_/i,'');
    var m=s.match(/(\d{6,})[_:\-\/](\d{6,})[_:\-\/](\d{6,})/);
    return m?{puid:[m[1],m[2],m[3]].join('_'),pid:m[1],iid:m[2],vid:m[3]}:{puid:'',pid:'',iid:'',vid:''};
  }
  function orderIdentity(item){
    item=item||{};
    var uids=[item.puid,item.PUID,item.product_uid,item.productUid,item.pi_ii_vi,item.source_uid,item.sourceUid];
    for(var i=0;i<uids.length;i++){var p=parseUid(uids[i]);if(p.pid&&p.vid)return p;}
    var pid=digits(item.product_id||item.productId||item.pid), iid=digits(item.item_id||item.itemId||item.iid), vid=digits(item.vendor_item_id||item.vendorItemId||item.vendor_id||item.vendorId||item.vid);
    return {puid:(pid&&iid&&vid?[pid,iid,vid].join('_'):''),pid:pid,iid:iid,vid:vid};
  }
  function qty(item){var n=num(item&&(item.quantity||item.qty||item.order_qty||item.order_quantity||item.count),1);return n>0?Math.floor(n):1;}
  function rows(){var out=[],seen=new Set();Array.prototype.slice.call(D.querySelectorAll('input.cart-quantity-input')).forEach(function(input){var row=input.closest&&input.closest('div[id^="item_"]');if(row&&!seen.has(row)){seen.add(row);out.push(row);}});return out;}
  function cartIdentity(row){
    var a=row.querySelector('a[href*="/vp/products/"]'), href=a&&(a.getAttribute('href')||a.href)||'',pid='',iid='',vid='';
    var pm=href.match(/\/vp\/products\/(\d+)/i);if(pm)pid=pm[1];
    try{var u=new URL(href,location.href);iid=digits(u.searchParams.get('itemId'));vid=digits(u.searchParams.get('vendorItemId'));}catch(_e){var vm=href.match(/[?&]vendorItemId=(\d+)/i);if(vm)vid=vm[1];}
    return {puid:(pid&&iid&&vid?[pid,iid,vid].join('_'):''),pid:pid,iid:iid,vid:vid};
  }
  function snapshot(){return rows().map(function(row,i){var id=cartIdentity(row),input=row.querySelector('input.cart-quantity-input');return {index:i,row_id:row.id||'',pid:id.pid,iid:id.iid,vid:id.vid,puid:id.puid,quantity:Math.floor(num(input&&input.value,1))};});}
  function same(a,b){if(a.puid&&b.puid&&a.puid===b.puid)return true;return !!(a.pid&&a.vid&&b.pid&&b.vid&&a.pid===b.pid&&a.vid===b.vid);}
  function compare(orderItems,cartSnapshot){
    var targets=(orderItems||[]).map(function(item,index){return {index:index,item:item,id:orderIdentity(item),quantity:qty(item),matched:null};});
    var carts=(cartSnapshot||[]).map(function(c){return Object.assign({},c,{matched:null});});
    targets.forEach(function(t){var c=carts.find(function(x){return !x.matched&&same(t.id,x);});if(c){t.matched=c;c.matched=t;}});
    var missing=targets.filter(function(t){return !t.matched;}).map(function(t){return {index:t.index,item:t.item,pid:t.id.pid,vid:t.id.vid,quantity:t.quantity};});
    var extra=carts.filter(function(c){return !c.matched;});
    var qtyMismatch=targets.filter(function(t){return t.matched&&Number(t.matched.quantity)!==Number(t.quantity);}).map(function(t){return {index:t.index,row_id:t.matched.row_id,pid:t.id.pid,vid:t.id.vid,expected:t.quantity,actual:t.matched.quantity};});
    return {ok:missing.length===0&&extra.length===0&&qtyMismatch.length===0,missing:missing,extra:extra,qty_mismatch:qtyMismatch,target_count:targets.length,cart_count:carts.length};
  }
  function nativeValue(input,value){var d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');if(d&&d.set)d.set.call(input,String(value));else input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));try{input.blur();}catch(_e){}}
  function findRowByIdentity(id){return rows().find(function(row){return same(id,cartIdentity(row));})||null;}
  function deleteButton(row){return Array.prototype.slice.call(row.querySelectorAll('button,a,[role="button"],div,span')).find(function(el){return String(el.textContent||'').trim()==='삭제';})||null;}
  async function applyPlan(plan){
    plan=plan||{};
    /* Plan was computed off-page by orchestrator. Re-find only predetermined target rows. */
    (plan.qty_mismatch||[]).forEach(function(q){var row=findRowByIdentity(q);var input=row&&row.querySelector('input.cart-quantity-input');if(!input)throw new Error('CART_QTY_NODE_NOT_FOUND');nativeValue(input,q.expected);});
    (plan.extra||[]).forEach(function(x){var row=findRowByIdentity(x);var b=row&&deleteButton(row);if(!b)throw new Error('CART_DELETE_NODE_NOT_FOUND');b.click();});
    return {ok:true,missing:(plan.missing||[])};
  }
  function selectAllAndCheckout(){
    var all=Array.prototype.slice.call(D.querySelectorAll('input[type="checkbox"]'));
    var cb=all.find(function(x){var host=x.closest('label,div,span');return host&&/전체\s*선택/.test(String(host.textContent||''));});
    if(cb&&!cb.checked)cb.click();
    var go=D.querySelector('a.goPayment[data-pay-role="button"],a.goPayment,[data-pay-role="button"]');
    if(!go)throw new Error('CART_GO_PAYMENT_NOT_FOUND');
    go.click(); return {ok:true};
  }
  W.CPKR_CART_COMPARE={version:'001',snapshot:snapshot,compare:compare,applyPlan:applyPlan,selectAllAndCheckout:selectAllAndCheckout};
})(window,document);
