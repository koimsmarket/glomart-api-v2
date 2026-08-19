// ==UserScript==
// @name         Glomart Auto Order PC Runner
// @namespace    https://koims.market/auto-order
// @version      0.088
// @description  Thin orchestrator: stage routing only. Product/cart DOM work lives in CPKR_PRODUCT/CPKR_CART; existing checkout/auth flow is preserved.
// @match        https://www.coupang.com/*
// @match        https://cart.coupang.com/*
// @match        https://checkout.coupang.com/*
// @match        https://login.coupang.com/*
// @match        https://id.coupang.com/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @connect      port-0-glomart-api-v2-mordwrnh222b6c36.sel3.cloudtype.app
// ==/UserScript==
(function(){
'use strict';

/* V085: Coupang occasionally raises a native alert while PRODUCT is still
   loading because one of its auxiliary next-api calls returns 403. The
   product/SKU itself can remain fully usable. A native alert blocks every
   page script, including the PRODUCT soldier, so suppress only this exact
   transient server-error dialog as early as document-start. Other dialogs
   keep Coupang's native behavior. */
(function installCoupangTransientServerAlertBypass(){
  let pw;
  try{pw=(typeof unsafeWindow!=='undefined'&&unsafeWindow)?unsafeWindow:window;}catch(_e){pw=window;}
  let nativeAlert;
  try{nativeAlert=pw.alert;}catch(_e){nativeAlert=null;}
  if(typeof nativeAlert!=='function')return;
  if(nativeAlert.__gmaoV085TransientServerAlertBypass)return;

  function alertHook(message){
    const msg=String(message==null?'':message).replace(/\s+/g,' ').trim();
    if(/^서버에서 오류가 발생하였습니다\.?$/.test(msg)){
      try{console.info('[GMAO V085] Coupang transient server alert suppressed:',msg);}catch(_e){}
      return;
    }
    return nativeAlert.apply(this,arguments);
  }
  try{Object.defineProperty(alertHook,'__gmaoV085TransientServerAlertBypass',{value:true});}catch(_e){}
  try{pw.alert=alertHook;}catch(_e){}
})();
const VERSION='0.088';
const API='https://port-0-glomart-api-v2-mordwrnh222b6c36.sel3.cloudtype.app';
const URLS={
 product:API+'/auto-order-client/shared/js/mall/cpkr/CPKR_PRODUCT.js?v=086',
 cart:API+'/auto-order-client/shared/js/mall/cpkr/CPKR_CART.js?v=086',
 checkout:API+'/auto-order-client/shared/js/mall/cpkr/CPKR_CHECKOUT.js?v=029',
 util:API+'/auto-order-client/shared/js/GM_AUTO_ORDER_UTIL.js?v=013'
};
const STORE={
 job:'gmao_runner_job_v013',
 flow:'gmao_cpkr_flow_stable_v1',
 batch:'gmao_cpkr_batch_session_stable_v1',
 client:'gmao_runner_client_id_v013',
 bridge:'gmao_cpkr_address_bridge_v033',
 nav:'gmao_nav_once_v085'
};
const LEGACY_JOB_KEYS=['gmao_runner_job_v062'];
const LEGACY_FLOW_KEYS=['gmao_cpkr_flow_v066','gmao_cpkr_flow_v062'];
const LEGACY_BATCH_KEYS=['gmao_cpkr_batch_v066','gmao_cpkr_batch_v062'];
const ST={BATCH_SCAN:'BATCH_SCAN',BATCH_CLEAR:'BATCH_CLEAR',ORDER_START:'ORDER_START',SINGLE:'SINGLE',MULTI_PRODUCT:'MULTI_PRODUCT',MULTI_PRODUCT_PENDING:'MULTI_PRODUCT_PENDING',MULTI_SNAPSHOT:'MULTI_SNAPSHOT',MULTI_COMPARE:'MULTI_COMPARE',MULTI_ADJUST:'MULTI_ADJUST',MULTI_REPAIR:'MULTI_REPAIR',MULTI_FINAL_SNAPSHOT:'MULTI_FINAL_SNAPSHOT',MULTI_CHECKOUT:'MULTI_CHECKOUT',CHECKOUT_PENDING:'CHECKOUT_PENDING',CHECKOUT:'CHECKOUT',STOPPED:'STOPPED',FAILED:'FAILED',BLOCKED:'BLOCKED'};
const STALE=new Set(['work_not_found','work_lock_invalid','work_lock_invalid_or_expired','work_not_running','work_cancelled_by_customer']);
function restoreLocalJob(){
  // V062 briefly used a versioned job key. Prefer that key once during
  // migration because it may hold the currently RUNNING server lock.
  let j=GM_getValue(STORE.job,null);
  if(!(j&&j.work_id&&j.lock_token)){
    j=null;
    for(const key of LEGACY_JOB_KEYS){const legacy=GM_getValue(key,null);if(legacy&&legacy.work_id&&legacy.lock_token){j=legacy;break;}}
  }
  if(j&&j.work_id&&j.lock_token){
    GM_setValue(STORE.job,j);
    return j;
  }
  return null;
}
let job=restoreLocalJob(),workTimer=null,clientTimer=null,busy=false;

function validStageName(x){
  return !!x&&Object.values(ST).includes(String(x));
}
function migrateFlow(){
  let cur=GM_getValue(STORE.flow,null);
  if(cur&&(!job||String(cur.work_id||'')===String(job.work_id||''))&&validStageName(cur.stage))return cur;
  if(job){
    for(const key of LEGACY_FLOW_KEYS){
      const x=GM_getValue(key,null);
      if(x&&String(x.work_id||'')===String(job.work_id||'')&&validStageName(x.stage)){
        GM_setValue(STORE.flow,x);
        return x;
      }
    }
  }
  return {};
}
function migrateBatch(){
  let cur=GM_getValue(STORE.batch,null);
  if(cur)return cur;
  for(const key of LEGACY_BATCH_KEYS){
    const x=GM_getValue(key,null);
    if(x){
      GM_setValue(STORE.batch,x);
      return x;
    }
  }
  return {};
}
function flow(){return GM_getValue(STORE.flow,null)||migrateFlow()||{};}
function setFlow(p){let n=Object.assign({},flow(),p||{},{updated_at:Date.now()});GM_setValue(STORE.flow,n);return n;}
function batch(){return GM_getValue(STORE.batch,null)||migrateBatch()||{};}
function setBatch(p){let n=Object.assign({},batch(),p||{},{updated_at:Date.now()});GM_setValue(STORE.batch,n);return n;}
migrateFlow();
migrateBatch();
function payload(j){return j&&(j.payload||j)||{};}function rawItems(j){
  let a=payload(j).items;
  return Array.isArray(a)?a.filter(Boolean):[];
}
function runnerUid(item){
  item=item||{};
  let vals=[
    item.puid,item.PUID,item.product_uid,item.productUid,
    item.pi_ii_vi,item.source_uid,item.sourceUid
  ];
  for(let v of vals){
    let m=String(v||'').match(/(\d+)_(\d+)_(\d+)/);
    if(m)return {pid:m[1],iid:m[2],vid:m[3],key:m[1]+'|'+m[3]};
  }
  let pid=String(item.product_id||item.productId||item.pid||'').replace(/\D/g,'');
  let iid=String(item.item_id||item.itemId||item.iid||'').replace(/\D/g,'');
  let vid=String(item.vendor_item_id||item.vendorItemId||item.vendor_id||item.vendorId||item.vid||'').replace(/\D/g,'');
  return {pid:pid,iid:iid,vid:vid,key:(pid&&vid?pid+'|'+vid:'')};
}
function runnerQty(item){
  let n=Number(item&&(item.quantity||item.qty||item.order_qty||item.order_quantity||item.count)||1);
  return Number.isFinite(n)&&n>0?Math.floor(n):1;
}
function items(j){
  let src=rawItems(j), map=new Map(), order=[];
  src.forEach((item,index)=>{
    let id=runnerUid(item);
    let key=id.key||('ROW|'+index);
    let found=map.get(key);
    if(!found){
      found=Object.assign({},item);
      found.quantity=0;
      found.qty=0;
      found.__gmao_source_indexes=[];
      map.set(key,found);
      order.push(found);
    }
    let q=runnerQty(item);
    found.quantity+=q;
    found.qty=found.quantity;
    found.__gmao_source_indexes.push(index);
  });
  return order;
}function page(){if(document.body&&document.body.dataset&&document.body.dataset.gmaoDetached==='1')return 'DETACHED';if(location.hostname==='cart.coupang.com')return'CART';if(location.hostname==='checkout.coupang.com')return'CHECKOUT';if(location.hostname==='login.coupang.com')return'AUTH';if(location.hostname==='id.coupang.com')return'ADDRESS';if(/\/vp\/products\//.test(location.pathname))return'PRODUCT';return'COUPANG';}
function uuid(){return crypto&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);}function clientId(){let x=GM_getValue(STORE.client,'');if(!x){x='PC-RUNNER-'+uuid();GM_setValue(STORE.client,x);}return x;}
function blocked(){let t=(document.title||'')+' '+String(document.body&&document.body.innerText||'').slice(0,6000);return /Access Denied|You don't have permission to access|errors\.edgesuite\.net/i.test(t);}
function settings(extra){return Object.assign({client_id:clientId(),client_type:'PC_RUNNER',admin_id:GM_getValue('gmao_admin_id','derzon'),mall_account_id:GM_getValue('gmao_mall_account_id','CPKR_MASTER'),mall_code:'CPKR',cpkr_ready:true,app_version:VERSION,current_url:location.href,page_type:page(),current_work_id:job?job.work_id:null,state:{stage:flow().stage||'',page_type:page()},device:{platform:'tampermonkey',userAgent:navigator.userAgent}},extra||{});}
function req(path,method,body){return new Promise((ok,bad)=>GM_xmlhttpRequest({method:method||'GET',url:API+path,headers:{'Content-Type':'application/json'},data:body?JSON.stringify(body):undefined,timeout:15000,onload:r=>{let x={};try{x=r.responseText?JSON.parse(r.responseText):{};}catch(_e){bad(new Error('NON_JSON_'+r.status));return;}if(r.status<200||r.status>=300||x.ok===false){bad(new Error(x.detail||x.error||'HTTP_'+r.status));return;}ok(x);},onerror:()=>bad(new Error('NETWORK_ERROR')),ontimeout:()=>bad(new Error('REQUEST_TIMEOUT'))}));}
const loaded=new Map();function load(url,ready,label){if(ready())return Promise.resolve();if(loaded.has(url))return loaded.get(url);let p=new Promise((ok,bad)=>GM_xmlhttpRequest({method:'GET',url:url,timeout:12000,onload:r=>{try{new Function('window','document',r.responseText+'\n//# sourceURL='+url)(window,document);}catch(e){bad(new Error(label+'_EXEC:'+e.message));return;}ready()?ok():bad(new Error(label+'_NOT_READY'));},onerror:()=>bad(new Error(label+'_LOAD_ERROR')),ontimeout:()=>bad(new Error(label+'_TIMEOUT'))}));loaded.set(url,p);p.catch(()=>loaded.delete(url));return p;}
function loadProduct(){return load(URLS.product,()=>!!(window.CPKR_PRODUCT&&window.CPKR_PRODUCT.version==='086'&&typeof window.CPKR_PRODUCT.prepare==='function'&&typeof window.CPKR_PRODUCT.buyNow==='function'&&typeof window.CPKR_PRODUCT.addToCart==='function'),'PRODUCT');}function loadCart(){return load(URLS.cart,()=>!!(window.CPKR_CART&&window.CPKR_CART.version==='086'&&typeof window.CPKR_CART.headerCount==='function'&&typeof window.CPKR_CART.snapshot==='function'&&typeof window.CPKR_CART.clearAll==='function'&&typeof window.CPKR_CART.compare==='function'&&typeof window.CPKR_CART.applyAdjustments==='function'&&typeof window.CPKR_CART.prepareCheckout==='function'&&typeof window.CPKR_CART.checkout==='function'),'CART');}async function loadCheckout(){await load(URLS.util,()=>!!window.GMAO_UTIL,'UTIL');return load(URLS.checkout,()=>!!(window.CPKR_CHECKOUT&&typeof window.CPKR_CHECKOUT.inspectAddress==='function'&&typeof window.CPKR_CHECKOUT.fillAndStop==='function'&&typeof window.CPKR_CHECKOUT.fillAddressOnly==='function'),'CHECKOUT');}
function markNav(){GM_setValue(STORE.nav,{work_id:job&&job.work_id,at:Date.now()});}
function takeNav(){let n=GM_getValue(STORE.nav,null);GM_setValue(STORE.nav,null);return !!(n&&job&&String(n.work_id||'')===String(job.work_id||'')&&Date.now()-Number(n.at||0)<20000);}
function wipeAndGo(url,label){
  if(!url)throw new Error('NEXT_URL_MISSING');
  markNav();

  /* Stop the old Coupang document/network, but never rewrite document.
     The next URL is entered once, after a short quiet gap. */
  try{window.stop();}catch(_e){}

  try{
    if(document.body){
      document.body.setAttribute('data-gmao-transition','1');
    }
  }catch(_e){}

  setTimeout(()=>location.replace(url),450);
}

function detachForCompare(reason){
  /* Preserve the Tampermonkey execution context.
     Stop the current Coupang document/network, remove live Coupang DOM with
     ordinary node operations, then compare only serialized GM state/snapshot. */
  try{window.stop();}catch(_e){}

  try{
    let root=document.documentElement;
    if(root){
      while(root.firstChild)root.removeChild(root.firstChild);

      let head=document.createElement('head');
      let title=document.createElement('title');
      title.textContent='Glomart Detached';
      head.appendChild(title);

      let body=document.createElement('body');
      body.setAttribute('data-gmao-detached','1');

      root.appendChild(head);
      root.appendChild(body);
    }
  }catch(_e){
    try{
      if(document.body){
        while(document.body.firstChild)document.body.removeChild(document.body.firstChild);
        document.body.setAttribute('data-gmao-detached','1');
      }
    }catch(__e){}
  }

  render(
    '쿠팡 문서/네트워크 분리 완료 · 저장 snapshot만 비교\n'+
    String(reason||'')
  );
  setTimeout(()=>orchestrate().catch(fail),120);
}
let cartSettleMemo={href:'',tags:new Set()};
async function settleCartStage(tag,ms){
  if(page()!=='CART')return;

  let href=location.href;
  if(cartSettleMemo.href!==href){
    cartSettleMemo={href:href,tags:new Set()};
  }

  let key=String(tag||flow().stage||'CART');
  if(cartSettleMemo.tags.has(key))return;

  render('쿠팡 장바구니 렌더링 안정 대기 · '+key);
  await new Promise(r=>setTimeout(r,ms||1050));
  cartSettleMemo.tags.add(key);
}
function cartUrl(){return'https://cart.coupang.com/cartView.pang';}
function panel(){let p=document.getElementById('gmao-runner-v075');if(p)return p;p=document.createElement('div');p.id='gmao-runner-v075';p.style.cssText='position:fixed;right:12px;bottom:12px;z-index:2147483647;width:300px;background:#111827;color:#d1fae5;border:1px solid #334155;border-radius:10px;padding:10px;font:12px/1.45 Arial,sans-serif;box-shadow:0 4px 18px #0005';document.documentElement.appendChild(p);return p;}
function button(t,fn,danger){let b=document.createElement('button');b.textContent=t;b.style.cssText='border:0;border-radius:5px;padding:7px 9px;margin:6px 4px 0 0;color:#fff;font-weight:700;background:'+(danger?'#c9382b':'#1463d6');b.onclick=fn;return b;}
function resumeCurrentStageExplicit(){
  if(blocked()){render('쿠팡 접근 차단이 아직 감지됩니다.\n재시작하지 않습니다.',true);return;}
  setBatch({cart_cleaned:false,needs_clean:true});
  setFlow({stage:ST.BATCH_SCAN,item_index:0,repair_index:0,cart_snapshot:null,cart_plan:null,final_verify:false,failure_reason:null,blocked_from_stage:null});
  render('처음부터 재시작 · 기존 장바구니 확인/청소부터 시작');
  orchestrate().catch(fail);
}
function render(msg,err){let p=panel(),f=flow();p.innerHTML='<b>Glomart Runner V088</b><div style="margin-top:5px;white-space:pre-wrap;color:'+(err?'#fecaca':'#d1fae5')+'">'+String(msg||'')+'</div><div style="margin-top:5px;color:#93c5fd">단계='+String(f.stage||'-')+' · PAGE='+page()+'</div>';if(!job)p.appendChild(button('작업 가져오기',()=>claim().catch(fail)));if(job)p.appendChild(button('처음부터 재시작',()=>resumeCurrentStageExplicit()));if(job)p.appendChild(button('작업 반환',()=>release().catch(fail),true));}
function clearLocal(){
  job=null;
  GM_setValue(STORE.job,null);
  for(const key of LEGACY_JOB_KEYS)GM_setValue(key,null);
  GM_setValue(STORE.flow,null);
  GM_setValue(STORE.nav,null);
  clearInterval(workTimer);
  workTimer=null;
}
function errCode(e){return String(e&&e.message||e||'').trim();}
function text(el){return String(el&&((el.innerText!=null?el.innerText:el.textContent)||'')||'').replace(/\s+/g,' ').trim();}
async function beginLogin(){
  await guard();
  setBatch({cart_cleaned:false,needs_clean:true,last_login_required_at:Date.now()});
  setFlow({stage:ST.BATCH_SCAN,item_index:0,repair_index:0,cart_snapshot:null,cart_plan:null,final_verify:false,last_error:null});
  GM_setValue('gmao_runner_auth_status_v023',null);
  let a=Array.from(document.querySelectorAll('a[href]')).find(x=>/login\.coupang\.com/i.test(String(x.href||''))&&/^로그인$/.test(text(x)));
  let u=a&&a.href||'https://login.coupang.com/login/login.pang';
  render('쿠팡 로그아웃 감지 · 등록된 회사계정으로 자동 로그인\n성공 후 장바구니 확인/청소부터 다시 시작');
  markNav();try{window.stop();}catch(_e){}setTimeout(()=>location.replace(u),250);
}
async function fail(e){
  const code=errCode(e);
  const st=flow().stage||'';

  if(STALE.has(code)){
    clearLocal();
    render('서버에서 현재 작업이 종료된 것을 확인했습니다.\n'+code+'\n로컬 작업만 정리했습니다.',true);
    return;
  }

  if(/^LOGIN_REQUIRED(?:$|[:_\s])/i.test(code)){try{await beginLogin();}catch(x){render('쿠팡 자동 로그인 시작 실패\n'+errCode(x),true);}return;}

  if(/COUPANG_ACCESS_DENIED/.test(code)||blocked()){
    setFlow({
      stage:ST.BLOCKED,
      blocked_from_stage:(st&&st!==ST.BLOCKED?st:(flow().blocked_from_stage||ST.BATCH_SCAN)),
      blocked_at:Date.now(),
      failure_reason:'COUPANG_ACCESS_DENIED',
      last_error:code
    });
    setBatch({needs_clean:true,last_blocked_at:Date.now()});
    render('쿠팡 접근 차단 감지 · 원래 단계 보존\n'+code,true);
    return;
  }

  // During development/testing an execution error must NOT throw away the
  // claimed work. Keep work_id, lock_token and exact stage for inspection/retry.
  setFlow({last_error:code,error_stage:st,error_page:page(),error_at:Date.now()});
  setBatch({
    needs_clean:true,
    last_error_at:Date.now(),
    last_error_code:code
  });
  if(st===ST.BATCH_SCAN||st===ST.BATCH_CLEAR)setBatch({cart_cleaned:false,last_preflight_error:code});

  render(
    '현재 작업에서 오류 발생 · 작업 보존\n'+
    'work_id='+(job&&job.work_id||'-')+'\n'+
    'stage='+(st||'-')+' · page='+page()+'\n'+
    code+'\n현재 단계 재개 또는 작업 반환을 선택하세요.',
    true
  );
}
async function register(){return req('/api/auto-order/runtime/register','POST',settings());}async function heartbeat(){return req('/api/auto-order/runtime/heartbeat','POST',settings());}async function workHeartbeat(){if(!job)return;return req('/api/auto-order/runtime/work/'+encodeURIComponent(job.work_id)+'/heartbeat','POST',settings({lock_token:job.lock_token}));}async function guard(){
  try{
    await workHeartbeat();
    if(job){
      GM_setValue(STORE.job,job);
      for(const key of LEGACY_JOB_KEYS)GM_setValue(key,null);
    }
    return true;
  }catch(e){
    if(STALE.has(errCode(e)))clearLocal();
    throw e;
  }
}function startWorkTimer(){clearInterval(workTimer);if(job)workTimer=setInterval(()=>workHeartbeat().catch(fail),5000);}
async function claim(){
  if(job){
    try{
      await workHeartbeat();
      startWorkTimer();
      render('이미 유효한 작업 보유 중 #'+job.work_id+'\n현재 단계를 계속 사용합니다.');
      return job;
    }catch(e){
      if(!STALE.has(errCode(e)))throw e;
      const stale=errCode(e);
      clearLocal();
      setBatch({needs_clean:true,last_stale_at:Date.now(),last_stale_code:stale});
      render('기존 로컬 작업은 서버에서 종료됨\n'+stale+'\n새 작업을 요청합니다.');
    }
  }

  render('작업 배정 요청 중…');
  const r=await req('/api/auto-order/runtime/claim','POST',settings());

  if(!r.job){
    /* No more work = this continuous run is over.
       The next future manual start begins with a cart check/clean. */
    setBatch({
      session_active:false,
      cart_cleaned:false,
      needs_clean:true,
      session_ended_at:Date.now(),
      session_end_reason:r.reason||'queue_empty'
    });
    render('배정 가능한 작업 없음\n'+(r.reason||'queue_empty'));
    return null;
  }

  job=r.job;
  GM_setValue(STORE.job,job);
  GM_setValue('gmao_runner_auth_status_v023',null); // V076 new-job-only AUTH reset
  startWorkTimer();

  let b=batch();
  let continuing=!!(
    b.session_active===true &&
    b.cart_cleaned===true &&
    b.needs_clean!==true
  );

  if(!b.session_active){
    setBatch({
      session_active:true,
      session_id:'S-'+Date.now(),
      session_started_at:Date.now(),
      cart_cleaned:false,
      needs_clean:true,
      orders_started:0
    });
    b=batch();
    continuing=false;
  }

  let nextStage=continuing?ST.ORDER_START:ST.BATCH_SCAN;

  setBatch({
    orders_started:Number(b.orders_started||0)+1,
    last_claim_at:Date.now()
  });

  setFlow({
    work_id:job.work_id,
    stage:nextStage,
    item_index:0,
    repair_index:0,
    cart_snapshot:null,
    cart_plan:null,
    final_verify:false,
    product_uncertain:[],
    repair_uncertain:[],
    
    batch_scan_settled:false,
    last_error:null
  });

  render(
    '작업 배정 완료 #'+job.work_id+'\n'+
    String(job.auto_order_no||'')+'\n'+
    (continuing
      ?'연속작업 다음 주문 · 장바구니 사전청소 생략'
      :'연속작업 첫/복구 주문 · 장바구니 확인/청소부터 시작')
  );

  setTimeout(()=>orchestrate().catch(fail),300);
  return job;
}
async function release(){
  if(!job)return;
  let j=job;
  try{
    await req('/api/auto-order/runtime/work/'+encodeURIComponent(j.work_id)+'/release','POST',settings({lock_token:j.lock_token}));
  }finally{
    clearLocal();
    setBatch({session_active:true,cart_cleaned:false,needs_clean:true,last_release_at:Date.now()});
    render('작업 반환 완료 · 다음 주문 전 장바구니 재확인');
  }
}
function itemUrl(item){return window.CPKR_PRODUCT.canonicalUrl(item);}function currentItem(){let a=items(job),i=Math.max(0,Number(flow().item_index||0));return a[i]||null;}
async function startOrder(){
  await loadProduct();
  let execItems=items(job),raw=rawItems(job);
  if(!raw.length||!execItems.length)throw new Error('ORDER_ITEM_EMPTY');

  /* User rule: one ORIGINAL order item -> Buy Now.
     Two or more ORIGINAL order items -> cart flow.
     Exact duplicate PUID rows may be quantity-aggregated for execution,
     but that aggregation never changes this branch decision. */
  let st=raw.length===1?ST.SINGLE:ST.MULTI_PRODUCT;
  setFlow({
    stage:st,
    item_index:0,
    raw_item_count:raw.length,
    product_execution_count:execItems.length
  });

  let u=itemUrl(execItems[0]);
  if(!u)throw new Error('CPKR_PUID_MISSING');

  render(
    (st===ST.SINGLE?'단건: 바로구매로 진행':'다건: 정확한 PUID별 장바구니 담기')+
    '\n주문행='+raw.length+' · PRODUCT실행='+execItems.length
  );
  wipeAndGo(u,'ORDER_START');
}
async function prepareProduct(mode,item){
  await guard();
  await loadProduct();

  item=item||currentItem();
  if(!item)throw new Error('PRODUCT_ITEM_MISSING');

  let prepared=await window.CPKR_PRODUCT.prepare(item,mode);

  render(
    (String(mode).toUpperCase()==='SINGLE'
      ?'단건 상품 준비 완료'
      :(prepared.ready===false
        ?'다건 PRODUCT 병사 보고 · 대상 없음'
        :'다건 상품 준비 완료'))+
    '\nPUID='+(prepared.inspection&&prepared.inspection.current_puid||'-')+
    '\n수량='+(prepared.quantity&&prepared.quantity.after||'-')+
    (prepared.reason?'\nREPORT='+prepared.reason:'')+
    (prepared.target
      ?'\nACTION='+prepared.target.tag+
        ' ['+prepared.target.text+'] href='+(prepared.target.href||'-')
      :'')
  );

  return prepared;
}

function recordUncertain(result,kind,index){
  if(!result||!result.uncertain)return;

  let f=flow();
  let key=kind==='repair'?'repair_uncertain':'product_uncertain';
  let u=Array.isArray(f[key])?f[key].slice():[];

  u.push({
    item_index:Number(index||0),
    puid:result.inspection&&result.inspection.current_puid||'',
    reason:'COUPANG_SERVER_ALERT_AFTER_CART_CLICK',
    at:Date.now()
  });

  let patch={};
  patch[key]=u;
  setFlow(patch);
}

async function runSingle(){
  if(page()!=='PRODUCT'){
    await loadProduct();
    let u=itemUrl(currentItem());
    wipeAndGo(u,'SINGLE');
    return;
  }

  /* 1. PRODUCT module prepares only. */
  let prepared=await prepareProduct('SINGLE');

  /* 2. Orchestra verifies the work again immediately before the irreversible click. */
  await guard();

  /* 3. Orchestra owns the transition state. */
  setFlow({
    stage:ST.CHECKOUT_PENDING,
    checkout_source:'SINGLE',
    checkout_clicked_at:Date.now()
  });

  /* 4. PRODUCT module performs exactly one native Buy Now click. */
  let result;
  try{
    markNav();
    result=window.CPKR_PRODUCT.buyNow(prepared);
  }catch(e){
    GM_setValue(STORE.nav,null);
    /* Synchronous click failure did not leave PRODUCT; restore the executable stage. */
    setFlow({
      stage:ST.SINGLE,
      checkout_source:null,
      checkout_clicked_at:null
    });
    throw e;
  }

  render(
    '단건 바로구매 1회 클릭 완료'+
    '\nPUID='+result.inspection.current_puid+
    '\n수량='+result.quantity.after+
    (result.buy_target
      ?'\nBUY='+result.buy_target.tag+
       ' ['+result.buy_target.text+'] href='+(result.buy_target.href||'-')
      :'')
  );

  setTimeout(()=>orchestrate().catch(fail),1200);
}

async function recoverMultiProductPending(){
  let f=flow(),idx=Math.max(0,Number(f.item_index||0)),a=items(job),item=a[idx];
  if(!item){setFlow({stage:ST.MULTI_SNAPSHOT,multi_pending:null});wipeAndGo(cartUrl(),'MULTI_PENDING_NO_ITEM');return;}
  if(page()!=='CART'){wipeAndGo(cartUrl(),'MULTI_PENDING_VERIFY');return;}
  await loadCart(); await guard();
  let snap=await window.CPKR_CART.snapshot(),wanted=runnerUid(item);
  let found=(Array.isArray(snap)?snap:[]).find(function(row){let got=runnerUid(row);return !!(wanted.key&&got.key&&wanted.key===got.key);});
  let expected=Number(item.qty||item.quantity||1),actual=Number(found&&(found.qty||found.quantity)||0);
  if(found&&actual>=expected){
    idx++;
    setFlow({
      stage:ST.MULTI_PRODUCT,
      item_index:idx,
      multi_pending:null,
      multi_no_cart_retry_count:0,
      multi_pending_recovered_at:Date.now()
    });
    render('장바구니 반영 확인 · 같은 상품을 다시 클릭하지 않습니다.');
    if(idx<a.length){let u=itemUrl(a[idx]);if(!u)throw new Error('CPKR_PUID_MISSING');wipeAndGo(u,'MULTI_PENDING_NEXT');return;}
    setFlow({stage:ST.MULTI_SNAPSHOT});wipeAndGo(cartUrl(),'MULTI_SNAPSHOT');return;
  }

  /* Special contract: PRODUCT soldier reported that no cart button existed,
     and CART verification confirms that this exact PID+VID is still absent.
     This is not a normal missing-item repair case. Return to PRODUCT and let
     prepare(MULTI) inspect one freshly loaded DOM exactly once. */
  if(f.multi_pending&&f.multi_pending.report==='CART_BUTTON_NOT_FOUND'&&!found){
    let retryCount=Math.max(0,Number(f.multi_no_cart_retry_count||0));
    if(retryCount<1){
      let u=itemUrl(item);
      if(!u)throw new Error('CPKR_PUID_MISSING');
      setFlow({
        stage:ST.MULTI_PRODUCT,
        item_index:idx,
        multi_pending:null,
        multi_no_cart_retry_count:retryCount+1,
        multi_no_cart_retry_at:Date.now(),
        failure_reason:null
      });
      render('CART 확인 결과 현재 상품 없음 · PRODUCT 새 DOM에서 prepare(MULTI) 1회 재시도');
      wipeAndGo(u,'MULTI_PRODUCT_FRESH_RETRY');
      return;
    }
  }

  let repairItem=Object.assign({},item,{quantity:expected,qty:expected});
  setFlow({
    stage:ST.MULTI_REPAIR,
    multi_pending:null,
    repair_index:0,
    repair_missing:[{
      index:idx,
      item:repairItem,
      pid:wanted.pid,
      iid:wanted.iid,
      vid:wanted.vid,
      puid:(wanted.pid&&wanted.iid&&wanted.vid)?(wanted.pid+'_'+wanted.iid+'_'+wanted.vid):'',
      quantity:expected
    }],
    failure_reason:'MULTI_ADD_RESULT_UNCONFIRMED'
  });
  render('장바구니 반영 미확인 · 상품페이지 재클릭 없이 보정 단계로 이동',true);
  return orchestrate();
}

async function runMultiProduct(){
  let a=items(job),f=flow(),idx=Math.max(0,Number(f.item_index||0));

  if(idx>=a.length){
    setFlow({stage:ST.MULTI_SNAPSHOT});
    wipeAndGo(cartUrl(),'MULTI_SNAPSHOT');
    return;
  }

  let item=a[idx];

  if(page()!=='PRODUCT'){
    await loadProduct();
    let u=itemUrl(item);
    if(!u)throw new Error('CPKR_PUID_MISSING');
    wipeAndGo(u,'MULTI_PRODUCT_'+idx);
    return;
  }

  /* Prepare and verify immediately before the one cart click. */
  let prepared=await prepareProduct('MULTI',item);

  if(prepared&&prepared.ready===false&&prepared.reason==='CART_BUTTON_NOT_FOUND'){
    let retryCount=Math.max(0,Number(f.multi_no_cart_retry_count||0));

    /* On the first report, commander verifies CART instead of blaming the
       soldier. If CART confirms the item is absent, recoverMultiProductPending()
       returns here on one freshly loaded PRODUCT DOM. */
    if(retryCount<1){
      setFlow({
        stage:ST.MULTI_PRODUCT_PENDING,
        item_index:idx,
        multi_pending:{
          key:runnerUid(item).key,
          qty:Number(item.qty||item.quantity||1),
          ts:Date.now(),
          clicked:false,
          report:'CART_BUTTON_NOT_FOUND'
        }
      });
      render('PRODUCT 병사 복귀 보고 · 장바구니 버튼 없음\n클릭 없이 CART에서 실제 반영 여부를 확인합니다.');
      wipeAndGo(cartUrl(),'MULTI_PRODUCT_NO_CART_BUTTON_VERIFY');
      return;
    }

    /* Fresh PRODUCT DOM was already tried once and the target is still absent.
       Soldier only reports; commander makes the final failure decision. */
    setFlow({
      stage:ST.FAILED,
      item_index:idx,
      multi_pending:null,
      failure_reason:'CART_BUTTON_NOT_FOUND_AFTER_FRESH_RETRY',
      failed_at:Date.now()
    });
    render('PRODUCT 새 DOM 재시도 후에도 장바구니 버튼 없음 · 지휘관이 작업 실패로 판정',true);
    return;
  }

  await guard();

  setFlow({
    stage:ST.MULTI_PRODUCT_PENDING,
    item_index:idx,
    multi_pending:{key:runnerUid(item).key,qty:Number(item.qty||item.quantity||1),ts:Date.now(),clicked:true}
  });

  let result=await window.CPKR_PRODUCT.addToCart(
    prepared,
    typeof unsafeWindow!=='undefined'?unsafeWindow:window
  );

  recordUncertain(result,'product',idx);

  render(
    '다건 장바구니 1회 클릭 완료'+
    '\nPUID='+result.inspection.current_puid+
    '\n수량='+result.quantity.after+
    (result.settled?'\n담기후 고정대기='+result.settled.wait_ms+'ms':'')+
    (result.uncertain?'\n쿠팡 서버메시지 감지 → CART 최종검증으로 판정':'')
  );

  /* item_index advances only after PRODUCT action returns. */
  idx++;
  setFlow({stage:ST.MULTI_PRODUCT,item_index:idx,multi_pending:null,multi_no_cart_retry_count:0});

  if(idx<a.length){
    let u=itemUrl(a[idx]);
    if(!u)throw new Error('CPKR_PUID_MISSING');
    wipeAndGo(u,'MULTI_NEXT');
    return;
  }

  setFlow({stage:ST.MULTI_SNAPSHOT});
  wipeAndGo(cartUrl(),'MULTI_SNAPSHOT');
}

async function snapshotAndDetach(finalPass){
  if(page()!=='CART'){
    wipeAndGo(cartUrl(),'CART_SNAPSHOT');
    return;
  }

  await settleCartStage(finalPass?'MULTI_FINAL_SNAPSHOT':'MULTI_SNAPSHOT',1100);
  await loadCart();

  // CART DOM is read exactly once.  Everything needed for comparison must
  // be serialized before leaving Coupang.
  const snap=window.CPKR_CART.snapshot();
  if(!Array.isArray(snap))throw new Error('CART_SNAPSHOT_INVALID');

  setFlow({
    stage:ST.MULTI_COMPARE,
    cart_snapshot:snap,
    final_verify:!!finalPass,
    detached_compare_pending:true
  });

  render('장바구니 DOM 확보 완료 · 쿠팡 페이지 분리 후 주문과 비교');

  // Do NOT compare while Coupang CART DOM/runtime is alive.
  detachForCompare('CART_COMPARE_DETACHED');
}
async function compareDetached(){
  if(page()!=='DETACHED')throw new Error('CART_COMPARE_NOT_DETACHED');
  const f=flow();
  const snap=f.cart_snapshot;

  if(!Array.isArray(snap))throw new Error('CART_SNAPSHOT_MISSING');

  // Comparison is pure data work. CPKR_CART.compare() does not need a live
  // Coupang DOM, but the module may need to be loaded into the userscript
  // sandbox first.
  await loadCart();

  const plan=window.CPKR_CART.compare(rawItems(job),snap);
  setFlow({
    cart_plan:plan,
    detached_compare_pending:false
  });

  if(plan.ok){
    if(f.final_verify){
      setFlow({stage:ST.MULTI_CHECKOUT});
      render('최종 장바구니 일치 · 구매 단계로 이동');
      wipeAndGo(cartUrl(),'CART_FINAL_CHECKOUT');
      return;
    }
    setFlow({stage:ST.MULTI_CHECKOUT});
    render('장바구니 일치 · 구매 단계로 이동');
    wipeAndGo(cartUrl(),'CART_CHECKOUT');
    return;
  }

  if(f.final_verify){
    await finishFinalMismatch(plan);
    return;
  }

  setFlow({stage:ST.MULTI_ADJUST});
  render('장바구니 불일치 · 1회 보정 준비');
  wipeAndGo(cartUrl(),'CART_ADJUST');
}
async function finishFinalMismatch(plan){
  if(!job)return;
  const j=job;
  const detail={
    phase:'CART_FINAL_MISMATCH',
    reason:'FINAL_CART_COMPARE_FAILED_AFTER_ONE_CORRECTION',
    missing:(plan&&plan.missing)||[],
    extra:(plan&&plan.extra)||[],
    qty_mismatch:(plan&&plan.qty_mismatch)||[],
    page_type:page()
  };
  try{
    await req(
      '/api/auto-order/runtime/work/'+encodeURIComponent(j.work_id)+'/state',
      'POST',
      settings({lock_token:j.lock_token,status:'FAILED',detail:detail})
    );
  }catch(e){
    setFlow({last_error:'FINAL_MISMATCH_RECORD_FAILED '+errCode(e)});
    throw e;
  }
  clearLocal();
  setBatch({
    session_active:true,
    cart_cleaned:false,
    needs_clean:true,
    last_failed_at:Date.now(),
    last_failed_reason:'CART_FINAL_MISMATCH'
  });
  render(
    '최종 장바구니 불일치 기록 완료 · 해당 주문 패스\n'+
    'missing='+detail.missing.length+
    ' · extra='+detail.extra.length+
    ' · qty='+detail.qty_mismatch.length+
    '\n다음 주문 전 장바구니 재확인/청소'
  );
  setTimeout(()=>claim().catch(fail),700);
}

async function adjustOnce(){
  if(page()!=='CART'){
    wipeAndGo(cartUrl(),'MULTI_ADJUST');
    return;
  }

  await settleCartStage('MULTI_ADJUST',1100);
  await guard();
  await loadCart();

  let plan=flow().cart_plan;
  if(!plan)throw new Error('CART_PLAN_MISSING');

  let result=await window.CPKR_CART.applyAdjustments(
    plan,
    typeof unsafeWindow!=='undefined'?unsafeWindow:window
  );

  /* Use the module return contract, not the stale pre-action plan. */
  let miss=Array.isArray(result&&result.missing)?result.missing:[];

  if(miss.length){
    setFlow({
      stage:ST.MULTI_REPAIR,
      repair_index:0,
      repair_missing:miss
    });

    await loadProduct();

    let u=itemUrl(miss[0].item);
    if(!u)throw new Error('CPKR_PUID_MISSING');
    wipeAndGo(u,'MULTI_REPAIR');
    return;
  }

  setFlow({stage:ST.MULTI_FINAL_SNAPSHOT});
  wipeAndGo(cartUrl(),'MULTI_FINAL_SNAPSHOT');
}
async function repairMissing(){
  let f=flow();
  let m=Array.isArray(f.repair_missing)?f.repair_missing:[];
  let i=Math.max(0,Number(f.repair_index||0));

  if(i>=m.length){
    setFlow({stage:ST.MULTI_FINAL_SNAPSHOT});
    wipeAndGo(cartUrl(),'MULTI_FINAL_SNAPSHOT');
    return;
  }

  let item=m[i].item;

  if(page()!=='PRODUCT'){
    await loadProduct();
    let u=itemUrl(item);
    if(!u)throw new Error('CPKR_PUID_MISSING');
    wipeAndGo(u,'MULTI_REPAIR_'+i);
    return;
  }

  let prepared=await prepareProduct('MULTI',item);

  if(prepared&&prepared.ready===false&&prepared.reason==='CART_BUTTON_NOT_FOUND'){
    /* One repair visit also found no target. Soldier reports and returns.
       Commander continues to the final CART snapshot; only the final compare
       may decide that the order itself failed. */
    let reports=Array.isArray(f.repair_reports)?f.repair_reports.slice():[];
    reports.push({
      repair_index:i,
      reason:'CART_BUTTON_NOT_FOUND',
      puid:prepared.inspection&&prepared.inspection.current_puid||'',
      at:Date.now()
    });
    i++;
    setFlow({repair_index:i,repair_reports:reports});
    render('누락상품 PRODUCT 병사 복귀 보고 · 장바구니 버튼 없음\n전체 작업을 죽이지 않고 최종 CART 검증으로 넘깁니다.');
    if(i<m.length){
      let next=itemUrl(m[i].item);
      if(!next)throw new Error('CPKR_PUID_MISSING');
      wipeAndGo(next,'MULTI_REPAIR_NEXT_REPORT');
      return;
    }
    setFlow({stage:ST.MULTI_FINAL_SNAPSHOT});
    wipeAndGo(cartUrl(),'MULTI_FINAL_SNAPSHOT_AFTER_REPORT');
    return;
  }

  await guard();

  let result=await window.CPKR_PRODUCT.addToCart(
    prepared,
    typeof unsafeWindow!=='undefined'?unsafeWindow:window
  );

  recordUncertain(result,'repair',i);

  render(
    '누락상품 1회 추가 클릭 완료'+
    (result&&result.uncertain?' · 서버메시지는 최종 CART에서 검증':'')+
    '\nPUID='+(result.inspection&&result.inspection.current_puid||'')
  );

  i++;
  setFlow({repair_index:i});

  if(i<m.length){
    let u=itemUrl(m[i].item);
    if(!u)throw new Error('CPKR_PUID_MISSING');
    wipeAndGo(u,'MULTI_REPAIR_NEXT');
    return;
  }

  setFlow({stage:ST.MULTI_FINAL_SNAPSHOT});
  wipeAndGo(cartUrl(),'MULTI_FINAL_SNAPSHOT');
}

async function multiCheckout(){
  if(page()!=='CART'){
    wipeAndGo(cartUrl(),'MULTI_CHECKOUT');
    return;
  }

  await settleCartStage('MULTI_CHECKOUT',1100);
  await guard();
  await loadCart();

  /* CART prepares selection and locates checkout, but does not click. */
  let prepared=await window.CPKR_CART.prepareCheckout();

  /* Revalidate immediately before irreversible checkout action. */
  await guard();

  setFlow({
    stage:ST.CHECKOUT_PENDING,
    checkout_source:'MULTI',
    checkout_clicked_at:Date.now()
  });

  try{
    markNav();
    window.CPKR_CART.checkout(prepared);
  }catch(e){
    GM_setValue(STORE.nav,null);
    setFlow({
      stage:ST.MULTI_CHECKOUT,
      checkout_source:null,
      checkout_clicked_at:null
    });
    throw e;
  }

  render(
    '다건 주문하기 1회 클릭 완료'+
    (prepared.target
      ?'\nCHECKOUT='+prepared.target.tag+
       ' ['+prepared.target.text+'] href='+(prepared.target.href||'-')
      :'')
  );

  setTimeout(()=>orchestrate().catch(fail),1200);
}

async function checkoutPending(){
  let pg=page();

  if(pg==='CHECKOUT'){
    GM_setValue('gmao_runner_auth_status_v023',null);
    setFlow({stage:ST.CHECKOUT});
    await checkout();
    return;
  }

  if(pg==='AUTH'){
    await handleAuthPage();
    return;
  }

  let f=flow(),age=Date.now()-Number(f.checkout_clicked_at||0);
  if(age<10000){
    setTimeout(()=>orchestrate().catch(fail),700);
    return;
  }

  throw new Error(
    'CHECKOUT_NAVIGATION_FAILED source='+
    (f.checkout_source||'?')+
    ' page='+pg
  );
}
async function batchScan(){
  await loadCart();

  if(page()==='CART'){
    await settleCartStage('BATCH_SCAN_CART',1150);
    let snap=window.CPKR_CART.snapshot();

    if(!snap.length){
      setBatch({
        cart_cleaned:true,
        needs_clean:false,
        cleaned_at:Date.now(),
        method:'cart-snapshot-empty-confirmed'
      });
      setFlow({stage:ST.ORDER_START});
      await startOrder();
      return;
    }

    setFlow({stage:ST.BATCH_CLEAR});
    await batchClear();
    return;
  }

  let f=flow();
  if(!f.batch_scan_settled){
    setFlow({batch_scan_settled:true});
    render('연속작업 첫 장바구니 상태 확인 · 헤더 렌더링 대기 700ms');
    await new Promise(r=>setTimeout(r,700));
  }

  let c=window.CPKR_CART.headerCount();

  /* Header 0 is authoritative: never dispatch the CART cleaning soldier.
     If the header is not readable yet, give it a short second chance before
     navigating to CART for confirmation. */
  if(c==null){
    for(let retry=0;retry<3&&c==null;retry++){
      await new Promise(r=>setTimeout(r,250));
      c=window.CPKR_CART.headerCount();
    }
  }

  if(c===0){
    setBatch({
      cart_cleaned:true,
      needs_clean:false,
      cleaned_at:Date.now(),
      method:'header-zero-confirmed'
    });
    setFlow({stage:ST.ORDER_START});
    render('장바구니 헤더 0 확인 · CART 청소 병사 호출 없이 주문 시작');
    await startOrder();
    return;
  }

  if(c!=null&&c>0){
    setFlow({stage:ST.BATCH_CLEAR});
    wipeAndGo(cartUrl(),'BATCH_CLEAR');
    return;
  }

  /* Unknown is not treated as non-empty. CART is opened only to confirm state. */
  wipeAndGo(cartUrl(),'BATCH_SCAN_CART_CONFIRM');
}async function batchClear(){
  if(page()!=='CART'){
    wipeAndGo(cartUrl(),'BATCH_CLEAR');
    return;
  }
  await settleCartStage('BATCH_CLEAR',1100);
  await guard();
  await loadCart();
  let r=await window.CPKR_CART.clearAll(typeof unsafeWindow!=='undefined'?unsafeWindow:window);
  setBatch({
    cart_cleaned:true,
    needs_clean:false,
    cleaned_at:Date.now(),
    method:'bulk-clear',
    deleted:r.count||0
  });
  setFlow({stage:ST.ORDER_START});
  render('장바구니 청소 완료 · 주문 계속');
  await startOrder();
}
function nativeInputValue(input,value){let proto=input instanceof HTMLInputElement?HTMLInputElement.prototype:null,desc=proto&&Object.getOwnPropertyDescriptor(proto,'value');if(desc&&desc.set)desc.set.call(input,String(value==null?'':value));else input.value=String(value==null?'':value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}
function authActionable(el){
  if(!el||!el.getBoundingClientRect)return false;
  let rc=el.getBoundingClientRect();
  if(rc.width<=0||rc.height<=0)return false;
  let st=getComputedStyle(el);
  if(st.display==='none'||st.visibility==='hidden'||Number(st.opacity||1)<=0)return false;
  if(el.disabled||el.getAttribute('aria-disabled')==='true')return false;
  return true;
}
function passwordMethodButton(){
  let nodes=Array.from(D.querySelectorAll('button,a,[role="button"]'));
  return nodes.find(function(el){
    if(!visible(el)||el.disabled||el.getAttribute('aria-disabled')==='true')return false;
    return /^비밀번호\s*확인$/.test(text(el));
  })||null;
}
async function login(){
  if(!job||page()!=='AUTH')return false;
  let body=String(document.body&&document.body.innerText||'').slice(0,12000);
  if(/자동입력\s*방지|captcha/i.test(body))throw new Error('LOGIN_CAPTCHA_REQUIRED');
  let id=document.querySelector('input[type="email"],input[name="email"],#login-email-input,input[name="loginId"],input[name="login_id"],input[autocomplete="username"]');
  let pw=Array.from(document.querySelectorAll('input[type="password"]')).find(x=>x.id!=='auth-password-input')||null;
  if(!(id&&pw)){
    let sw=Array.from(document.querySelectorAll('a,button,[role="button"]')).find(x=>authActionable(x)&&/비밀번호로\s*로그인|sign\s*in\s*with\s*password/i.test(text(x)));
    if(sw){sw.click();setTimeout(()=>orchestrate().catch(fail),700);return true;}
    return false;
  }
  let st=GM_getValue('gmao_runner_auth_status_v023',null)||{};
  if(st.state==='LOGIN_SUBMITTED'){
    if(Date.now()-Number(st.ts||0)<6000){setTimeout(()=>orchestrate().catch(fail),900);return true;}
    throw new Error('LOGIN_NAVIGATION_TIMEOUT');
  }
  await guard();
  let x=await req('/api/auto-order/runtime/work/'+encodeURIComponent(job.work_id)+'/credential','POST',settings({lock_token:job.lock_token}));
  let c=x&&x.credential||{},loginId=String(c.login_id||c.loginId||c.id||c.email||'').trim();
  if(!loginId)throw new Error('LOGIN_ID_NOT_RETURNED');
  if(!c.password)throw new Error('LOGIN_PASSWORD_NOT_RETURNED');
  nativeInputValue(id,loginId);nativeInputValue(pw,c.password);c.password='';await new Promise(r=>setTimeout(r,250));
  let submit=Array.from(document.querySelectorAll('button[type="submit"],input[type="submit"],button')).find(x=>authActionable(x)&&(x.type==='submit'||/^로그인$|^sign\s*in$/i.test(text(x))));
  if(!submit)throw new Error('LOGIN_SUBMIT_NOT_FOUND');
  GM_setValue('gmao_runner_auth_status_v023',{state:'LOGIN_SUBMITTED',ts:Date.now()});
  render('쿠팡 계정 자동 입력 완료 · 로그인 1회 실행\n성공하면 BATCH_SCAN부터 다시 시작');submit.click();
  setTimeout(()=>{if(job&&page()==='AUTH')orchestrate().catch(fail);},900);return true;
}
async function auth(){
  if(!job||page()!=='AUTH')return 'NOT_AUTH';

  let saved=GM_getValue('gmao_runner_auth_status_v023',null)||{};
  let now=Date.now();

  if(saved.state==='PASSWORD_SUBMITTED'){
    let age=now-Number(saved.ts||0);
    if(age<7000)return 'WAITING_NAVIGATION';
    throw new Error('AUTH_NAVIGATION_TIMEOUT');
  }

  let input=document.querySelector(
    '#auth-password-input,input[name="password"][type="password"]'
  );

  if(!input){
    let b=passwordMethodButton();
    if(b){
      if(saved.state==='PASSWORD_METHOD_SELECTED'){
        let age=now-Number(saved.ts||0);
        if(age<7000)return 'WAITING_PASSWORD_RENDER';
        throw new Error('AUTH_PASSWORD_METHOD_NAVIGATION_TIMEOUT');
      }

      GM_setValue('gmao_runner_auth_status_v023',{
        state:'PASSWORD_METHOD_SELECTED',
        ts:Date.now()
      });
      render('쿠팡 추가인증 감지\n비밀번호 확인 방식을 1회 선택합니다.');
      b.click();
      return 'METHOD_SELECTED';
    }
    return 'WAITING_RENDER';
  }

  await guard();

  let x=await req(
    '/api/auto-order/runtime/work/'+encodeURIComponent(job.work_id)+'/credential',
    'POST',
    settings({lock_token:job.lock_token})
  );
  let c=x&&x.credential||{};
  if(!c.password)throw new Error('CPKR_MASTER 비밀번호가 컨트롤타워에 등록되지 않았습니다.');

  GM_setValue('gmao_runner_auth_status_v023',{
    state:'PASSWORD_FILLING',
    ts:Date.now()
  });
  render('쿠팡 추가인증 감지\nCPKR_MASTER 비밀번호를 자동 입력합니다.');

  nativeInputValue(input,c.password);
  c.password='';
  await new Promise(r=>setTimeout(r,250));

  let submit=Array.from(document.querySelectorAll(
    'button[type="submit"].authentication-password__submit-btn,button[type="submit"]'
  )).find(el=>authActionable(el))||null;
  if(!submit)throw new Error('쿠팡 추가인증 계속하기 버튼을 찾지 못했습니다.');

  if(submit.disabled){
    await new Promise(r=>setTimeout(r,200));
  }

  GM_setValue('gmao_runner_auth_status_v023',{
    state:'PASSWORD_SUBMITTED',
    ts:Date.now()
  });

  if(!authActionable(submit))return 'WAITING_SUBMIT_READY';
    submit.click();
  return 'PASSWORD_SUBMITTED';
}

function scheduleAuthRetry(ms){
  setTimeout(()=>{
    if(job&&page()==='AUTH')orchestrate().catch(fail);
  },ms||700);
}

async function handleAuthPage(){
  if(await login())return 'LOGIN';
  let state=await auth();

  if(
    state==='WAITING_RENDER' ||
    state==='WAITING_PASSWORD_RENDER' ||
    state==='WAITING_SUBMIT_READY' ||
    state==='METHOD_SELECTED' ||
    state==='WAITING_NAVIGATION' ||
    state==='PASSWORD_SUBMITTED'
  ){
    scheduleAuthRetry(
      state==='WAITING_RENDER'?650:
      state==='METHOD_SELECTED'?650:
      900
    );
  }

  return state;
}
function setBridge(x){GM_setValue(STORE.bridge,Object.assign({ts:Date.now()},x||{}));}function getBridge(){return GM_getValue(STORE.bridge,null);}async function waitBridge(workId,ms){let t=Date.now();while(Date.now()-t<(ms||90000)){let x=getBridge();if(x&&String(x.work_id)===String(workId)){if(x.state==='DONE')return x;if(x.state==='ERROR')throw new Error(x.error||'ADDRESS_BRIDGE_ERROR');}await new Promise(r=>setTimeout(r,250));}throw new Error('ADDRESS_BRIDGE_TIMEOUT');}
async function addressFrame(){if(location.hostname!=='id.coupang.com'||!/^\/addressbook\//.test(location.pathname))return false;let b=null,t=Date.now();while(Date.now()-t<300000){let x=getBridge();if(x&&x.state==='REQUESTED'&&x.receiver){b=x;break;}await new Promise(r=>setTimeout(r,250));}if(!b)return true;try{await loadCheckout();setBridge(Object.assign({},b,{state:'RUNNING'}));let r=await window.CPKR_CHECKOUT.fillAddressOnly(b.receiver,null,{action:b.action||'ADD',current_address_text:b.current_address_text||''});setBridge(Object.assign({},b,{state:'DONE',result:r||{ok:true}}));}catch(e){setBridge(Object.assign({},b,{state:'ERROR',error:errCode(e)}));}return true;}
async function checkout(){
  let pg=page();

  if(pg==='AUTH'){
    setFlow({stage:ST.CHECKOUT_PENDING});
    await handleAuthPage();
    return;
  }

  if(pg!=='CHECKOUT'){
    throw new Error('CHECKOUT_PAGE_LOST page='+pg);
  }

await guard();await loadCheckout();let p=payload(job),receiver=p.receiver||{};if(!receiver.name||!receiver.phone||!receiver.zipcode||!receiver.road_address)throw new Error('RECEIVER_PAYLOAD_INCOMPLETE');let order=Object.assign({},p.order||{},{receiver:receiver,shipping:receiver,address:receiver}),plan=window.CPKR_CHECKOUT.inspectAddress(order);if(plan.action!=='KEEP')setBridge({state:'REQUESTED',work_id:job.work_id,auto_order_no:job.auto_order_no,action:plan.action,current_address_text:plan.current_text||'',receiver:receiver});let r=await window.CPKR_CHECKOUT.fillAndStop(order,{addressPlan:plan,onProgress:x=>render('배송지 처리\n'+x),waitForAddressBridge:()=>waitBridge(job.work_id,90000)});await req('/api/auto-order/runtime/work/'+encodeURIComponent(job.work_id)+'/state','POST',settings({lock_token:job.lock_token,status:'STOPPED_BEFORE_PAYMENT',detail:{phase:'CHECKOUT_STOPPED_BEFORE_PAYMENT',address_branch:plan.branch,address_action:(r&&r.address_result&&r.address_result.action)||plan.action}}));setFlow({stage:ST.STOPPED});
setBatch({
  session_active:true,
  cart_cleaned:false,
  needs_clean:true,
  last_stopped_before_payment_at:Date.now(),
  stop_reason:'STOPPED_BEFORE_PAYMENT_NOT_COMPLETED'
});
clearInterval(workTimer);
workTimer=null;
GM_setValue(STORE.job,null);
job=null;
render('결제하기 직전 정지 완료 · 아직 주문완료 아님 · 다음 작업 전 장바구니 재확인');}
async function orchestrate(){
  if(busy||!job)return;

  if(blocked()){
    await fail(new Error('COUPANG_ACCESS_DENIED'));
    return;
  }

  busy=true;
  try{
    let f=flow(),s=f.stage||ST.BATCH_SCAN;

    if(s===ST.BLOCKED){
      render(
        '쿠팡 접근 차단으로 자동주문 정지\n'+
        '이전 단계='+(f.blocked_from_stage||'-')+'\n'+
        '자동 재개하지 않습니다.'
      );
      return;
    }

    if(page()==='AUTH'){await handleAuthPage();return;}

    if(s===ST.BATCH_SCAN)await batchScan();
    else if(s===ST.BATCH_CLEAR)await batchClear();
    else if(s===ST.ORDER_START)await startOrder();
    else if(s===ST.SINGLE)await runSingle();
    else if(s===ST.MULTI_PRODUCT)await runMultiProduct();
    else if(s===ST.MULTI_PRODUCT_PENDING)await recoverMultiProductPending();
    else if(s===ST.MULTI_SNAPSHOT)await snapshotAndDetach(false);
    else if(s===ST.MULTI_COMPARE)await compareDetached();
    else if(s===ST.MULTI_ADJUST)await adjustOnce();
    else if(s===ST.MULTI_REPAIR)await repairMissing();
    else if(s===ST.MULTI_FINAL_SNAPSHOT)await snapshotAndDetach(true);
    else if(s===ST.MULTI_CHECKOUT)await multiCheckout();
    else if(s===ST.CHECKOUT_PENDING)await checkoutPending();
    else if(s===ST.CHECKOUT)await checkout();
    else if(s===ST.STOPPED)render('결제 직전 정지 상태');
    else if(s===ST.FAILED)render('실패 기록 완료 · 다음 작업 대기',true);
    else throw new Error('UNKNOWN_STAGE:'+s);
  }finally{
    busy=false;
  }
}
async function start(){
  try{
    if(location.hostname==='id.coupang.com'&&/^\/addressbook\//.test(location.pathname)){await addressFrame();return;}
    await register();
    await heartbeat();
    clientTimer=setInterval(()=>heartbeat().catch(()=>{}),20000);

    if(job){
      try{
        await workHeartbeat();
        startWorkTimer();

        let f=flow(),navOk=takeNav();
        if(!navOk||String(f.work_id||'')!==String(job.work_id||'')||!validStageName(f.stage)){
          setBatch({session_active:true,cart_cleaned:false,needs_clean:true,recovery_started_at:Date.now()});
          setFlow({work_id:job.work_id,stage:ST.BATCH_SCAN,item_index:0,repair_index:0,cart_snapshot:null,cart_plan:null,final_verify:false,last_error:null});
          render('기존 작업 재시작 #'+job.work_id+'\n중간 단계 폐기 → 기존 장바구니 확인/청소부터 시작');
        }else{
          render('정상 페이지 이동 계속 #'+job.work_id+'\n단계='+f.stage);
        }
        setTimeout(()=>orchestrate().catch(fail),350);
      }catch(e){
        if(STALE.has(errCode(e))){clearLocal();render('오래된 작업 자동 정리');}
        else throw e;
      }
    }else render('온라인 · 작업 배정 대기');
  }catch(e){await fail(e);}
}
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',()=>start(),{once:true});
}else{
  start();
}
})();
