/* CPKR_CART_V074
 * Authoritative Coupang CART module.
 * Owns: header count, one-shot initial clean, snapshot, detached compare,
 * one correction pass, select-all checkout. No automatic self-run.
 */
(function(W,D){
  'use strict';
  if(W.CPKR_CART && W.CPKR_CART.version==='074') return;
  function digits(v){return String(v==null?'':v).replace(/\D/g,'');}
  function num(v,d){var n=Number(String(v==null?'':v).replace(/[^\d.-]/g,''));return isFinite(n)?n:(d||0);}
  function text(el){return String(el&&el.textContent||'').replace(/\s+/g,' ').trim();}
  function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
  function parseUid(v){var s=String(v||'').trim().replace(/^CPKR_/i,''),m=s.match(/(\d{5,})[_:\-\/](\d{5,})[_:\-\/](\d{5,})/);return m?{puid:[m[1],m[2],m[3]].join('_'),pid:m[1],iid:m[2],vid:m[3]}:{puid:'',pid:'',iid:'',vid:''};}
  function orderIdentity(item){item=item||{};var keys=[item.puid,item.PUID,item.product_uid,item.productUid,item.pi_ii_vi,item.source_uid,item.sourceUid];for(var i=0;i<keys.length;i++){var p=parseUid(keys[i]);if(p.pid&&p.vid)return p;}var pid=digits(item.product_id||item.productId||item.pid),iid=digits(item.item_id||item.itemId||item.iid),vid=digits(item.vendor_item_id||item.vendorItemId||item.vendor_id||item.vendorId||item.vid);return {puid:(pid&&iid&&vid?[pid,iid,vid].join('_'):''),pid:pid,iid:iid,vid:vid};}
  function orderQty(item){var n=num(item&&(item.quantity||item.qty||item.order_qty||item.order_quantity||item.count),1);return n>0?Math.floor(n):1;}
  function headerCount(){var n=D.querySelector('#headerCartCount');if(!n)return null;var raw=String(n.textContent||'').replace(/\D/g,'');return raw===''?null:Number(raw);}
  function rows(){var out=[],seen=new Set();Array.from(D.querySelectorAll('input.cart-quantity-input')).forEach(function(input){var row=input.closest&&input.closest('div[id^="item_"]');if(row&&!seen.has(row)&&row.querySelector('a[href*="/vp/products/"]')){seen.add(row);out.push(row);}});return out;}
  function cartIdentity(row){var a=row&&row.querySelector('a[href*="/vp/products/"]'),href=a&&(a.getAttribute('href')||a.href)||'',pid='',iid='',vid='';var m=href.match(/\/vp\/products\/(\d+)/i);if(m)pid=m[1];try{var u=new URL(href,location.href);iid=digits(u.searchParams.get('itemId'));vid=digits(u.searchParams.get('vendorItemId'));}catch(_e){}return {puid:(pid&&iid&&vid?[pid,iid,vid].join('_'):''),pid:pid,iid:iid,vid:vid};}
  function snapshot(){return rows().map(function(row,index){var id=cartIdentity(row),q=row.querySelector('input.cart-quantity-input');return {index:index,row_id:row.id||'',pid:id.pid,iid:id.iid,vid:id.vid,puid:id.puid,quantity:Math.max(1,Math.floor(num(q&&q.value,1)))};});}
  function same(a,b){if(a.puid&&b.puid&&a.puid===b.puid)return true;/* User rule: PID+VID match means same item; do NOT delete due IID difference. */return !!(a.pid&&a.vid&&b.pid&&b.vid&&a.pid===b.pid&&a.vid===b.vid);}
  function keyOf(id){return id&&id.pid&&id.vid?id.pid+'|'+id.vid:(id&&id.puid||'');}
  function compare(orderItems,cartSnap){
    var targetMap=new Map(),cartMap=new Map();
    (orderItems||[]).forEach(function(item,index){var id=orderIdentity(item),k=keyOf(id);if(!k)return;var x=targetMap.get(k);if(!x){x={key:k,index:index,item:item,id:id,quantity:0};targetMap.set(k,x);}x.quantity+=orderQty(item);});
    (cartSnap||[]).forEach(function(row){var k=keyOf(row);if(!k)return;var x=cartMap.get(k);if(!x){x={key:k,pid:row.pid,iid:row.iid,vid:row.vid,puid:row.puid,quantity:0,row_ids:[],rows:[]};cartMap.set(k,x);}x.quantity+=Number(row.quantity||0);x.row_ids.push(row.row_id);x.rows.push(row);});
    var missing=[],extra=[],qtyMismatch=[];
    targetMap.forEach(function(t,k){var x=cartMap.get(k);if(!x){var mi=Object.assign({},t.item,{quantity:t.quantity,qty:t.quantity});missing.push({index:t.index,item:mi,pid:t.id.pid,iid:t.id.iid,vid:t.id.vid,puid:t.id.puid,quantity:t.quantity});return;}if(Number(x.quantity)!==Number(t.quantity))qtyMismatch.push({index:t.index,row_id:x.row_ids[0]||'',pid:t.id.pid,iid:t.id.iid,vid:t.id.vid,puid:t.id.puid,expected:t.quantity,actual:x.quantity});});
    cartMap.forEach(function(x,k){if(!targetMap.has(k))extra.push(x);});
    return {ok:missing.length===0&&extra.length===0&&qtyMismatch.length===0,missing:missing,extra:extra,qty_mismatch:qtyMismatch,target_count:targetMap.size,cart_count:cartMap.size};
  }
  function overallCheckbox(){var n=D.querySelector('input[type="checkbox"][title*="모든 상품"],input[type="checkbox"][title*="전체"]');if(n)return n;return Array.from(D.querySelectorAll('input[type="checkbox"]')).find(function(x){var h=x.closest('label,div,span');return h&&/전체\s*선택/.test(text(h));})||null;}
  function selectedDelete(){return Array.from(D.querySelectorAll('button,a,[role="button"],div')).find(function(el){return text(el)==='선택삭제'&&(el.tagName==='BUTTON'||el.tagName==='A'||el.getAttribute('role')==='button'||/pointer/.test((getComputedStyle(el)||{}).cursor||''));})||null;}
  function rowCheckbox(row){return row&&row.querySelector('input[type="checkbox"]');}
  function nativeValue(input,value){var win=input.ownerDocument.defaultView||W,proto=win.HTMLInputElement&&win.HTMLInputElement.prototype,d=proto&&Object.getOwnPropertyDescriptor(proto,'value');if(d&&d.set)d.set.call(input,String(value));else input.value=String(value);input.dispatchEvent(new win.Event('input',{bubbles:true}));input.dispatchEvent(new win.Event('change',{bubbles:true}));try{input.blur();}catch(_e){}}
  function armConfirm(pageWindow){var pw=pageWindow||W,old=pw.confirm,done=false;function restore(){if(done)return;done=true;try{if(pw.confirm===hook)pw.confirm=old;}catch(_e){}}function hook(msg){var t=String(msg||'').replace(/\s+/g,' ').trim();if(/선택한 상품을 삭제하시겠습니까/.test(t)){restore();return true;}return old.call(pw,msg);}try{pw.confirm=hook;}catch(_e){}setTimeout(restore,2500);return restore;}

  async function waitChecked(cb,want,ms){var t=Date.now();while(Date.now()-t<(ms||2500)){if(!!cb.checked===!!want)return true;await sleep(80);}return false;}

  async function clearAll(pageWindow){
    var rs=rows();
    if(!rs.length)return {ok:true,skipped:true,count:0};

    var all=overallCheckbox();
    if(!all)throw new Error('CART_SELECT_ALL_NOT_FOUND');
    if(!all.checked){
      all.click();
      if(!(await waitChecked(all,true,2500)))throw new Error('CART_SELECT_ALL_NOT_APPLIED');
    }

    var del=selectedDelete();
    if(!del)throw new Error('CART_SELECTED_DELETE_NOT_FOUND');
    var restore=armConfirm(pageWindow);
    del.click();

    await sleep(2300);
    restore();

    var remain=snapshot();
    if(remain.length!==0)throw new Error('CART_CLEAR_NOT_EMPTY:'+remain.length);
    return {ok:true,skipped:false,count:rs.length,remaining:0,method:'select-all-selected-delete-one-check'};
  }
  function findRow(id){return rows().find(function(r){return same(id,cartIdentity(r));})||null;}
  function findRows(id){return rows().filter(function(r){return same(id,cartIdentity(r));});}
  function matchingRowsFrom(rs,id){
    return (rs||[]).filter(function(r){return same(id,cartIdentity(r));});
  }
  async function setRowCheckbox(cb,want){
    if(!cb)throw new Error('CART_ROW_CHECKBOX_NOT_FOUND');
    if(!!cb.checked!==!!want){
      cb.click();
      if(!(await waitChecked(cb,want,1800)))throw new Error('CART_ROW_SELECT_NOT_APPLIED');
    }
  }
  async function applyAdjustments(plan,pageWindow){
    plan=plan||{};
    var mismatches=plan.qty_mismatch||[],extras=plan.extra||[];

    /* One initial DOM collection only. */
    var rs=rows();

    /* Never trust prior partial selection state.
       Explicitly turn every row OFF before selecting delete targets. */
    for(var i=0;i<rs.length;i++){
      var cb0=rowCheckbox(rs[i]);
      if(cb0)await setRowCheckbox(cb0,false);
    }

    var deleteRows=[],seenDelete=new Set();

    function addDelete(row){
      if(row&&!seenDelete.has(row)){
        seenDelete.add(row);
        deleteRows.push(row);
      }
    }

    /* Entire extra SKU groups are deleted. */
    extras.forEach(function(x){
      matchingRowsFrom(rs,x).forEach(addDelete);
    });

    /* For a quantity mismatch, keep one canonical PID+VID row
       and delete duplicate rendered rows in the same selected-delete. */
    mismatches.forEach(function(q){
      var matched=matchingRowsFrom(rs,q);
      for(var d=1;d<matched.length;d++)addDelete(matched[d]);
    });

    if(deleteRows.length){
      for(var d2=0;d2<deleteRows.length;d2++){
        var cb=rowCheckbox(deleteRows[d2]);
        await setRowCheckbox(cb,true);
      }

      var del=selectedDelete();
      if(!del)throw new Error('CART_SELECTED_DELETE_NOT_FOUND');
      var restore=armConfirm(pageWindow);
      del.click();

      /* No repeated rows() polling. One fixed settle, then one re-collection. */
      await sleep(2300);
      restore();
    }

    /* Second and final row collection for this correction pass. */
    var afterRows=rows();

    for(var qn=0;qn<mismatches.length;qn++){
      var q=mismatches[qn],matchedAfter=matchingRowsFrom(afterRows,q);
      if(!matchedAfter.length)throw new Error('CART_QTY_ROW_NOT_FOUND');
      if(matchedAfter.length!==1)throw new Error('CART_DUPLICATE_ROW_REMAINS');

      var input=matchedAfter[0].querySelector('input.cart-quantity-input');
      if(!input)throw new Error('CART_QTY_INPUT_NOT_FOUND');
      nativeValue(input,q.expected);
    }

    /* Quantity events may persist asynchronously. Fixed settle once,
       then verify only the already captured input nodes; no rows() scan. */
    if(mismatches.length)await sleep(900);

    for(var qv=0;qv<mismatches.length;qv++){
      var q2=mismatches[qv],mr=matchingRowsFrom(afterRows,q2);
      var inp=mr[0]&&mr[0].querySelector('input.cart-quantity-input');
      var actual=Number(String(inp&&inp.value||'').replace(/\D/g,''));
      if(actual!==Number(q2.expected))throw new Error('CART_QTY_APPLY_FAILED');
    }

    return {
      ok:true,
      missing:plan.missing||[],
      qty_changed:mismatches.length,
      extra_deleted_rows:extras.reduce(function(n,x){return n+matchingRowsFrom(rs,x).length;},0),
      extra_deleted_skus:extras.length,
      duplicate_deleted_rows:deleteRows.length
    };
  }
  async function selectAllAndCheckout(options){
    options=options||{};
    var all=overallCheckbox();
    if(!all)throw new Error('CART_SELECT_ALL_NOT_FOUND');
    if(!all.checked){
      all.click();
      if(!(await waitChecked(all,true,2500)))throw new Error('CART_SELECT_ALL_NOT_APPLIED');
    }
    await sleep(250);
    var go=D.querySelector('a.goPayment[data-pay-role="button"],a.goPayment');
    if(!go)throw new Error('CART_GO_PAYMENT_NOT_FOUND');
    if(typeof options.beforeAction==='function')options.beforeAction({action:'CHECKOUT'});
    go.click();
    return {ok:true,clicked:true};
  }
  W.CPKR_CART={version:'074',headerCount:headerCount,snapshot:snapshot,compare:compare,clearAll:clearAll,applyAdjustments:applyAdjustments,selectAllAndCheckout:selectAllAndCheckout,orderIdentity:orderIdentity,orderQty:orderQty,same:same};
})(window,document);
