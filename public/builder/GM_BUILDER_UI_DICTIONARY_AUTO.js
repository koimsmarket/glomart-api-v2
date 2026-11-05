const API=location.origin;function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}function log(v){document.getElementById('log').textContent=typeof v==='string'?v:JSON.stringify(v,null,2);}// GM_UI_AUTO_V029: Reuse the existing server-side derzon admin login. No new auth bypass.
// One login dialog is shared by concurrent requests. Retry the original request only once.
let gmAdminLoginPending=null;
function gmAdminAuthRequired(r){
 if(r.status===401)return true;
 try{return r.redirected&&new URL(r.url).pathname==='/gm-admin-auth/login';}catch(_){return false;}
}
function gmAdminLoginDialog(){
 if(gmAdminLoginPending)return gmAdminLoginPending;
 const panel=document.getElementById('gmUiAdminLogin'),form=document.getElementById('gmUiAdminLoginForm');
 const password=document.getElementById('gmUiAdminPassword'),error=document.getElementById('gmUiAdminLoginError');
 const submit=document.getElementById('gmUiAdminLoginSubmit'),cancel=document.getElementById('gmUiAdminLoginCancel');
 gmAdminLoginPending=new Promise((resolve,reject)=>{
  let finished=false;
  const finish=(err)=>{
   if(finished)return;finished=true;form.removeEventListener('submit',onSubmit);cancel.removeEventListener('click',onCancel);
   password.value='';submit.disabled=false;const hint=document.getElementById('gmUiAdminPasswordHint');if(hint)hint.textContent='입력 대기';panel.hidden=true;panel.style.display='none';gmAdminLoginPending=null;
   if(err)reject(err);else resolve();
  };
  const onCancel=()=>finish(new Error('관리자 인증을 취소했습니다. 작업은 실행되지 않았습니다.'));
  const onSubmit=async(e)=>{
   e.preventDefault();if(finished)return;
   const p=password.value;if(!p)return;
   submit.disabled=true;error.textContent='관리자 인증 확인 중...';
   try{
    const r=await fetch('/gm-admin-auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',cache:'no-store',body:JSON.stringify({password:p})});
    password.value='';
    if(r.ok){error.textContent='관리자 인증 성공 · 요청 재실행 중';finish();return;}
    if(r.status===429)error.textContent='인증 시도가 제한되었습니다. 잠시 후 다시 인증해 주세요.';
    else if(r.status===401)error.textContent='관리자 비밀번호가 일치하지 않습니다.';
    else error.textContent='인증 실패 (HTTP '+r.status+').';
   }catch(_){error.textContent='서버 연결에 실패했습니다.';}
   finally{submit.disabled=false;if(!finished)password.focus();}
  };
  panel.hidden=false;panel.style.display='flex';error.textContent='관리자 세션이 만료되었습니다. 인증하면 요청했던 작업을 이어서 진행합니다.';
  form.addEventListener('submit',onSubmit);cancel.addEventListener('click',onCancel);password.focus();
 });
 return gmAdminLoginPending;
}
async function jfetch(u,o,retried){
 const r=await fetch(u,{...o,credentials:'same-origin'});
 if(gmAdminAuthRequired(r)){
  if(retried)throw new Error('인증 후에도 접근이 거부되었습니다. 관리자 세션을 확인해 주세요.');
  await gmAdminLoginDialog();return jfetch(u,o,true);
 }
 const ct=String(r.headers.get('content-type')||'');
 if(!ct.includes('json'))throw new Error('JSON 응답이 아닙니다 (HTTP '+r.status+').');
 const j=await r.json();if(!r.ok||j.ok===false)throw new Error(j.error||('HTTP '+r.status));return j;
}async function loadAll(){try{const [s,p]=await Promise.all([jfetch(API+'/api/gm/builder/ui-dictionary-auto/status?t='+Date.now()),jfetch(API+'/api/gm/builder/ui-dictionary-auto/pending?t='+Date.now())]);document.getElementById('status').textContent='사전 '+s.dictionary.total+'건 · 활성 '+s.dictionary.active+' · 재번역 '+s.dictionary.recheck+' · pending '+(p.items||[]).length+'건';document.getElementById('rows').innerHTML=(p.items||[]).map(x=>'<tr><td><input type="checkbox" class="pchk" value="'+x.pending_id+'"></td><td><b>'+esc(x.change_type)+'</b><br><span class="small">'+esc(x.source_type)+'</span></td><td>'+esc(x.gm_code||'(자동발급)')+'</td><td>'+esc(x.previous_text_ko||'')+'</td><td>'+esc(x.source_text_ko||'')+'</td><td>'+esc(x.page_name||'')+'</td><td><span class="small">'+esc(x.source_locator||x.source_file||'')+'</span></td><td>'+esc(x.seen_count||0)+'</td><td>'+esc(x.last_seen_at||'')+'</td></tr>').join('')||'<tr><td colspan="9">pending 없음</td></tr>';log({status:s,pending_count:(p.items||[]).length});}catch(e){log(String(e));}}function ids(){return Array.from(document.querySelectorAll('.pchk:checked')).map(x=>Number(x.value));}function selectAll(v){document.querySelectorAll('.pchk').forEach(x=>x.checked=v);}async function approveSelected(btn){const a=ids();if(!a.length)return alert('선택하세요.');if(!confirm('선택 '+a.length+'건을 UI 사전에 반영할까요?'))return;btn.disabled=true;try{log(await jfetch(API+'/api/gm/builder/ui-dictionary-auto/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pending_ids:a})}));await loadAll();}catch(e){log(String(e));}finally{btn.disabled=false;}}async function ignoreSelected(btn){const a=ids();if(!a.length)return alert('선택하세요.');btn.disabled=true;try{log(await jfetch(API+'/api/gm/builder/ui-dictionary-auto/ignore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pending_ids:a})}));await loadAll();}catch(e){log(String(e));}finally{btn.disabled=false;}}
async function loadV2(){try{const j=await jfetch(API+'/api/gm/builder/ui-dictionary-auto/v2/status?t='+Date.now());const d=j.dictionary||{};document.getElementById('v2status').textContent='사전 '+(d.total||0)+'건 · 변수문구 '+(d.variable||0)+' · 사용 '+(d.use_count||0)+' · 번역미완성 '+(d.translation_pending||0);document.getElementById('v2rows').innerHTML=(j.recent||[]).map(x=>'<tr><td>'+esc(x.gm_code)+'</td><td>'+esc(x.kr)+'</td><td>'+esc(x.has_variable||'N')+'</td><td>'+esc(x.translation_status)+'</td><td>'+esc(x.use_count||0)+'</td><td>'+esc(x.last_used_at||'')+'</td><td>'+esc(x.updated_at||'')+'</td></tr>').join('')||'<tr><td colspan="7">V2 기록 없음</td></tr>';await loadAutomationStatus();return j;}catch(e){document.getElementById('v2status').textContent=String(e);await loadAutomationStatus();throw e;}}
async function retryV2(btn){return startClientTranslation(btn);}


// GM_UI_AUTO_V030: manual translation updates DB only; JSON publish is an explicit separate action.
async function publishJsonV2(btn){
 if(!confirm('현재 DB 번역값으로 25개 언어 JSON 사전을 제작·발행할까요?\n미완성 번역은 기존 정책에 따라 한국어 대체값으로 처리됩니다.'))return;
 btn.disabled=true;
 try{
  const j=await jfetch(API+'/api/gm/builder/ui-dictionary-auto/v2/publish-json',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  log({action:'JSON_PUBLISH',...j});await loadAutomationStatus();
 }catch(e){log('JSON 제작 실패: '+String(e));}
 finally{btn.disabled=false;}
}

async function loadAutomationStatus(){try{const r=await jfetch(API+'/api/gm/builder/ui-dictionary-auto/v2/automation-status?t='+Date.now());const a=r.automation||{};const el=document.getElementById('autoRunStatus');if(el)el.textContent='자동화 '+(a.state||'IDLE')+' · 원인 '+(a.reason||'-')+' · 미완성 '+(a.remaining==null?'-':a.remaining)+' · 버전 '+(a.version||'-')+(a.error?' · 오류 '+a.error:'')+(a.remaining_cells==null?'':' · 남은 번역 셀 '+a.remaining_cells)+(a.retry_at?' · 재개 예정 '+a.retry_at:'')+(a.verified_languages?' · JSON 검증 '+a.verified_languages+'개 언어':'')+(a.upstream&&a.upstream.rate_limited?' · 번역 API 제한 ('+(a.upstream.last_http||'?')+')':'');}catch(e){const el=document.getElementById('autoRunStatus');if(el)el.textContent='자동화 상태 확인 실패: '+String(e);}}
loadAll();loadV2();

// V037: automatically start and resume client translation whenever the authorised
// Builder page is active. Persist translated text (never credentials) before upload.
const GM_CLIENT_LANG_TARGET={tw:'zh-TW'};
const GM_CLIENT_LANGS=['en','zh','vi','ja','tw','th','uz','ne','km','id','tl','mn','my','kk','si','ru','bn','ur','lo','hi','tr','fa','es','fr'];
const GM_CLIENT_QUEUE_KEY='gm_ui_auto_v037_pending_cells';
const GM_CLIENT_UPLOAD_BATCH=10;
let gmClientRunning=false,gmClientStop=false,gmClientAutoTimer=null,gmClientBlocked=false,gmClientNextAttemptAt=0;
let gmClientSuccess=0,gmClientFailed=0,gmClientSaved=0;
const gmClientSleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function gmClientStatus(message){const el=document.getElementById('clientTranslationStatus');if(el)el.textContent=message;}
function gmClientQueueRead(){
 try{const x=JSON.parse(localStorage.getItem(GM_CLIENT_QUEUE_KEY)||'[]');return Array.isArray(x)?x.filter(y=>y&&y.gm_code&&y.kr&&GM_CLIENT_LANGS.includes(y.lang)&&y.value).slice(0,500):[];}
 catch(_){return [];}
}
function gmClientQueueWrite(a){
 // localStorage holds translation text only: never the derzon password or session keys.
 localStorage.setItem(GM_CLIENT_QUEUE_KEY,JSON.stringify(a));
}
function gmClientQueueAdd(item){
 const a=gmClientQueueRead(),key=item.gm_code+':'+item.lang;
 const idx=a.findIndex(x=>x.gm_code+':'+x.lang===key);
 if(idx>=0)a[idx]=item;else a.push(item);
 gmClientQueueWrite(a);
}
function stopClientTranslation(){gmClientStop=true;gmClientStatus('중단 요청됨 · 이미 번역된 셀은 이 브라우저에 보관됩니다.');}
function gmClientProtect(text){
 const tokens=[];const safe=String(text||'').replace(/%[dsm]/g,m=>{tokens.push(m);return 'ZZGMKEEP'+(tokens.length-1)+'ZZ';});
 return {safe,restore(out){let x=String(out||'');for(let i=0;i<tokens.length;i++)x=x.replace(new RegExp('ZZGMKEEP\\s*'+i+'ZZ','g'),tokens[i]);return x;}};
}
async function gmClientTranslate(kr,lang){
 const target=GM_CLIENT_LANG_TARGET[lang]||lang,p=gmClientProtect(kr);
 const url='https://translate.googleapis.com/translate_a/single?client=gtx&sl=ko&tl='+encodeURIComponent(target)+'&dt=t&q='+encodeURIComponent(p.safe);
 let r;
 try{r=await fetch(url,{mode:'cors',credentials:'omit',cache:'no-store'});}
 catch(e){throw Error('BROWSER_CORS_OR_NETWORK_BLOCK: '+String(e&&e.message||e));}
 if(r.status===429||r.status===403)throw Error('GOOGLE_RATE_LIMIT_HTTP_'+r.status);
 if(!r.ok)throw Error('HTTP_'+r.status);
 const j=await r.json();let value='';for(const x of (j&&j[0])||[])if(x&&x[0])value+=x[0];
 value=p.restore(value).trim();
 if(!value||value===kr)throw Error('EMPTY_OR_UNTRANSLATED');
 if((kr.match(/%[dsm]/g)||[]).join('|')!==(value.match(/%[dsm]/g)||[]).join('|'))throw Error('PLACEHOLDER_MISMATCH');
 return value;
}
async function gmClientUpload(items){
 // V038: this UI-dictionary-only upload is authenticated by the existing
 // server-side derzon ADMIN SESSION GATE; no password is read, cached or prompted.
 // Other Builder data uploads continue to require per-operation reauthentication.
 const r=await fetch(API+'/api/gm/builder/ui-dictionary-auto/v2/client-upload',{
  method:'POST',headers:{'Content-Type':'application/json'},
  credentials:'same-origin',cache:'no-store',body:JSON.stringify({items})});
 let j;try{j=await r.json();}catch(_){throw Error('UPLOAD_NON_JSON_HTTP_'+r.status);}
 if(!r.ok||!j.ok)throw Error(String(j.error||'HTTP_'+r.status)+': '+String(j.detail||r.status));
 return j;
}
async function gmClientFlush(){
 const a=gmClientQueueRead();if(!a.length)return true;
 const portion=a.slice(0,GM_CLIENT_UPLOAD_BATCH);
 gmClientStatus('서버에 자동 저장 중 · 대기 '+a.length+'셀');
 const result=await gmClientUpload(portion);
 // Remove only after server acknowledged a committed transaction.
 const sigs=new Set(portion.map(x=>x.gm_code+':'+x.lang));
 gmClientQueueWrite(gmClientQueueRead().filter(x=>!sigs.has(x.gm_code+':'+x.lang)));
 gmClientSaved+=Number(result.saved||0);
 gmClientStatus('서버 DB 저장 '+gmClientSaved+'셀 · 브라우저 보관 '+gmClientQueueRead().length+'셀');
 console.log('[GM_UI_CLIENT_UPLOAD_ACK_V037]',JSON.stringify({saved:result.saved,already:result.already,waiting:gmClientQueueRead().length}));
 return true;
}
async function startClientTranslation(btn){
 if(gmClientRunning||gmClientBlocked)return;
 gmClientRunning=true;gmClientStop=false;if(btn)btn.disabled=true;
 try{
  gmClientStatus('누락 번역 자동 조회 · 기기 번역 실행');
  // First upload any translations persisted before navigation/refresh.
  while(gmClientQueueRead().length&&!gmClientStop)await gmClientFlush();
  for(let round=0;round<200&&!gmClientStop;round++){
   const data=await jfetch(API+'/api/gm/builder/ui-dictionary-auto/v2/client-missing?limit=20&t='+Date.now());
   if(!data.items||!data.items.length){gmClientStatus('누락 셀 0건 · JSON 발행 상태 확인');break;}
   let produced=0,translationError=null;
   for(const row of data.items){
    for(const lang of row.missing||[]){
     if(gmClientStop)break;
     if(!GM_CLIENT_LANGS.includes(lang))continue;
     if(gmClientQueueRead().some(x=>x.gm_code===row.gm_code&&x.lang===lang&&x.kr===row.kr))continue;
     try{
      const value=await gmClientTranslate(row.kr,lang);
      gmClientQueueAdd({gm_code:row.gm_code,kr:row.kr,lang,value});gmClientSuccess++;produced++;
      gmClientStatus('기기 번역 성공 '+gmClientSuccess+'셀 · 서버 저장 '+gmClientSaved+'셀 · 보관 '+gmClientQueueRead().length+'셀');
     }catch(e){gmClientFailed++;translationError=e;break;}
     if(gmClientQueueRead().length>=GM_CLIENT_UPLOAD_BATCH)await gmClientFlush();
     await gmClientSleep(1800);
    }
    if(translationError||gmClientStop)break;
   }
   if(gmClientQueueRead().length&&!gmClientStop)await gmClientFlush();
   if(translationError){
    const error=String(translationError.message||translationError);
    gmClientStatus('외부 번역 제한 · '+error+' · 재시도 예약 · 저장 '+gmClientSaved+'셀');
    console.warn('[GM_UI_CLIENT_TRANSLATION_RETRY_V037]',error);
    gmClientSchedule(15*60*1000);break;
   }
   if(!produced)break;
   await loadV2();
  }
  await loadV2();
 }catch(e){
  const message=String(e&&e.message||e);
  gmClientStatus('자동 처리 보류: '+message+' · 보관 '+gmClientQueueRead().length+'셀');
  if(/ADMIN_LOGIN_REQUIRED|ADMIN_SESSION_REQUIRED|ORIGIN_REJECTED|UPLOAD_NON_JSON_HTTP_401/.test(message))gmClientBlocked=true;
  console.warn('[GM_UI_CLIENT_AUTO_PAUSED_V037]',message);
 }finally{gmClientRunning=false;if(btn)btn.disabled=false;}
}
function gmClientSchedule(delay){
 gmClientNextAttemptAt=Date.now()+delay;
 if(gmClientAutoTimer)clearTimeout(gmClientAutoTimer);
 gmClientAutoTimer=setTimeout(()=>{gmClientAutoTimer=null;if(!document.hidden&&navigator.onLine&&!gmClientBlocked)void startClientTranslation();},delay);
}
function gmClientAutoBoot(){
 gmClientStatus('자동 실행 준비 · 관리자 클라이언트가 열리면 번역을 시작합니다.');
 gmClientSchedule(1500);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!gmClientRunning&&!gmClientBlocked&&Date.now()>=gmClientNextAttemptAt)gmClientSchedule(1500);});
 window.addEventListener('online',()=>{if(!gmClientRunning&&!gmClientBlocked&&Date.now()>=gmClientNextAttemptAt)gmClientSchedule(1500);});
 // New dictionary rows are discovered server-side; query periodically only while open.
 setInterval(()=>{if(!document.hidden&&!gmClientRunning&&!gmClientBlocked&&!gmClientAutoTimer&&Date.now()>=gmClientNextAttemptAt)gmClientSchedule(1500);},60000);
}
function gmClientResume(btn){gmClientBlocked=false;void startClientTranslation(btn);}
gmClientAutoBoot();

// GM_UI_PENDING_CLEAN_V003: read-only backup, human-readable CSV, explicit DELETE actions.
let gmPendingLastBackup=null;
function gmPendingFileDownload(content,mime,name){
 const blob=new Blob([content],{type:mime});const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}

// One-operation password dialog; the server continues to verify derzon's hash.
function gmUiAskAdminPassword(purpose){
 return new Promise(resolve=>{
  const cover=document.createElement('div');cover.style.cssText='position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.57);display:flex;align-items:center;justify-content:center;padding:16px';
  const form=document.createElement('form');form.style.cssText='max-width:430px;width:100%;box-sizing:border-box;border-radius:12px;background:white;color:#222;padding:22px';
  const title=document.createElement('h3');title.textContent=purpose+' · 관리자 비밀번호';
  const label=document.createElement('div');label.textContent='승인 계정: derzon';label.style.marginBottom='10px';
  const input=document.createElement('input');input.type='password';input.autocomplete='off';input.autocapitalize='off';input.spellcheck=false;input.setAttribute('lang','en');input.style.cssText='display:block;width:100%;box-sizing:border-box;padding:12px;border:1px solid #999;border-radius:5px';
  const hint=document.createElement('div');hint.style.cssText='font-size:12px;color:#555;margin-top:6px';hint.textContent='입력 대기';
  input.addEventListener('input',()=>{let v=input.value;hint.textContent=!v?'입력 대기':(/[\u3131-\u318e\uac00-\ud7a3]/.test(v)?'한글 포함 입력됨 · 한/영 확인':'입력됨 · '+v.length+'자 (한글 문자 없음)');});
  const show=document.createElement('label');show.style.cssText='display:block;margin:10px 0';const cb=document.createElement('input');cb.type='checkbox';cb.onchange=()=>{input.type=cb.checked?'text':'password';input.focus();};show.append(cb,document.createTextNode(' 비밀번호 표시'));
  const ok=document.createElement('button');ok.type='submit';ok.textContent='비밀번호 인증 후 실행';
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='취소';cancel.className='gray';cancel.style.marginLeft='8px';
  function finish(v){input.value='';cover.remove();resolve(v);}
  form.addEventListener('submit',e=>{e.preventDefault();finish(input.value||null);});cancel.addEventListener('click',()=>finish(null));
  form.append(title,label,input,hint,show,ok,cancel);cover.append(form);document.body.append(cover);input.focus();
 });
}

function gmPendingStatus(text){const el=document.getElementById('gmPendingOperationStatus');if(el)el.textContent=text;}
async function gmPendingExport(btn,format){
 btn.disabled=true;
 try{
  const password=await gmUiAskAdminPassword('후보 전체 다운로드');if(!password)return;
  const r=await fetch(API+'/api/gm/builder/ui-dictionary-auto/pending-clean/export',{cache:'no-store',credentials:'same-origin',headers:{'x-gm-builder-admin-password':password}});
  const j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||'HTTP '+r.status);
  const date=new Date().toISOString().slice(0,19).replace(/[:-]/g,'');
  if(format==='csv'){
   const fields=[['pending_id','ID'],['change_type','구분'],['source_text_ko','한국어 문구'],['previous_text_ko','기존 문구'],['page_name','페이지'],['source_locator','출처'],['source_type','수집형태'],['seen_count','수집횟수'],['last_seen_at','마지막 발견']];
   const cell=v=>{let text=String(v==null?'':v);if(/^[\s]*[=+@-]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';};
   const content='\ufeff'+[fields.map(x=>cell(x[1])).join(','),...(j.items||[]).map(x=>fields.map(f=>cell(x[f[0]])).join(','))].join('\r\n');
   gmPendingFileDownload(content,'text/csv;charset=utf-8','GM_UI_PENDING_REVIEW_'+date+'.csv');
   gmPendingStatus('후보 CSV 생성 완료 · '+j.snapshot.count+'건 · 브라우저 다운로드 요청됨');log({action:'PENDING_REVIEW_CSV',count:j.snapshot.count});
  }else{
   gmPendingFileDownload(JSON.stringify(j,null,2),'application/json;charset=utf-8','GM_UI_PENDING_BACKUP_'+date+'.json');
   gmPendingLastBackup={count:j.snapshot.count,sha256:j.snapshot.sha256};
   gmPendingStatus('후보 JSON 백업 생성 완료 · '+j.snapshot.count+'건 · 다운로드 요청됨');log({action:'PENDING_BACKUP_JSON',count:j.snapshot.count,sha256:j.snapshot.sha256});
  }
 }catch(e){gmPendingStatus('후보 다운로드 실패 · '+String(e));log('후보 다운로드 실패: '+String(e));}finally{btn.disabled=false;}
}
async function gmPendingDeleteSelected(btn){
 const selected=ids();if(!selected.length)return alert('삭제할 후보를 먼저 체크하세요.');
 if(!confirm('체크한 대기 후보 '+selected.length+'건을 삭제할까요?\n정식 UI 사전과 번역 JSON에는 영향이 없습니다.'))return;
 const password=await gmUiAskAdminPassword('선택삭제');if(!password)return;
 btn.disabled=true;
 try{
  const r=await fetch(API+'/api/gm/builder/ui-dictionary-auto/pending-clean/delete-selected',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','x-gm-builder-admin-password':password},body:JSON.stringify({pending_ids:selected})});
  const j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||'HTTP '+r.status);
  gmPendingLastBackup=null;gmPendingStatus('선택삭제 서버 처리 완료 · 실제 결과 '+JSON.stringify(j));log({action:'PENDING_DELETE_SELECTED',...j});await loadAll();
 }catch(e){gmPendingStatus('선택삭제 실패 · '+String(e));log('선택삭제 실패: '+String(e));}finally{btn.disabled=false;}
}
async function gmPendingDeleteAll(btn){
 if(!gmPendingLastBackup)return alert('전체삭제 전에 위의 [전체 JSON 백업]을 먼저 다운로드하세요.');
 if(!confirm('대기 후보 '+gmPendingLastBackup.count+'건을 모두 삭제합니다.\n정식 UI 사전은 삭제하지 않습니다.\n백업 JSON 파일을 보관했습니까?'))return;
 
 const password=await gmUiAskAdminPassword('전체삭제');if(!password)return;
 btn.disabled=true;
 try{
  const r=await fetch(API+'/api/gm/builder/ui-dictionary-auto/pending-clean/delete-all',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','x-gm-builder-admin-password':password},body:JSON.stringify({snapshot:gmPendingLastBackup})});
  const j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||'HTTP '+r.status);
  gmPendingLastBackup=null;gmPendingStatus('전체삭제 서버 처리 완료 · 실제 결과 '+JSON.stringify(j));log({action:'PENDING_DELETE_ALL',...j});await loadAll();
 }catch(e){gmPendingStatus('전체삭제 실패 · '+String(e));log('전체삭제 실패: '+String(e)+' (백업 이후 신규 수집이 있었다면 백업을 다시 받으세요)');}finally{btn.disabled=false;}
}
