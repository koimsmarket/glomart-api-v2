(function(){
'use strict';
const $=id=>document.getElementById(id);
let pollTimer=null,submitAuth=null,requestRunning=false;
const status=t=>{if($('gmQaState'))$('gmQaState').textContent=t;};
const btn=()=> $('gmQaBulkBtn');
function showBusy(v){if(btn())btn().disabled=v;}
function formatJob(j){
 const rows=(j.results||[]).map(x=>(x.type==='product'?'상품':'옵션')+': 오류가 있던 행 '+Number(x.cleared_rows||0).toLocaleString()+'건 정리');
 return `상태: ${j.state==='running'?'전체 검사·정리 실행 중':j.state==='done'?'완료':j.state==='failed'?'오류 발생':'실행 전'}`+(rows.length?' · '+rows.join(' / '):'')+(j.error?' · '+j.error:'');
}
async function api(path,options={}){
 const r=await fetch(path,{credentials:'same-origin',cache:'no-store',...options});
 const j=await r.json().catch(()=>({}));
 if(!r.ok||!j.ok)throw Error(j.error||'HTTP_'+r.status);
 return j;
}
async function refresh(){
 try{
  const j=await api('/api/gm/builder/translation-qa/job-status');status(formatJob(j));
  const active=j.state==='running';showBusy(active||requestRunning);
  if(active){if(!pollTimer)pollTimer=setInterval(refresh,3000);}
  else if(pollTimer){clearInterval(pollTimer);pollTimer=null;}
 }catch(e){status('조회 실패: '+e.message+' · 관리자 로그인 페이지에서 다시 인증한 후 확인하세요.');if(pollTimer){clearInterval(pollTimer);pollTimer=null;}showBusy(false);}
}
window.gmQaJobStatus=refresh;
window.gmQaAuthCancel=function(){const box=$('gmQaAuthOverlay');box.hidden=true;box.style.display='none';$('gmQaPassword').value='';submitAuth=null;};
window.gmQaBulk=function(){
 if(requestRunning)return;
 if(!confirm('현재 선택한 대상의 모든 번역 언어에서 명백한 문장부호 오류를 전부 NULL 처리합니다. 정상 번역/원문은 보존합니다. 진행하시겠습니까?'))return;
 const box=$('gmQaAuthOverlay');box.hidden=false;box.style.display='flex';$('gmQaPassword').value='';$('gmQaPassword').focus();
 submitAuth=true;
};
async function handleAuth(e){
 e.preventDefault();if(!submitAuth||requestRunning)return;
 const password=$('gmQaPassword').value;const type=$('gmQaType').value;
 window.gmQaAuthCancel();requestRunning=true;showBusy(true);status('관리자 인증 및 서버 전체 정리 요청 중…');
 try{
  // The global admin-session gate precedes Builder reauthentication. Repair an expired
  // session through the existing official login route, not by bypassing that gate.
  let logged=false;
  try{const a=await api('/gm-admin-auth/status');logged=!!a.authenticated;}catch(_){logged=false;}
  if(!logged)await api('/gm-admin-auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
  const j=await api('/api/gm/builder/translation-qa/clear-all',{method:'POST',headers:{'Content-Type':'application/json','x-gm-builder-admin-password':password},body:JSON.stringify({type,lang:'all'})});
  status('서버 전체 검사·정리 시작됨 · 작업번호 '+j.job_id+' · 진행 상태 확인 중');
  await refresh();
 }catch(err){status('작업 시작 실패: '+err.message+' · 정리는 시작되지 않았거나 상태 확인이 필요합니다.');}
 finally{requestRunning=false;showBusy(false);$('gmQaPassword').value='';}
}
document.addEventListener('DOMContentLoaded',()=>{$('gmQaAuthForm').addEventListener('submit',handleAuth);refresh();});
})();
