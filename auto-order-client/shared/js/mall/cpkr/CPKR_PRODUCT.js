/* CPKR_PRODUCT_V075
 * Authoritative Coupang PRODUCT module.
 * One item = one inspect -> optional quantity input -> one action.
 * IMPORTANT: PUID direct URL already selects the SKU. This module NEVER changes option DOM.
 */
(function(W,D){
  'use strict';
  if(W.CPKR_PRODUCT && W.CPKR_PRODUCT.version==='086') return;

  function digits(v){return String(v==null?'':v).replace(/\D/g,'');}
  function text(el){return String(el&&el.textContent||'').replace(/\s+/g,' ').trim();}
  function visible(el){if(!el||!el.getBoundingClientRect)return false;var r=el.getBoundingClientRect();var s;try{s=(el.ownerDocument.defaultView||W).getComputedStyle(el);}catch(_e){}return r.width>0&&r.height>0&&(!s||(s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0'));}
  function disabled(el){return !!(el&&(el.disabled||el.getAttribute('aria-disabled')==='true'||/disabled|soldout|out-of-stock/i.test(String(el.className||''))));}
  function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
  async function waitProductActionReady(mode){
    var started=Date.now(), last=null, stable=0;
    while(Date.now()-started<6000){
      var b=String(mode||'').toUpperCase()==='SINGLE'?exactBuyButton():exactCartButton();
      if(b){
        if(b===last)stable++; else {last=b;stable=1;}
        if(stable>=3){
          /* Keep one quiet gap after the same actionable node is observed
             repeatedly. This replaces the readiness naturally provided by
             the old INSPECTOR -> PREPARER -> PRODUCT_ORDER chain. */
          await sleep(350);
          return b;
        }
      }else{
        last=null; stable=0;
      }
      await sleep(120);
    }
    return null;
  }

  function fromUrl(raw){
    try{var u=new URL(String(raw||''),location.href),m=u.pathname.match(/\/vp\/products\/(\d+)/i);return {pid:m?m[1]:'',iid:digits(u.searchParams.get('itemId')),vid:digits(u.searchParams.get('vendorItemId'))};}
    catch(_e){return {pid:'',iid:'',vid:''};}
  }
  function parseUid(raw){
    var s=String(raw||'').trim().replace(/^CPKR_/i,''),m=s.match(/(\d{5,})[_:\-\/](\d{5,})[_:\-\/](\d{5,})/);
    return m?{pid:m[1],iid:m[2],vid:m[3]}:{pid:'',iid:'',vid:''};
  }
  function identity(item){
    item=item||{};
    var keys=[item.puid,item.PUID,item.product_uid,item.productUid,item.pi_ii_vi,item.source_uid,item.sourceUid];
    for(var i=0;i<keys.length;i++){var x=parseUid(keys[i]);if(x.pid&&x.iid&&x.vid)return x;}
    var pid=digits(item.product_id||item.productId||item.pid),iid=digits(item.item_id||item.itemId||item.iid),vid=digits(item.vendor_item_id||item.vendorItemId||item.vendor_id||item.vendorId||item.vid);
    if(pid&&iid&&vid)return {pid:pid,iid:iid,vid:vid};
    var urls=[item.product_url,item.productUrl,item.mall_product_url,item.external_product_url,item.source_url,item.url];
    for(var j=0;j<urls.length;j++){var u=fromUrl(urls[j]);if(u.pid&&u.iid&&u.vid)return u;}
    return {pid:'',iid:'',vid:''};
  }
  function puid(id){return id&&id.pid&&id.iid&&id.vid?[id.pid,id.iid,id.vid].join('_'):'';}
  function canonicalUrl(item){var id=identity(item);return puid(id)?'https://www.coupang.com/vp/products/'+id.pid+'?itemId='+id.iid+'&vendorItemId='+id.vid:'';}
  function qty(item){var n=Number(item&&(item.quantity??item.qty??item.order_qty??item.order_quantity??item.count) || 1);return isFinite(n)&&n>0?Math.floor(n):1;}
  function title(){var n=D.querySelector('h1.prod-buy-header__title,.prod-buy-header__title,h1[class*="title"]');return text(n);}
  function loginRequired(){var out=Array.from(D.querySelectorAll('a')).some(function(a){return visible(a)&&text(a)==='로그인';});var inn=Array.from(D.querySelectorAll('a')).some(function(a){return visible(a)&&text(a)==='로그아웃';});return !inn&&out;}
  function blocked(){var t=(D.title||'')+' '+text(D.body).slice(0,5000);return /Access Denied|You don't have permission to access|errors\.edgesuite\.net/i.test(t);}

  function quantityInput(){
    var selectors=['input.prod-quantity__input','input[name="quantity"]'];
    for(var i=0;i<selectors.length;i++){var nodes=D.querySelectorAll(selectors[i]);for(var j=0;j<nodes.length;j++){if(visible(nodes[j])&&!disabled(nodes[j]))return nodes[j];}}
    return null;
  }
  function nativeValue(input,value){
    var win=input.ownerDocument.defaultView||W,proto=win.HTMLInputElement&&win.HTMLInputElement.prototype,desc=proto&&Object.getOwnPropertyDescriptor(proto,'value');
    if(desc&&desc.set)desc.set.call(input,String(value));else input.value=String(value);
    input.dispatchEvent(new win.Event('input',{bubbles:true}));
    input.dispatchEvent(new win.Event('change',{bubbles:true}));
    try{input.blur();}catch(_e){}
  }
  async function setQuantity(item){
    var expected=qty(item),input=quantityInput();
    if(!input){if(expected===1)return {ok:true,found:false,before:1,after:1,changed:false};throw new Error('PRODUCT_QTY_INPUT_NOT_FOUND');}
    var before=Number(String(input.value||'').replace(/\D/g,''))||1;
    if(before===expected)return {ok:true,found:true,before:before,after:before,changed:false};
    nativeValue(input,expected); await sleep(220);
    var after=Number(String(input.value||'').replace(/\D/g,''))||0;
    if(after!==expected)throw new Error('PRODUCT_QTY_SET_FAILED:'+before+'>'+after+' expected='+expected);
    return {ok:true,found:true,before:before,after:after,changed:true};
  }
  function inspect(item){
    if(blocked())throw new Error('COUPANG_ACCESS_DENIED');
    if(!/\/vp\/products\//.test(location.pathname))throw new Error('NOT_PRODUCT_PAGE');
    var expected=identity(item),current=fromUrl(location.href);
    /* V085 identity contract: Coupang itemId(IID) can change while the same
       sellable option keeps the same PID+VID. Treat PID+VID as authoritative.
       IID is diagnostic/current-route data only and must never cause a re-open. */
    var match=!!(expected.pid&&expected.vid&&current.pid===expected.pid&&current.vid===expected.vid);
    var iidChanged=!!(match&&expected.iid&&current.iid&&expected.iid!==current.iid);
    return {ok:match,puid_match:match,pid_vid_match:match,iid_changed:iidChanged,expected_puid:puid(expected),current_puid:puid(current),expected:expected,current:current,title:title(),login_required:loginRequired(),quantity:qty(item),url:location.href};
  }
  function exactCartButton(){
    return Array.from(D.querySelectorAll('button.prod-cart-btn,a.prod-cart-btn'))
      .find(function(el){return visible(el)&&!disabled(el);})||null;
  }
  function exactBuyButton(){
    var nodes=Array.from(D.querySelectorAll('button.prod-buy-btn,a.prod-buy-btn'));
    return nodes.find(function(el){
      if(!visible(el)||disabled(el))return false;
      return /^바로\s*구매$/.test(text(el));
    })||null;
  }

  async function settleAfterCartClick(){
    /* No repeated DOM/header/body inspection.
       Final CART snapshot is the authoritative success verification. */
    var waitMs=1200;
    await sleep(waitMs);
    return {accepted:true,method:'fixed-settle',wait_ms:waitMs};
  }
  function armServerAlert(pageWindow){
    var pw=pageWindow||W,old=pw.alert,captured='',done=false;

    function restore(){
      if(done)return;
      done=true;
      try{if(pw.alert===hook)pw.alert=old;}catch(_e){}
    }

    function hook(msg){
      var text=String(msg||'');
      if(/서버에서 오류가 발생하였습니다/.test(text)){
        captured=text;
        return;
      }
      return old.call(pw,msg);
    }

    try{pw.alert=hook;}catch(_e){}
    return {restore:restore,message:function(){return captured;}};
  }
  async function prepare(item,mode){
    mode=String(mode||'MULTI').toUpperCase();

    var check=inspect(item);
    if(check.login_required)throw new Error('LOGIN_REQUIRED');
    if(!check.puid_match){
      throw new Error(
        'PRODUCT_PUID_MISMATCH expected='+check.expected_puid+
        ' current='+check.current_puid
      );
    }

    var q=await setQuantity(item);

    /* Preparation owns inspection/quantity/readiness only.
       It never changes Runner stage and never clicks an order button. */
    if(mode==='SINGLE'){
      var buy=await waitProductActionReady('SINGLE');
      if(!buy)throw new Error('BUY_NOW_NODE_NOT_FOUND');
      return {
        ok:true,
        mode:'SINGLE',
        _target:buy,
        inspection:check,
        quantity:q,
        action:'BUY_NOW',
        ready:true,
        target:{
          tag:String(buy.tagName||''),
          text:text(buy),
          href:String(buy.href||(buy.getAttribute&&buy.getAttribute('href'))||''),
          class_name:String(buy.className||'')
        }
      };
    }

    if(mode==='MULTI'){
      var cart=await waitProductActionReady('MULTI');
      if(!cart){
        /* Soldier contract: absence is a report, not a process-killing error.
           Runner decides whether to verify CART, retry once, or fail the order. */
        return {
          ok:true,
          mode:'MULTI',
          _target:null,
          inspection:check,
          quantity:q,
          action:'ADD_TO_CART',
          ready:false,
          found:false,
          reason:'CART_BUTTON_NOT_FOUND'
        };
      }
      return {
        ok:true,
        mode:'MULTI',
        _target:cart,
        inspection:check,
        quantity:q,
        action:'ADD_TO_CART',
        ready:true,
        found:true
      };
    }

    return {
      ok:true,
      mode:mode,
      inspection:check,
      quantity:q,
      action:'NONE',
      ready:true
    };
  }

  function buyNow(prepared){
    prepared=prepared||{};
    if(String(prepared.mode||'').toUpperCase()!=='SINGLE'){
      throw new Error('PRODUCT_SINGLE_NOT_PREPARED');
    }
    var buy=prepared._target||null;
    if(!buy||!visible(buy)||disabled(buy))throw new Error('BUY_NOW_TARGET_STALE');

    var meta={
      tag:String(buy.tagName||''),
      text:text(buy),
      href:String(buy.href||(buy.getAttribute&&buy.getAttribute('href'))||''),
      class_name:String(buy.className||'')
    };

    buy.click();
    return {
      ok:true,
      clicked:true,
      action:'BUY_NOW',
      inspection:prepared.inspection,
      quantity:prepared.quantity,
      buy_target:meta
    };
  }

  async function addToCart(prepared,pageWindow){
    prepared=prepared||{};
    if(String(prepared.mode||'').toUpperCase()!=='MULTI'){
      throw new Error('PRODUCT_MULTI_NOT_PREPARED');
    }
    var cart=prepared._target||null;
    if(!cart||!visible(cart)||disabled(cart))throw new Error('CART_BUTTON_TARGET_STALE');

    var alarm=armServerAlert(pageWindow);
    try{
      cart.click();
      var settled=await settleAfterCartClick();
      var am=alarm.message();
      var uncertain=/서버에서 오류가 발생하였습니다/.test(am);

      return {
        ok:true,
        clicked:true,
        action:'ADD_TO_CART',
        inspection:prepared.inspection,
        quantity:prepared.quantity,
        settled:settled,
        uncertain:uncertain,
        alert_message:uncertain?am:''
      };
    }finally{
      alarm.restore();
    }
  }

  /* Compatibility wrapper only.
     The current Runner does NOT use callbacks or this wrapper for stage changes. */
  async function run(item,mode,pageWindow){
    var prepared=await prepare(item,mode);
    mode=String(mode||'MULTI').toUpperCase();
    if(mode==='SINGLE')return buyNow(prepared);
    if(mode==='MULTI')return addToCart(prepared,pageWindow);
    return prepared;
  }

  W.CPKR_PRODUCT={version:'086',identity:identity,puid:puid,canonicalUrl:canonicalUrl,inspect:inspect,setQuantity:setQuantity,prepare:prepare,buyNow:buyNow,addToCart:addToCart,run:run};
})(window,document);
