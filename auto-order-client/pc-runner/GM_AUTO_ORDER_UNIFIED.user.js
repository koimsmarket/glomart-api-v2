// ==UserScript==
// @name         Glomart Auto Order PC Runner
// @namespace    https://koims.market/auto-order
// @version      0.068
// @description  Thin orchestrator: stage routing only. Product/cart DOM work lives in CPKR_PRODUCT/CPKR_CART; existing checkout/auth flow is preserved.
// @match        https://www.coupang.com/*
// @match        https://cart.coupang.com/*
// @match        https://checkout.coupang.com/*
// @match        https://login.coupang.com/*
// @match        https://id.coupang.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @connect      port-0-glomart-api-v2-mordwrnh222b6c36.sel3.cloudtype.app
// ==/UserScript==
(function(){
'use strict';
const VERSION='0.068';
const API='https://port-0-glomart-api-v2-mordwrnh222b6c36.sel3.cloudtype.app';
const URLS={
 product:API+'/auto-order-client/shared/js/mall/cpkr/CPKR_PRODUCT.js?v=066',
 cart:API+'/auto-order-client/shared/js/mall/cpkr/CPKR_CART.js?v=066',
 checkout:API+'/auto-order-client/shared/js/mall/cpkr/CPKR_CHECKOUT.js?v=029',
 util:API+'/auto-order-client/shared/js/GM_AUTO_ORDER_UTIL.js?v=013'
};
const STORE={
 job:'gmao_runner_job_v013',
 flow:'gmao_cpkr_flow_stable_v1',
 batch:'gmao_cpkr_batch_session_stable_v1',
 client:'gmao_runner_client_id_v013',
 bridge:'gmao_cpkr_address_bridge_v033'
};
const LEGACY_JOB_KEYS=['gmao_runner_job_v062'];
const LEGACY_FLOW_KEYS=['gmao_cpkr_flow_v066','gmao_cpkr_flow_v062'];
const LEGACY_BATCH_KEYS=['gmao_cpkr_batch_v066','gmao_cpkr_batch_v062'];
const ST={BATCH_SCAN:'BATCH_SCAN',BATCH_CLEAR:'BATCH_CLEAR',ORDER_START:'ORDER_START',SINGLE:'SINGLE',MULTI_PRODUCT:'MULTI_PRODUCT',MULTI_SNAPSHOT:'MULTI_SNAPSHOT',MULTI_COMPARE:'MULTI_COMPARE',MULTI_ADJUST:'MULTI_ADJUST',MULTI_REPAIR:'MULTI_REPAIR',MULTI_FINAL_SNAPSHOT:'MULTI_FINAL_SNAPSHOT',MULTI_CHECKOUT:'MULTI_CHECKOUT',CHECKOUT_PENDING:'CHECKOUT_PENDING',CHECKOUT:'CHECKOUT',STOPPED:'STOPPED',FAILED:'FAILED',BLOCKED:'BLOCKED'};
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
function payload(j){return j&&(j.payload||j)||{};}function items(j){let a=payload(j).items;return Array.isArray(a)?a.filter(Boolean):[];}function page(){if(document.body&&document.body.dataset&&document.body.dataset.gmaoDetached==='1')return 'DETACHED';if(location.hostname==='cart.coupang.com')return'CART';if(location.hostname==='checkout.coupang.com')return'CHECKOUT';if(location.hostname==='login.coupang.com')return'AUTH';if(location.hostname==='id.coupang.com')return'ADDRESS';if(/\/vp\/products\//.test(location.pathname))return'PRODUCT';return'COUPANG';}
function uuid(){return crypto&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);}function clientId(){let x=GM_getValue(STORE.client,'');if(!x){x='PC-RUNNER-'+uuid();GM_setValue(STORE.client,x);}return x;}
function blocked(){let t=(document.title||'')+' '+String(document.body&&document.body.innerText||'').slice(0,6000);return /Access Denied|You don't have permission to access|errors\.edgesuite\.net/i.test(t);}
function settings(extra){return Object.assign({client_id:clientId(),client_type:'PC_RUNNER',admin_id:GM_getValue('gmao_admin_id','derzon'),mall_account_id:GM_getValue('gmao_mall_account_id','CPKR_MASTER'),mall_code:'CPKR',cpkr_ready:true,app_version:VERSION,current_url:location.href,page_type:page(),current_work_id:job?job.work_id:null,state:{stage:flow().stage||'',page_type:page()},device:{platform:'tampermonkey',userAgent:navigator.userAgent}},extra||{});}
function req(path,method,body){return new Promise((ok,bad)=>GM_xmlhttpRequest({method:method||'GET',url:API+path,headers:{'Content-Type':'application/json'},data:body?JSON.stringify(body):undefined,timeout:15000,onload:r=>{let x={};try{x=r.responseText?JSON.parse(r.responseText):{};}catch(_e){bad(new Error('NON_JSON_'+r.status));return;}if(r.status<200||r.status>=300||x.ok===false){bad(new Error(x.detail||x.error||'HTTP_'+r.status));return;}ok(x);},onerror:()=>bad(new Error('NETWORK_ERROR')),ontimeout:()=>bad(new Error('REQUEST_TIMEOUT'))}));}
const loaded=new Map();function load(url,ready,label){if(ready())return Promise.resolve();if(loaded.has(url))return loaded.get(url);let p=new Promise((ok,bad)=>GM_xmlhttpRequest({method:'GET',url:url,timeout:12000,onload:r=>{try{new Function('window','document',r.responseText+'\n//# sourceURL='+url)(window,document);}catch(e){bad(new Error(label+'_EXEC:'+e.message));return;}ready()?ok():bad(new Error(label+'_NOT_READY'));},onerror:()=>bad(new Error(label+'_LOAD_ERROR')),ontimeout:()=>bad(new Error(label+'_TIMEOUT'))}));loaded.set(url,p);p.catch(()=>loaded.delete(url));return p;}
function loadProduct(){return load(URLS.product,()=>!!(window.CPKR_PRODUCT&&window.CPKR_PRODUCT.run),'PRODUCT');}function loadCart(){return load(URLS.cart,()=>!!(window.CPKR_CART&&window.CPKR_CART.snapshot),'CART');}async function loadCheckout(){await load(URLS.util,()=>!!window.GMAO_UTIL,'UTIL');return load(URLS.checkout,()=>!!window.CPKR_CHECKOUT,'CHECKOUT');}
function wipeAndGo(url,label){if(!url)throw new Error('NEXT_URL_MISSING');try{window.stop();document.open();document.write('<!doctype html><title>Glomart transition</title><body></body>');document.close();}catch(_e){}setTimeout(()=>location.replace(url),500);}

function detachToBlank(reason){
  // Tampermonkey cannot bootstrap this userscript on a newly navigated about:blank.
  // Stop the Coupang document, remove its DOM, and mark an inert detached shell.
  // No Coupang DOM is available to subsequent comparison code.
  try{window.stop();}catch(_e){}
  try{document.documentElement.innerHTML='<html><head><title>Glomart Detached</title></head><body></body></html>';}catch(_e){}
  try{document.body.dataset.gmaoDetached='1';}catch(_e){}
  try{history.replaceState({gmaoDetached:true},'',location.href);}catch(_e){}
  render('쿠팡 DOM 분리 완료 · '+String(reason||''));
  setTimeout(()=>orchestrate().catch(fail),120);
}
function cartUrl(){return'https://cart.coupang.com/cartView.pang';}
function panel(){let p=document.getElementById('gmao-runner-v068');if(p)return p;p=document.createElement('div');p.id='gmao-runner-v068';p.style.cssText='position:fixed;right:12px;bottom:12px;z-index:2147483647;width:300px;background:#111827;color:#d1fae5;border:1px solid #334155;border-radius:10px;padding:10px;font:12px/1.45 Arial,sans-serif;box-shadow:0 4px 18px #0005';document.documentElement.appendChild(p);return p;}
function button(t,fn,danger){let b=document.createElement('button');b.textContent=t;b.style.cssText='border:0;border-radius:5px;padding:7px 9px;margin:6px 4px 0 0;color:#fff;font-weight:700;background:'+(danger?'#c9382b':'#1463d6');b.onclick=fn;return b;}
function render(msg,err){let p=panel(),f=flow();p.innerHTML='<b>Glomart Runner V068</b><div style="margin-top:5px;white-space:pre-wrap;color:'+(err?'#fecaca':'#d1fae5')+'">'+String(msg||'')+'</div><div style="margin-top:5px;color:#93c5fd">단계='+String(f.stage||'-')+' · PAGE='+page()+'</div>';if(!job)p.appendChild(button('작업 가져오기',()=>claim().catch(fail)));if(job)p.appendChild(button('현재 단계 재개',()=>orchestrate().catch(fail)));if(job)p.appendChild(button('작업 반환',()=>release().catch(fail),true));}
function clearLocal(){
  job=null;
  GM_setValue(STORE.job,null);
  for(const key of LEGACY_JOB_KEYS)GM_setValue(key,null);
  GM_setValue(STORE.flow,null);
  clearInterval(workTimer);
  workTimer=null;
}
function errCode(e){return String(e&&e.message||e||'').trim();}
async function fail(e){
  const code=errCode(e);
  const st=flow().stage||'';

  if(STALE.has(code)){
    clearLocal();
    render('서버에서 현재 작업이 종료된 것을 확인했습니다.\n'+code+'\n로컬 작업만 정리했습니다.',true);
    return;
  }

  if(/COUPANG_ACCESS_DENIED/.test(code)||blocked()){
    setFlow({stage:ST.BLOCKED,failure_reason:'COUPANG_ACCESS_DENIED',last_error:code});
    setBatch({cart_cleaned:false});
    render('쿠팡 접근 차단 감지 · 현재 작업/단계 보존\n'+code,true);
    return;
  }

  // During development/testing an execution error must NOT throw away the
  // claimed work. Keep work_id, lock_token and exact stage for inspection/retry.
  setFlow({last_error:code,error_stage:st,error_page:page(),error_at:Date.now()});
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
      render('기존 로컬 작업은 서버에서 종료됨\n'+stale+'\n새 작업을 요청합니다.');
    }
  }

  render('작업 배정 요청 중…');
  const r=await req('/api/auto-order/runtime/claim','POST',settings());
  if(!r.job){
    render('배정 가능한 작업 없음\n'+(r.reason||'queue_empty'));
    return null;
  }

  job=r.job;
  GM_setValue(STORE.job,job);
  startWorkTimer();

  // A newly claimed work is the first work of a new continuous run from
  // the Runner's point of view. Cart state must be inspected before product work.
  GM_setValue(STORE.batch,null);
  setBatch({
    cart_cleaned:false,
    session_id:'S-'+Date.now(),
    session_started_at:Date.now()
  });
  setFlow({
    work_id:job.work_id,
    stage:ST.BATCH_SCAN,
    item_index:0,
    repair_index:0,
    cart_snapshot:null,
    cart_plan:null,
    final_verify:false,
    last_error:null
  });

  render(
    '작업 배정 완료 #'+job.work_id+'\n'+
    String(job.auto_order_no||'')+'\n'+
    '장바구니 확인/청소부터 시작'
  );
  setTimeout(()=>orchestrate().catch(fail),300);
  return job;
}
async function release(){if(!job)return;let j=job;try{await req('/api/auto-order/runtime/work/'+encodeURIComponent(j.work_id)+'/release','POST',settings({lock_token:j.lock_token}));}finally{clearLocal();render('작업 반환 완료');}}
function itemUrl(item){return window.CPKR_PRODUCT.canonicalUrl(item);}function currentItem(){let a=items(job),i=Math.max(0,Number(flow().item_index||0));return a[i]||null;}
async function startOrder(){await loadProduct();let a=items(job);if(!a.length)throw new Error('ORDER_ITEM_EMPTY');let st=a.length===1?ST.SINGLE:ST.MULTI_PRODUCT;setFlow({stage:st,item_index:0});let u=itemUrl(a[0]);if(!u)throw new Error('CPKR_PUID_MISSING');render(a.length===1?'단건: 바로구매로 진행':'다건: 상품을 순서대로 장바구니에 담기');wipeAndGo(u,'ORDER_START');}
async function runProduct(mode){await guard();await loadProduct();let item=currentItem();if(!item)throw new Error('PRODUCT_ITEM_MISSING');let result=await window.CPKR_PRODUCT.run(item,mode,typeof unsafeWindow!=='undefined'?unsafeWindow:window);render((mode==='SINGLE'?'단건 바로구매 클릭':'다건 장바구니 담기 클릭')+'\nPUID='+result.inspection.current_puid+'\n수량='+result.quantity.after);return result;}
async function runSingle(){if(page()!=='PRODUCT'){await loadProduct();let u=itemUrl(currentItem());wipeAndGo(u,'SINGLE');return;}await runProduct('SINGLE');setFlow({stage:ST.CHECKOUT_PENDING,checkout_source:'SINGLE',checkout_clicked_at:Date.now()});setTimeout(()=>orchestrate().catch(fail),1200);}
async function runMultiProduct(){let a=items(job),f=flow(),idx=Math.max(0,Number(f.item_index||0));if(idx>=a.length){setFlow({stage:ST.MULTI_SNAPSHOT});wipeAndGo(cartUrl(),'MULTI_SNAPSHOT');return;}if(page()!=='PRODUCT'){await loadProduct();let u=itemUrl(a[idx]);if(!u)throw new Error('CPKR_PUID_MISSING');wipeAndGo(u,'MULTI_PRODUCT_'+idx);return;}await runProduct('MULTI');idx++;setFlow({item_index:idx});if(idx<a.length){let u=itemUrl(a[idx]);wipeAndGo(u,'MULTI_NEXT');}else{setFlow({stage:ST.MULTI_SNAPSHOT});wipeAndGo(cartUrl(),'MULTI_SNAPSHOT');}}
async function snapshotAndDetach(finalPass){
  if(page()!=='CART'){
    wipeAndGo(cartUrl(),'CART_SNAPSHOT');
    return;
  }

  await loadCart();

  // CART DOM is read exactly once.  Everything needed for comparison must
  // be serialized before leaving Coupang.
  const snap=window.CPKR_CART.snapshot();
  if(!snap||!Array.isArray(snap.rows))throw new Error('CART_SNAPSHOT_INVALID');

  setFlow({
    stage:ST.MULTI_COMPARE,
    cart_snapshot:snap,
    final_verify:!!finalPass,
    detached_compare_pending:true
  });

  render('장바구니 DOM 확보 완료 · 쿠팡 페이지 분리 후 주문과 비교');

  // Do NOT compare while Coupang CART DOM/runtime is alive.
  detachToBlank('CART_COMPARE_DETACHED');
}
async function compareDetached(){
  if(page()!=='DETACHED')throw new Error('CART_COMPARE_NOT_DETACHED');
  const f=flow();
  const snap=f.cart_snapshot;

  if(!snap||!Array.isArray(snap.rows))throw new Error('CART_SNAPSHOT_MISSING');

  // Comparison is pure data work. CPKR_CART.compare() does not need a live
  // Coupang DOM, but the module may need to be loaded into the userscript
  // sandbox first.
  await loadCart();

  const plan=window.CPKR_CART.compare(items(job),snap);
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
    const reason=window.CPKR_CART.describePlan
      ? window.CPKR_CART.describePlan(plan)
      : JSON.stringify(plan);
    throw new Error('CART_FINAL_MISMATCH '+reason);
  }

  setFlow({stage:ST.MULTI_ADJUST});
  render('장바구니 불일치 · 1회 보정 준비');
  wipeAndGo(cartUrl(),'CART_ADJUST');
}
async function adjustOnce(){if(page()!=='CART'){wipeAndGo(cartUrl(),'MULTI_ADJUST');return;}await guard();await loadCart();let plan=flow().cart_plan;if(!plan)throw new Error('CART_PLAN_MISSING');let r=await window.CPKR_CART.applyAdjustments(plan,typeof unsafeWindow!=='undefined'?unsafeWindow:window);let miss=plan.missing||[];if(miss.length){setFlow({stage:ST.MULTI_REPAIR,repair_index:0,repair_missing:miss});await loadProduct();let u=itemUrl(miss[0].item);wipeAndGo(u,'MULTI_REPAIR');return;}setFlow({stage:ST.MULTI_FINAL_SNAPSHOT});wipeAndGo(cartUrl(),'MULTI_FINAL_SNAPSHOT');}
async function repairMissing(){let f=flow(),m=Array.isArray(f.repair_missing)?f.repair_missing:[],i=Math.max(0,Number(f.repair_index||0));if(i>=m.length){setFlow({stage:ST.MULTI_FINAL_SNAPSHOT});wipeAndGo(cartUrl(),'MULTI_FINAL_SNAPSHOT');return;}let item=m[i].item;if(page()!=='PRODUCT'){await loadProduct();wipeAndGo(itemUrl(item),'MULTI_REPAIR_'+i);return;}await guard();await loadProduct();let r=await window.CPKR_PRODUCT.run(item,'MULTI',typeof unsafeWindow!=='undefined'?unsafeWindow:window);render('누락상품 1회 추가\nPUID='+r.inspection.current_puid);i++;setFlow({repair_index:i});if(i<m.length)wipeAndGo(itemUrl(m[i].item),'MULTI_REPAIR_NEXT');else{setFlow({stage:ST.MULTI_FINAL_SNAPSHOT});wipeAndGo(cartUrl(),'MULTI_FINAL_SNAPSHOT');}}
async function multiCheckout(){if(page()!=='CART'){wipeAndGo(cartUrl(),'MULTI_CHECKOUT');return;}await guard();await loadCart();await window.CPKR_CART.selectAllAndCheckout();setFlow({stage:ST.CHECKOUT_PENDING,checkout_source:'MULTI',checkout_clicked_at:Date.now()});setTimeout(()=>orchestrate().catch(fail),1200);}
async function checkoutPending(){let p=page();if(p==='CHECKOUT'){setFlow({stage:ST.CHECKOUT});await checkout();return;}if(p==='AUTH'){await auth();return;}let f=flow(),age=Date.now()-Number(f.checkout_clicked_at||0);if(age<5000){setTimeout(()=>orchestrate().catch(fail),700);return;}throw new Error('CHECKOUT_NAVIGATION_FAILED source='+(f.checkout_source||'?')+' page='+p);}
async function batchScan(){await loadCart();let c=window.CPKR_CART.headerCount();if(c===0){setBatch({cart_cleaned:true,cleaned_at:Date.now(),method:'header-zero'});setFlow({stage:ST.ORDER_START});await startOrder();return;}if(c!=null&&c>0){setFlow({stage:ST.BATCH_CLEAR});wipeAndGo(cartUrl(),'BATCH_CLEAR');return;}if(page()!=='CART'){wipeAndGo(cartUrl(),'BATCH_SCAN_FALLBACK');return;}let snap=window.CPKR_CART.snapshot();if(!snap.length){setBatch({cart_cleaned:true,cleaned_at:Date.now(),method:'cart-empty'});setFlow({stage:ST.ORDER_START});await startOrder();return;}setFlow({stage:ST.BATCH_CLEAR});await batchClear();}
async function batchClear(){if(page()!=='CART'){wipeAndGo(cartUrl(),'BATCH_CLEAR');return;}await guard();await loadCart();let r=await window.CPKR_CART.clearAll(typeof unsafeWindow!=='undefined'?unsafeWindow:window);setBatch({cart_cleaned:true,cleaned_at:Date.now(),method:'bulk-clear',deleted:r.count||0});setFlow({stage:ST.ORDER_START});render('장바구니 청소 완료 · 주문 계속');await startOrder();}
function nativeInputValue(input,value){let proto=input instanceof HTMLInputElement?HTMLInputElement.prototype:null,desc=proto&&Object.getOwnPropertyDescriptor(proto,'value');if(desc&&desc.set)desc.set.call(input,String(value==null?'':value));else input.value=String(value==null?'':value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}
function passwordMethodButton(){return Array.from(document.querySelectorAll('button,a,[role="button"],div')).find(el=>{if(!el||!el.getBoundingClientRect)return false;let r=el.getBoundingClientRect();if(r.width<=0||r.height<=0)return false;let t=String(el.textContent||'').replace(/\s+/g,' ').trim();return /비밀번호\s*확인/.test(t)&&t.length<80;})||null;}
async function auth(){if(!job||page()!=='AUTH')return false;let input=document.querySelector('#auth-password-input,input[name="password"][type="password"]');if(!input){let b=passwordMethodButton();if(b){GM_setValue('gmao_runner_auth_status_v023',{state:'PASSWORD_METHOD_SELECTED',ts:Date.now()});render('쿠팡 추가인증 감지\n비밀번호 확인 방식을 선택합니다.');b.click();return true;}return false;}await guard();let x=await req('/api/auto-order/runtime/work/'+encodeURIComponent(job.work_id)+'/credential','POST',settings({lock_token:job.lock_token})),c=x&&x.credential||{};if(!c.password)throw new Error('CPKR_MASTER 비밀번호가 컨트롤타워에 등록되지 않았습니다.');GM_setValue('gmao_runner_auth_status_v023',{state:'PASSWORD_FILLING',ts:Date.now()});render('쿠팡 추가인증 감지\nCPKR_MASTER 비밀번호를 자동 입력합니다.');nativeInputValue(input,c.password);c.password='';await new Promise(r=>setTimeout(r,250));let submit=document.querySelector('button[type="submit"].authentication-password__submit-btn,button[type="submit"]');if(!submit)throw new Error('쿠팡 추가인증 계속하기 버튼을 찾지 못했습니다.');if(submit.disabled){input.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,key:'a'}));await new Promise(r=>setTimeout(r,200));}GM_setValue('gmao_runner_auth_status_v023',{state:'PASSWORD_SUBMITTED',ts:Date.now()});submit.click();return true;}
function setBridge(x){GM_setValue(STORE.bridge,Object.assign({ts:Date.now()},x||{}));}function getBridge(){return GM_getValue(STORE.bridge,null);}async function waitBridge(workId,ms){let t=Date.now();while(Date.now()-t<(ms||90000)){let x=getBridge();if(x&&String(x.work_id)===String(workId)){if(x.state==='DONE')return x;if(x.state==='ERROR')throw new Error(x.error||'ADDRESS_BRIDGE_ERROR');}await new Promise(r=>setTimeout(r,250));}throw new Error('ADDRESS_BRIDGE_TIMEOUT');}
async function addressFrame(){if(location.hostname!=='id.coupang.com'||!/^\/addressbook\//.test(location.pathname))return false;let b=null,t=Date.now();while(Date.now()-t<300000){let x=getBridge();if(x&&x.state==='REQUESTED'&&x.receiver){b=x;break;}await new Promise(r=>setTimeout(r,250));}if(!b)return true;try{await loadCheckout();setBridge(Object.assign({},b,{state:'RUNNING'}));let r=await window.CPKR_CHECKOUT.fillAddressOnly(b.receiver,null,{action:b.action||'ADD',current_address_text:b.current_address_text||''});setBridge(Object.assign({},b,{state:'DONE',result:r||{ok:true}}));}catch(e){setBridge(Object.assign({},b,{state:'ERROR',error:errCode(e)}));}return true;}
async function checkout(){if(page()!=='CHECKOUT')return;await guard();await loadCheckout();let p=payload(job),receiver=p.receiver||{};if(!receiver.name||!receiver.phone||!receiver.zipcode||!receiver.road_address)throw new Error('RECEIVER_PAYLOAD_INCOMPLETE');let order=Object.assign({},p.order||{},{receiver:receiver,shipping:receiver,address:receiver}),plan=window.CPKR_CHECKOUT.inspectAddress(order);if(plan.action!=='KEEP')setBridge({state:'REQUESTED',work_id:job.work_id,auto_order_no:job.auto_order_no,action:plan.action,current_address_text:plan.current_text||'',receiver:receiver});let r=await window.CPKR_CHECKOUT.fillAndStop(order,{addressPlan:plan,onProgress:x=>render('배송지 처리\n'+x),waitForAddressBridge:()=>waitBridge(job.work_id,90000)});await req('/api/auto-order/runtime/work/'+encodeURIComponent(job.work_id)+'/state','POST',settings({lock_token:job.lock_token,status:'STOPPED_BEFORE_PAYMENT',detail:{phase:'CHECKOUT_STOPPED_BEFORE_PAYMENT',address_branch:plan.branch,address_action:(r&&r.address_result&&r.address_result.action)||plan.action}}));setFlow({stage:ST.STOPPED});clearInterval(workTimer);workTimer=null;GM_setValue(STORE.job,null);job=null;render('결제하기 직전 정지 완료');}
async function orchestrate(){if(busy||!job)return;if(blocked()){await fail(new Error('COUPANG_ACCESS_DENIED'));return;}busy=true;try{let f=flow(),s=f.stage||ST.BATCH_SCAN;if(page()==='AUTH'){await auth();return;}if(s===ST.BATCH_SCAN)await batchScan();else if(s===ST.BATCH_CLEAR)await batchClear();else if(s===ST.ORDER_START)await startOrder();else if(s===ST.SINGLE)await runSingle();else if(s===ST.MULTI_PRODUCT)await runMultiProduct();else if(s===ST.MULTI_SNAPSHOT)await snapshotAndDetach(false);else if(s===ST.MULTI_COMPARE)await compareDetached();else if(s===ST.MULTI_ADJUST)await adjustOnce();else if(s===ST.MULTI_REPAIR)await repairMissing();else if(s===ST.MULTI_FINAL_SNAPSHOT)await snapshotAndDetach(true);else if(s===ST.MULTI_CHECKOUT)await multiCheckout();else if(s===ST.CHECKOUT_PENDING)await checkoutPending();else if(s===ST.CHECKOUT)await checkout();else if(s===ST.STOPPED)render('결제 직전 정지 상태');else if(s===ST.FAILED)render('실패 기록 완료 · 다음 작업 대기',true);else if(s===ST.BLOCKED)render('쿠팡 접근 차단 상태',true);else throw new Error('UNKNOWN_STAGE:'+s);}finally{busy=false;}}
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

        let f=flow();
        if(String(f.work_id||'')!==String(job.work_id||'')||!validStageName(f.stage)){
          GM_setValue(STORE.batch,null);
          setBatch({cart_cleaned:false,session_id:'R-'+Date.now(),session_started_at:Date.now()});
          setFlow({
            work_id:job.work_id,
            stage:ST.BATCH_SCAN,
            item_index:0,
            repair_index:0,
            cart_snapshot:null,
            cart_plan:null,
            final_verify:false,
            last_error:null
          });
          render('기존 작업 복구 #'+job.work_id+'\n진행상태 연결 없음 → 장바구니 확인부터 안전 복구');
        }else{
          render('기존 작업 복구 #'+job.work_id+'\n단계='+f.stage);
        }
        setTimeout(()=>orchestrate().catch(fail),350);
      }catch(e){
        if(STALE.has(errCode(e))){clearLocal();render('오래된 작업 자동 정리');}
        else throw e;
      }
    }else render('온라인 · 작업 배정 대기');
  }catch(e){await fail(e);}
}
start();
})();
