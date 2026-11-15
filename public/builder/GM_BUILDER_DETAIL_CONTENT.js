// GM_DETAIL_CONTENT_BUILDER_UI_V004 - admin-only IndexedDB completed-job history; tree and collector unchanged.
(()=>{'use strict';
const $=id=>document.getElementById(id),API='/api/gm/builder/detail-content';
let cats=[],selected=new Set(),expanded=new Set(),nodes=new Map(),roots=[],interval=null;
function clean(v){return String(v==null?'':v).trim().toUpperCase();}
function msg(v){if($('gmDcProgress'))$('gmDcProgress').textContent=String(v);}
async function api(path,opts={}){const r=await fetch(API+path,Object.assign({credentials:'same-origin'},opts));const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||('HTTP '+r.status));return d;}
// IndexedDB belongs only to this Builder page and the current browser profile/origin.
// The server is authoritative for in-progress jobs; only terminal job snapshots are archived here.
const HISTORY_DB='GM_BUILDER_DETAIL_CONTENT_HISTORY_V1', HISTORY_STORE='completed_jobs';
let historyDbPromise=null,historyLastSignature='';
function historyOpen(){
 if(historyDbPromise)return historyDbPromise;
 historyDbPromise=new Promise((resolve,reject)=>{
  if(!window.indexedDB)return reject(Error('INDEXEDDB_UNAVAILABLE'));
  const request=indexedDB.open(HISTORY_DB,1);
  request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(HISTORY_STORE))db.createObjectStore(HISTORY_STORE,{keyPath:'job_id'});};
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error||Error('INDEXEDDB_OPEN_FAILED'));
  request.onblocked=()=>reject(Error('INDEXEDDB_BLOCKED'));
 }).catch(e=>{historyDbPromise=null;throw e;});
 return historyDbPromise;
}
function historyDate(v){
 if(!v)return '-';const date=new Date(v);if(!Number.isFinite(date.getTime()))return '-';
 return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(date)+' KST';
}
function historyNumber(v){return Math.max(0,Math.trunc(Number(v)||0));}
function historyPanel(){
 if($('gmDcHistory'))return;
 const anchor=$('gmDcProgress')||$('gmDcTree');if(!anchor||!anchor.parentNode)return;
 const section=document.createElement('section');section.id='gmDcHistory';section.style.cssText='margin:16px 0;padding:12px;border:1px solid #d8dee8;border-radius:8px;background:#fff';
 const heading=document.createElement('h3');heading.style.cssText='margin:0 0 8px;font-size:15px';heading.textContent='이 PC 관리자 브라우저 · 수집 작업 완료 기록';section.appendChild(heading);
 const summary=document.createElement('div');summary.id='gmDcHistorySummary';summary.style.cssText='font-size:12px;color:#475569;margin-bottom:8px';summary.textContent='IndexedDB 기록 조회 중…';section.appendChild(summary);
 const outer=document.createElement('div');outer.style.cssText='overflow-x:auto;max-height:280px;overflow-y:auto';
 const table=document.createElement('table');table.style.cssText='width:100%;font-size:12px;border-collapse:collapse';
 const head=document.createElement('thead');const tr=document.createElement('tr');
 for(const title of ['작업 종료일시 (KST)','결과','처리','저장','실패','제외']){const th=document.createElement('th');th.textContent=title;th.style.cssText='padding:5px;text-align:left;border-bottom:1px solid #ddd;white-space:nowrap';tr.appendChild(th);}head.appendChild(tr);table.appendChild(head);
 const body=document.createElement('tbody');body.id='gmDcHistoryRows';table.appendChild(body);outer.appendChild(table);section.appendChild(outer);
 const note=document.createElement('div');note.style.cssText='font-size:11px;color:#64748b;margin-top:8px';note.textContent='관리자 빌더에서만 사용 · 이 브라우저/도메인의 IndexedDB에 보존 · 다른 PC와 자동 동기화되지 않음';section.appendChild(note);
 anchor.parentNode.insertBefore(section,anchor.nextSibling);
}
async function historyRefresh(){
 historyPanel();const summary=$('gmDcHistorySummary'),body=$('gmDcHistoryRows');if(!summary||!body)return;
 try{
  const db=await historyOpen();const rows=await new Promise((resolve,reject)=>{
   const tx=db.transaction(HISTORY_STORE,'readonly'),req=tx.objectStore(HISTORY_STORE).getAll();
   req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error||Error('INDEXEDDB_READ_FAILED'));
  });
  rows.sort((a,b)=>String(b.finished_at).localeCompare(String(a.finished_at)));
  body.replaceChildren();
  for(const rec of rows.slice(0,30)){
   const tr=document.createElement('tr');
   for(const value of [historyDate(rec.finished_at),rec.state,rec.seen,rec.saved,rec.failed,rec.skipped]){
    const td=document.createElement('td');td.textContent=String(value);td.style.cssText='padding:5px;border-bottom:1px solid #eee;white-space:nowrap';tr.appendChild(td);
   }body.appendChild(tr);
  }
  const total=rows.reduce((n,x)=>n+historyNumber(x.saved),0);
  summary.textContent='기록 '+rows.length.toLocaleString()+'회 · 누적 저장 '+total.toLocaleString()+'건 · 최근 30회 표시';
 }catch(e){summary.textContent='로컬 IndexedDB 기록을 사용할 수 없음: '+String(e.message||e);}
}
async function historyRecord(job){
 if(!job||!['completed','stopped','error'].includes(job.state)||job.id==null||!job.finished_at)return;
 const rec={job_id:String(job.id),state:String(job.state),started_at:String(job.started_at||''),finished_at:String(job.finished_at),seen:historyNumber(job.seen),saved:historyNumber(job.saved),failed:historyNumber(job.failed),skipped:historyNumber(job.skipped),last_pid:String(job.last_pid||''),mall_code:String(job.mall_code||'CPKR')};
 const signature=JSON.stringify(rec);if(signature===historyLastSignature)return;
 try{
  const db=await historyOpen();await new Promise((resolve,reject)=>{
   const tx=db.transaction(HISTORY_STORE,'readwrite');tx.objectStore(HISTORY_STORE).put(rec);
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||Error('INDEXEDDB_WRITE_FAILED'));
   tx.onabort=()=>reject(tx.error||Error('INDEXEDDB_WRITE_ABORTED'));
  });
  historyLastSignature=signature;await historyRefresh();
 }catch(e){const summary=$('gmDcHistorySummary');if(summary)summary.textContent='작업 완료 기록 저장 실패: '+String(e.message||e);}
}
// Mirror routes/category_menu.js: category hierarchy is derived from GM code segments,
// not gm_parent_code (which may be missing or inconsistent in historical rows).
function parentCandidates(code){
 const parts=clean(code).split('-');if(parts.length<5||parts.length>6)return [];
 const answer=[];
 for(let i=parts.length-1;i>=1;i--){
   if(!/^0+$/.test(parts[i])){
     const a=parts.slice();for(let j=i;j<a.length;j++)a[j]='0'.repeat(a[j].length);
     const candidate=a.join('-');if(candidate!==code&&!answer.includes(candidate))answer.push(candidate);
   }
 }
 return answer;
}
function rebuildTree(rows){
 nodes=new Map();roots=[];
 for(const c of rows){const code=clean(c.gm_code);if(!code||nodes.has(code))continue;
   nodes.set(code,{...c,code,parent:'',children:[],name:String(c.name_ko||code),order:Number(c.sort_order)||0});}
 for(const n of nodes.values()){
   // Prefer GM code lineage to match the production category menu.
   const parent=parentCandidates(n.code).find(p=>nodes.has(p))||'';
   const fallback=clean(n.gm_parent_code);
   n.parent=parent||(fallback!==n.code&&nodes.has(fallback)?fallback:'');
   if(n.parent)nodes.get(n.parent).children.push(n);else roots.push(n);
 }
 const sort=(a,b)=>a.order-b.order||a.name.localeCompare(b.name,'ko')||a.code.localeCompare(b.code);
 roots.sort(sort);for(const n of nodes.values())n.children.sort(sort);
}
function allDescendants(code){const result=[];const stack=[nodes.get(code)];const seen=new Set();
 while(stack.length){const n=stack.pop();if(!n||seen.has(n.code))continue;seen.add(n.code);result.push(n.code);for(const child of n.children)stack.push(child);}return result;}
function countSelected(n){let total=0,marked=0;const stack=[n],seen=new Set();while(stack.length){const v=stack.pop();if(!v||seen.has(v.code))continue;seen.add(v.code);total++;if(selected.has(v.code))marked++;for(const c of v.children)stack.push(c);}return {total,marked};}
function render(){const host=$('gmDcTree');if(!host)return;host.replaceChildren();
 const kw=String($('gmDcFilter')?.value||'').trim().toLowerCase();
 const visible=new Set(),forcedOpen=new Set();
 if(kw){for(const n of nodes.values()){
   if(!n.name.toLowerCase().includes(kw)&&!n.code.toLowerCase().includes(kw))continue;
   const seen=new Set();let cur=n;
   while(cur&&!seen.has(cur.code)){seen.add(cur.code);visible.add(cur.code);if(cur!==n)forcedOpen.add(cur.code);cur=nodes.get(cur.parent);}
 }}
 const line=(n,indent,index)=>{
   if(kw&&!visible.has(n.code))return;
   const row=document.createElement('div');row.style.cssText='display:flex;flex-direction:row;align-items:center;gap:7px;min-height:31px;width:100%;box-sizing:border-box;padding:2px 4px 2px '+(6+indent*21)+'px;border-bottom:1px solid #f3f4f6';
   const open=expanded.has(n.code)||forcedOpen.has(n.code);
   const arrow=document.createElement('button');arrow.type='button';arrow.style.cssText='display:inline-flex;align-items:center;justify-content:center;width:25px;min-width:25px;max-width:25px;height:25px;flex:0 0 25px;padding:0;margin:0;background:transparent;color:#334155;border:0;cursor:pointer;font-size:16px';
   arrow.textContent=n.children.length?(open?'▾':'▸'):'·';arrow.disabled=!n.children.length;
   arrow.title=n.children.length?(open?'하위 접기':'하위 펼치기'):'하위 카테고리 없음';
   arrow.addEventListener('click',()=>{if(expanded.has(n.code))expanded.delete(n.code);else expanded.add(n.code);render();});row.appendChild(arrow);
   const check=document.createElement('input');check.type='checkbox';check.style.cssText='display:block;appearance:auto;width:16px;min-width:16px;max-width:16px;height:16px;min-height:16px;max-height:16px;flex:0 0 16px;padding:0;margin:0;box-sizing:border-box';
   const counts=countSelected(n);check.checked=counts.marked===counts.total;check.indeterminate=counts.marked>0&&counts.marked<counts.total;
   check.title='이 항목과 하위 모든 카테고리 선택/해제';check.addEventListener('change',()=>{
     for(const id of allDescendants(n.code)){if(check.checked)selected.add(id);else selected.delete(id);}render();});row.appendChild(check);
   const text=document.createElement('span');text.style.cssText='display:inline-block;flex:1 1 auto;min-width:0;width:auto;font-size:13px;line-height:1.5;color:#202c3b;cursor:pointer;overflow-wrap:anywhere';
   const number=document.createElement('strong');number.textContent=index+' ';number.style.color='#2563eb';
   text.appendChild(number);text.append(document.createTextNode(n.name+' ('+n.code+')'));
   text.addEventListener('click',()=>{if(n.children.length){if(expanded.has(n.code))expanded.delete(n.code);else expanded.add(n.code);render();}});
   row.appendChild(text);host.appendChild(row);
   if(open){n.children.forEach((child,i)=>line(child,indent+1,index+'.'+(i+1)));}
 };
 roots.forEach((n,i)=>line(n,0,String(i+1)));
 if(!host.childNodes.length)host.textContent=kw?'검색 결과 없음':'카테고리 데이터 없음';
 const summary=$('gmDcTreeSummary');if(summary)summary.textContent='전체 '+nodes.size.toLocaleString()+'개 · 선택 '+selected.size.toLocaleString()+'개 · 최상위 '+roots.length+'개';
}
async function load(){try{const d=await api('/categories');cats=d.categories||[];rebuildTree(cats);
 selected=new Set([...selected].filter(id=>nodes.has(id)));render();msg('전체 카테고리 '+nodes.size+'개 · 선택 '+selected.size+'개');
 }catch(e){msg('카테고리 조회 실패: '+e.message);}}
// V008: browser-only collector controls, never invoke the retired server Chromium worker.
const CLIENT_API='/api/gm/detail-collector/';
let dcAccount='',dcRunning=false,dcStopped=false,dcProcessed=0,dcSaved=0,dcFailed=0,dcStartedAt='',dcLastPid='';
async function collectorApi(path,opts={}){
 const r=await fetch(CLIENT_API+path,Object.assign({credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}},opts));
 const ct=String(r.headers.get('content-type')||'').toLowerCase();
 if(!ct.includes('application/json'))throw Error('API '+path+' / HTTP '+r.status+' / JSON 대신 HTML 응답');
 const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||('HTTP '+r.status));return d;
}
function executor(){const x=window.GM_DETAIL_PC_EXECUTOR;return x&&typeof x.start==='function'&&typeof x.stop==='function'&&x.ready===true?x:null;}
function hasCollector(){return !!executor();}
function collectorStatusText(d){
 const stats=d?.statistics||{};
 return ['실행 방식: 관리자 PC Chrome (서버 Chromium 사용 안 함)',
 '로그인: '+(dcAccount||'필요'),
 'PC 수집 실행기: '+(hasCollector()?'연결됨':'미연결'),
 '상태: '+(dcRunning?'수집 중':dcStopped?'중지됨':'대기'),
 '선택 카테고리: '+selected.size,
 '처리: '+dcProcessed, '저장: '+dcSaved,'실패: '+dcFailed,
 '서버 전체 할당 이력: '+(stats.claims??'-'),
 '서버 활성 작업권: '+(stats.active??'-'),
 '서버 완료: '+(stats.complete??'-'),
 '마지막 PID: '+(dcLastPid||'-'),
 hasCollector()?'':'시작하려면 PC Chrome 수집 실행기 연결이 필요합니다.'].join('\n');
}
async function status(){
 if(dcRunning)return;
 try{const session=await collectorApi('session');dcAccount=session.authenticated?session.account:'';
  if(!dcAccount){msg('수집 전용 로그인이 필요합니다. 시작 버튼에서 로그인하세요.\nPC 수집 실행기: '+(hasCollector()?'연결됨':'미연결'));return;}
  const d=await collectorApi('status');msg(collectorStatusText(d));
 }catch(e){msg('PC 수집 상태 조회 실패: '+e.message);}
}
function collectorLogin(){return new Promise(resolve=>{
 const wrap=document.createElement('div');wrap.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:2147483000';
 const form=document.createElement('form');form.style.cssText='background:#fff;color:#111;padding:20px;border-radius:10px;width:min(390px,92vw);box-sizing:border-box;display:grid;gap:10px';
 const h=document.createElement('h3');h.textContent='상세 콘텐츠 수집 전용 로그인';h.style.margin='0';
 const account=document.createElement('select');account.style.cssText='padding:10px;width:100%';
 ['derzon','derzon1287','msoon'].forEach(id=>{const op=document.createElement('option');op.value=id;op.textContent=id;account.append(op);});
 const password=document.createElement('input');password.type='password';password.autocomplete='current-password';password.required=true;password.maxLength=256;password.placeholder='비밀번호';password.style.cssText='padding:10px;width:100%;box-sizing:border-box';
 const error=document.createElement('div');error.style.color='#b91c1c';error.setAttribute('role','alert');
 const btns=document.createElement('div');btns.style.cssText='display:flex;gap:10px';
 const cancel=document.createElement('button');cancel.type='button';cancel.textContent='취소';
 const submit=document.createElement('button');submit.type='submit';submit.textContent='인증 후 진행';
 btns.append(cancel,submit);form.append(h,account,password,error,btns);wrap.append(form);document.body.append(wrap);
 let settled=false;function done(v){if(settled)return;settled=true;password.value='';wrap.remove();resolve(v);}
 cancel.onclick=()=>done(false);
 form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;error.textContent='';
  const pw=password.value;password.value='';
  try{await collectorApi('login',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({account:account.value,password:pw})});dcAccount=account.value;done(true);}
  catch(err){error.textContent='인증 실패: '+err.message;submit.disabled=false;}
 };
 password.focus();
 });}
async function ensureLogin(){
 const session=await collectorApi('session');if(session.authenticated&&session.account){dcAccount=session.account;return true;}
 dcAccount='';return collectorLogin();
}
async function startClient(){
 if(dcRunning){msg('이 PC에서 이미 수집 중입니다.');return;}
 if(!selected.size){msg('먼저 카테고리를 선택하세요.');return;}
 try{
  if(!await ensureLogin()){msg('수집 로그인이 취소되었습니다.');return;}
  // Refuse to claim products before a browser-side collector actually exists.
  const x=executor();if(!x){msg('로그인: '+dcAccount+'\nPC 수집 실행기 미연결: 기존 서버 Chromium 수집은 호출하지 않습니다.\n브라우저 실행기를 연결해야 수집을 시작할 수 있습니다.');return;}
  dcStopped=false;dcRunning=true;dcProcessed=0;dcSaved=0;dcFailed=0;dcLastPid='';dcStartedAt=new Date().toISOString();
  msg('이 PC의 수집 실행기에 작업을 전달했습니다.');
  const maxItems=Math.max(1,Math.min(10000,Number($('gmDcMax')?.value)||50));
  await x.start({category_codes:[...selected],max_items:maxItems,skip_saved:!!$('gmDcSkip')?.checked,
   api_root:CLIENT_API,account:dcAccount,
   onProgress:state=>{if(!dcRunning)return;dcProcessed=Number(state?.processed)||0;dcSaved=Number(state?.saved)||0;dcFailed=Number(state?.failed)||0;dcLastPid=String(state?.last_pid||'');msg(['로그인: '+dcAccount,'PC 수집 진행 중','처리: '+dcProcessed+' / '+maxItems,'저장: '+dcSaved,'실패: '+dcFailed,'마지막 PID: '+(dcLastPid||'-')].join('\n'));},
   onFinished:async state=>{dcRunning=false;dcStopped=!!state?.stopped;await historyRecord({id:'pc-'+Date.now(),state:dcStopped?'stopped':state?.error?'error':'completed',started_at:dcStartedAt,finished_at:new Date().toISOString(),seen:dcProcessed,saved:dcSaved,failed:dcFailed,skipped:Number(state?.skipped)||0,last_pid:dcLastPid,mall_code:'CPKR'});await status();}});
 }catch(e){dcRunning=false;msg('PC 수집 시작 실패: '+e.message);}
}
async function stopClient(){
 if(!dcRunning){msg('이 PC에서 진행 중인 작업이 없습니다.');return;}
 const x=executor();if(!x){dcRunning=false;msg('수집 실행기 연결이 끊겼습니다.');return;}
 try{await x.stop();dcStopped=true;msg('이 PC에 수집 중지를 요청했습니다.');}
 catch(e){msg('수집 중지 실패: '+e.message);}
}
function init(){if(!$('gmDcTree'))return;
 const host=$('gmDcTree');const summary=document.createElement('div');summary.id='gmDcTreeSummary';summary.style.cssText='font-size:12px;color:#475569;margin:0 0 8px';host.parentNode.insertBefore(summary,host);
 $('gmDcFilter').addEventListener('input',render);$('gmDcRefresh').addEventListener('click',load);
 $('gmDcAll').addEventListener('click',()=>{selected=new Set(nodes.keys());render();});$('gmDcNone').addEventListener('click',()=>{selected.clear();render();});
 $('gmDcStatus').addEventListener('click',status);
 $('gmDcStart').addEventListener('click',startClient);
 $('gmDcStop').addEventListener('click',stopClient);
 historyPanel();void historyRefresh();load();status();interval=setInterval(()=>{if(!document.hidden&&$('gmDetailContentCard')?.style.display!=='none')status();},5000);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
