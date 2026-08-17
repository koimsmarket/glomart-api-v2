/* CPKR_PRODUCT_V066
 * Authoritative Coupang PRODUCT module.
 * One item = one inspect -> optional quantity input -> one action.
 * IMPORTANT: PUID direct URL already selects the SKU. This module NEVER changes option DOM.
 */
(function(W,D){
  'use strict';
  if(W.CPKR_PRODUCT && W.CPKR_PRODUCT.version==='066') return;

  function digits(v){return String(v==null?'':v).replace(/\D/g,'');}
  function text(el){return String(el&&el.textContent||'').replace(/\s+/g,' ').trim();}
  function visible(el){if(!el||!el.getBoundingClientRect)return false;var r=el.getBoundingClientRect();var s;try{s=(el.ownerDocument.defaultView||W).getComputedStyle(el);}catch(_e){}return r.width>0&&r.height>0&&(!s||(s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0'));}
  function disabled(el){return !!(el&&(el.disabled||el.getAttribute('aria-disabled')==='true'||/disabled|soldout|out-of-stock/i.test(String(el.className||''))));}
  function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}

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
    var expected=identity(item),current=fromUrl(location.href),match=!!(expected.pid&&expected.iid&&expected.vid&&current.pid===expected.pid&&current.iid===expected.iid&&current.vid===expected.vid);
    return {ok:match,puid_match:match,expected_puid:puid(expected),current_puid:puid(current),expected:expected,current:current,title:title(),login_required:loginRequired(),quantity:qty(item),url:location.href};
  }
  function exactCartButton(){var b=D.querySelector('button.prod-cart-btn');return b&&visible(b)&&!disabled(b)?b:null;}
  function exactBuyButton(){var b=D.querySelector('button.prod-buy-btn,a.prod-buy-btn');return b&&visible(b)&&!disabled(b)?b:null;}

  async function waitAfterCartClick(beforeCount){
    var start=Date.now(), minWait=900;
    while(Date.now()-start<4000){
      if(blocked())throw new Error('COUPANG_ACCESS_DENIED');
      var body=String(D.body&&D.body.innerText||'');
      if(/서버에서 오류가 발생하였습니다/.test(body))throw new Error('CART_ADD_COUPANG_SERVER_ERROR');
      var n=D.querySelector('#headerCartCount'), now=n?Number(String(n.textContent||'').replace(/\D/g,''))||0:null;
      if(Date.now()-start>=minWait && beforeCount!=null && now!=null && now>beforeCount)return {confirmed:true,method:'header-count',before:beforeCount,after:now};
      if(Date.now()-start>=1400)return {confirmed:false,method:'stability-wait',before:beforeCount,after:now};
      await sleep(120);
    }
    return {confirmed:false,method:'timeout-stability'};
  }
  function armServerAlert(pageWindow){
    var pw=pageWindow||W,old=pw.alert,captured='',done=false;
    function restore(){if(done)return;done=true;try{if(pw.alert===hook)pw.alert=old;}catch(_e){}}
    function hook(msg){captured=String(msg||'');try{return old.call(pw,msg);}finally{}}
    try{pw.alert=hook;}catch(_e){}
    return {restore:restore,message:function(){return captured;}};
  }
  async function run(item,mode,pageWindow){
    mode=String(mode||'MULTI').toUpperCase();
    var check=inspect(item);
    if(check.login_required)throw new Error('LOGIN_REQUIRED');
    if(!check.puid_match)throw new Error('PRODUCT_PUID_MISMATCH expected='+check.expected_puid+' current='+check.current_puid);
    var q=await setQuantity(item);
    /* No second inspect. No option click. No retry. */
    if(mode==='INSPECT_ONLY')return {ok:true,inspection:check,quantity:q,action:'NONE'};
    if(mode==='SINGLE'){
      var buy=exactBuyButton(); if(!buy)throw new Error('BUY_NOW_NODE_NOT_FOUND');
      buy.click(); return {ok:true,inspection:check,quantity:q,action:'BUY_NOW',clicked:true};
    }
    var cart=exactCartButton(); if(!cart)throw new Error('CART_BUTTON_NODE_NOT_FOUND');
    var hc=D.querySelector('#headerCartCount'),beforeCount=hc?(Number(String(hc.textContent||'').replace(/\D/g,''))||0):null,alarm=armServerAlert(pageWindow);
    try{cart.click();var settled=await waitAfterCartClick(beforeCount);var am=alarm.message();if(/서버에서 오류가 발생하였습니다/.test(am))throw new Error('CART_ADD_COUPANG_SERVER_ERROR');return {ok:true,inspection:check,quantity:q,action:'ADD_TO_CART',clicked:true,settled:settled};}finally{alarm.restore();}
  }

  W.CPKR_PRODUCT={version:'066',identity:identity,puid:puid,canonicalUrl:canonicalUrl,inspect:inspect,setQuantity:setQuantity,run:run};
})(window,document);
