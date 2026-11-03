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
   password.value='';submit.disabled=false;panel.hidden=true;panel.style.display='none';gmAdminLoginPending=null;
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
    if(r.ok){finish();return;}
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
}async function loadAll(){try{const [s,p]=await Promise.all([jfetch(API+'/api/gm/builder/ui-dictionary-auto/status?t='+Date.now()),jfetch(API+'/api/gm/builder/ui-dictionary-auto/pending?t='+Date.now())]);document.getElementById('status').textContent='사전 '+s.dictionary.total+'건 · 활성 '+s.dictionary.active+' · 재번역 '+s.dictionary.recheck+' · pending '+(p.items||[]).length+'건';document.getElementById('rows').innerHTML=(p.items||[]).map(x=>'<tr><td><input type="checkbox" class="pchk" value="'+x.pending_id+'"></td><td><b>'+esc(x.change_type)+'</b><br><span class="small">'+esc(x.source_type)+'</span></td><td>'+esc(x.gm_code||'(자동발급)')+'</td><td>'+esc(x.previous_text_ko||'')+'</td><td>'+esc(x.source_text_ko||'')+'</td><td>'+esc(x.page_name||'')+'</td><td><span class="small">'+esc(x.source_locator||x.source_file||'')+'</span></td><td>'+esc(x.seen_count||0)+'</td><td>'+esc(x.last_seen_at||'')+'</td></tr>').join('')||'<tr><td colspan="9">pending 없음</td></tr>';log({status:s,pending_count:(p.items||[]).length});}catch(e){log(String(e));}}async function scanStatic(btn){btn.disabled=true;try{const j=await jfetch(API+'/api/gm/builder/ui-dictionary-auto/scan-static',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});log(j);await loadAll();}catch(e){log(String(e));}finally{btn.disabled=false;}}function ids(){return Array.from(document.querySelectorAll('.pchk:checked')).map(x=>Number(x.value));}function selectAll(v){document.querySelectorAll('.pchk').forEach(x=>x.checked=v);}async function approveSelected(btn){const a=ids();if(!a.length)return alert('선택하세요.');if(!confirm('선택 '+a.length+'건을 UI 사전에 반영할까요?'))return;btn.disabled=true;try{log(await jfetch(API+'/api/gm/builder/ui-dictionary-auto/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pending_ids:a})}));await loadAll();}catch(e){log(String(e));}finally{btn.disabled=false;}}async function ignoreSelected(btn){const a=ids();if(!a.length)return alert('선택하세요.');btn.disabled=true;try{log(await jfetch(API+'/api/gm/builder/ui-dictionary-auto/ignore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pending_ids:a})}));await loadAll();}catch(e){log(String(e));}finally{btn.disabled=false;}}
async function loadV2(){try{const j=await jfetch(API+'/api/gm/builder/ui-dictionary-auto/v2/status?t='+Date.now());const d=j.dictionary||{};document.getElementById('v2status').textContent='사전 '+(d.total||0)+'건 · 변수문구 '+(d.variable||0)+' · 사용 '+(d.use_count||0)+' · 번역미완성 '+(d.translation_pending||0);document.getElementById('v2rows').innerHTML=(j.recent||[]).map(x=>'<tr><td>'+esc(x.gm_code)+'</td><td>'+esc(x.kr)+'</td><td>'+esc(x.has_variable||'N')+'</td><td>'+esc(x.translation_status)+'</td><td>'+esc(x.use_count||0)+'</td><td>'+esc(x.last_used_at||'')+'</td><td>'+esc(x.updated_at||'')+'</td></tr>').join('')||'<tr><td colspan="7">V2 기록 없음</td></tr>';return j;}catch(e){document.getElementById('v2status').textContent=String(e);throw e;}}
async function scanV2(btn){btn.disabled=true;try{const j=await jfetch(API+'/api/gm/builder/ui-dictionary-auto/v2/scan-static',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({limit:250})});log(j);await loadV2();}catch(e){log(String(e));}finally{btn.disabled=false;}}
async function retryV2(btn){btn.disabled=true;try{const j=await jfetch(API+'/api/gm/builder/ui-dictionary-auto/v2/retry-translations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({limit:10})});log(j);await loadV2();}catch(e){log(String(e));}finally{btn.disabled=false;}}

async function loadAutomationStatus(){try{const r=await jfetch(API+'/api/gm/builder/ui-dictionary-auto/v2/automation-status?t='+Date.now());const a=r.automation||{};const el=document.getElementById('autoRunStatus');if(el)el.textContent='자동화 '+(a.state||'IDLE')+' · 원인 '+(a.reason||'-')+' · 미완성 '+(a.remaining==null?'-':a.remaining)+' · 버전 '+(a.version||'-')+(a.error?' · 오류 '+a.error:'');}catch(e){const el=document.getElementById('autoRunStatus');if(el)el.textContent='자동화 상태 확인 실패: '+String(e);}}
loadAll();loadV2();loadAutomationStatus();
