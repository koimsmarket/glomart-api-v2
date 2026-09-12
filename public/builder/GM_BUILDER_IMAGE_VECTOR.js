// GM_BUILDER_IMAGE_VECTOR_UI_V019_RUN_REBUILD_CLEANUP
// Image Vector UI only: background worker, product sync, pending queue. Tree/Leaf classification is retired.
// All /api/gm/builder/image-vector/* calls must originate from this file.

function ivFmtMb(n){ return n==null?'-':`${Number(n).toFixed(1)} MB`; }
function ivStateText(s){ return ({OFF:'완전 정지',FORCED_ON:'강제 가동',AUTO_RUNNING:'자동 작업 중',AUTO_MEMORY_WAIT:'메모리 대기',AUTO_TIME_WAIT:'시간외 대기'})[String(s||'')]||String(s||'-'); }
const IV_BASE_TITLE=document.title;
let ivTitleTimer=null,ivTitleFlip=false;
function setImageVectorForcedWarning(on){
  const card=document.getElementById('ivBackgroundCard');
  if(card)card.classList.toggle('iv-forced-on',!!on);
  if(on){
    if(!ivTitleTimer){
      ivTitleFlip=false;
      ivTitleTimer=setInterval(()=>{ivTitleFlip=!ivTitleFlip;document.title=ivTitleFlip?'⚠ VECTOR 강제 ON ⚠':IV_BASE_TITLE;},800);
    }
  }else{
    if(ivTitleTimer){clearInterval(ivTitleTimer);ivTitleTimer=null;}
    document.title=IV_BASE_TITLE;
  }
}
function paintImageVectorMode(mode){
  ['OFF','AUTO','ON'].forEach(m=>{
    const b=document.getElementById('ivMode'+m.charAt(0)+m.slice(1).toLowerCase());
    if(!b)return;
    b.className=(m===mode?(m==='OFF'?'red':m==='AUTO'?'green':'red'):'gray');
  });
  setImageVectorForcedWarning(mode==='ON');
}
async function loadImageVectorBackgroundStatus(){
  const body=document.getElementById('ivBackgroundStatus'); if(!body)return;
  try{
    const r=await fetch(`${API}/api/gm/background/image-vector/status?t=${Date.now()}`,{cache:'no-store'});
    const j=await r.json();
    if(!r.ok||!j.ok)throw new Error(j.error||`HTTP ${r.status}`);
    paintImageVectorMode(j.mode);
    body.innerHTML=`
      <tr><th>현재 모드</th><td><b>${j.mode}</b></td></tr>
      <tr><th>현재 상태</th><td>${ivStateText(j.state)}</td></tr>
      <tr><th>현재 메모리</th><td><b>${j.memory_percent}%</b> (${ivFmtMb(j.memory_used_mb)} / ${ivFmtMb(j.memory_limit_mb)})</td></tr>
      <tr><th>미수행</th><td>${fmt(j.pending)}건</td></tr>
      <tr><th>현재 실행</th><td>${fmt(j.active)} / ${fmt(j.max_slots)}</td></tr>
      <tr><th>완료/실패</th><td>${fmt(j.completed)} / ${fmt(j.failed)}</td></tr>
      <tr><th>마지막 오류</th><td>${j.last_error||'-'}</td></tr>`;
  }catch(e){ body.innerHTML=`<tr><td>Vector Background 조회 실패: ${String(e&&e.message||e)}</td></tr>`; }
}
async function setImageVectorMode(mode){
  if(!['OFF','AUTO','ON'].includes(mode))return;
  if(mode==='ON' && !confirm('강제 ON은 시간 및 메모리 제한을 무시합니다. 계속 가동할까요?'))return;
  try{
    const r=await fetch(`${API}/api/gm/background/image-vector/mode`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode})});
    const j=await r.json();
    if(!r.ok||!j.ok)throw new Error(j.error||`HTTP ${r.status}`);
    paintImageVectorMode(j.mode);
    log({action:'image-vector-background.mode',mode:j.mode,state:j.state,memory_percent:j.memory_percent,pending:j.pending});
    await loadImageVectorBackgroundStatus();
  }catch(e){ log('image-vector mode error: '+String(e&&e.message||e)); }
}
async function syncImageVectorProducts(button){
  const out=document.getElementById('ivProductSyncResult');
  if(!confirm('현재 상품에 없는 이미지 Vector를 삭제합니다. 상품 테이블은 변경하지 않습니다. 계속할까요?'))return;
  const timed=startButtonTimer(button,'상품 동기화 중');
  try{
    const r=await fetch(`${API}/api/gm/builder/image-vector/sync-products`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:'{}'
    });
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.detail||j.error||`HTTP ${r.status}`);
    const text=`동기화 완료: 상품 ${fmt(j.product_count)}건 / 삭제 Vector ${fmt(j.deleted)}건 / 잔여 Vector ${fmt(j.vector_after)}건`;
    if(out)out.textContent=text;
    log({action:'image-vector.sync-products',...j});
    await loadDashboard(false);
  }catch(e){
    const msg=String(e&&e.message||e);
    if(out)out.textContent='동기화 실패: '+msg;
    log('image-vector product sync error: '+msg);
  }finally{
    stopButtonTimer(timed);
  }
}

async function uploadImageVectorPending(button){
  const input=document.getElementById('ivPendingFile'),out=document.getElementById('ivUploadResult');
  const file=input&&input.files&&input.files[0];
  if(!file){alert('Queue CSV 또는 Excel 파일을 선택하세요.');return;}
  const timed=startButtonTimer(button,'Queue 업로드 중');
  try{
    const text=await readCsvText(file);
    const first=String(text||'').split(/\r?\n/)[0]||'';
    if(!/product_uid/i.test(first) || !/(image_url|thumb_origin_url)/i.test(first))throw new Error('필수 컬럼 product_uid, image_url 이 없습니다.');
    const r=await fetch(`${API}/api/gm/background/image-vector/pending/import`,{method:'POST',headers:{'Content-Type':'text/csv; charset=utf-8'},body:text});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||`HTTP ${r.status}`);
    if(out)out.textContent=`업로드 완료: 유효 ${fmt(j.valid)}건 / 무효 ${fmt(j.invalid)}건 / 현재 미수행 ${fmt(j.pending)}건`;
    log({action:'image-vector-pending.import',file:file.name,...j});
    await loadImageVectorBackgroundStatus();
  }catch(e){
    const msg=String(e&&e.message||e);if(out)out.textContent='업로드 실패: '+msg;log('image-vector pending import error: '+msg);
  }finally{stopButtonTimer(timed);}
}
loadImageVectorBackgroundStatus();
setInterval(()=>loadImageVectorBackgroundStatus(),10000);



function repElapsed(startedAt,finishedAt){
 if(!startedAt)return '00:00:00';
 const a=Date.parse(startedAt),b=finishedAt?Date.parse(finishedAt):Date.now();
 if(!Number.isFinite(a)||!Number.isFinite(b))return '00:00:00';
 let sec=Math.max(0,Math.floor((b-a)/1000));const h=Math.floor(sec/3600);sec%=3600;const m=Math.floor(sec/60),ss=sec%60;
 return [h,m,ss].map(x=>String(x).padStart(2,'0')).join(':');
}
function paintRepresentativeJob(job){
 const x=job||{};const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
 const total=Number(x.total_vector||0),done=Number(x.excluded_run0||0)+Number(x.processed||0)+Number(x.skipped||0);
 const pct=total>0?Math.min(100,(done/total)*100):0;
 set('ivRepJobState',`${x.running?'실행 중':(x.phase==='DONE'?'완료':(x.phase==='ERROR'?'오류':'대기'))} / ${x.phase||'IDLE'}`);
 set('ivRepJobKeyword',x.current_category_keyword||x.last_category||'-');
 set('ivRepJobCategoryCount',fmt(x.current_category_count||0));
 set('ivRepJobCategoryProcessed',`${fmt(x.current_category_processed||0)} / ${fmt(x.current_category_count||0)}`);
 set('ivRepJobCategories',`${fmt(x.categories_done||0)} / ${fmt(x.categories_total||0)}`);
 set('ivRepJobRepNo',`#${fmt(x.last_representative_no||0)}`);
 set('ivRepJobRepresentatives',fmt(x.representatives||0));
 set('ivRepJobTotal',`${fmt(done)} / ${fmt(total)}`);
 set('ivRepJobPercent',`${pct.toFixed(1)}%`);
 set('ivRepJobElapsed',repElapsed(x.started_at,x.finished_at));
}

// V021: distinguish TARGET Builder settings from currently LIVE representative net.
function syncRepresentativeSettingInputs(runNo,threshold){
 const run=document.getElementById('ivRepRunInput'),thr=document.getElementById('ivRepThresholdInput');
 if(run && document.activeElement!==run)run.value=String(Math.max(1,Math.trunc(Number(runNo||1))));
 if(thr && document.activeElement!==thr)thr.value=Number(threshold==null?0.95:threshold).toFixed(4);
}
function nextRepresentativeRun(){
 const el=document.getElementById('ivRepRunInput');if(!el)return;
 el.value=String(Math.max(1,Math.trunc(Number(el.value||1)))+1);
}
async function saveRepresentativeSettings(button,opts){
 opts=opts||{};
 const runEl=document.getElementById('ivRepRunInput'),thrEl=document.getElementById('ivRepThresholdInput'),out=document.getElementById('ivRepSettingsResult');
 const runNo=Math.trunc(Number(runEl&&runEl.value)),threshold=Number(thrEl&&thrEl.value);
 if(!(runNo>=1)){alert('RUN은 1 이상의 정수여야 합니다.');throw new Error('invalid run');}
 if(!(threshold>0&&threshold<=1)){alert('기준 유사율은 0 초과 1 이하여야 합니다.');throw new Error('invalid threshold');}
 if(button)button.disabled=true;
 try{
   const r=await fetch(`${API}/api/gm/builder/image-vector/representative/initial/settings`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run_no:runNo,threshold})});
   const j=await r.json().catch(()=>({}));if(!r.ok||!j.ok)throw new Error(j.detail||j.error||`HTTP ${r.status}`);
   syncRepresentativeSettingInputs(j.target_run_no==null?j.run_no:j.target_run_no,j.target_threshold==null?j.threshold:j.target_threshold);
   const liveRun=j.live_run_no==null?j.run_no:j.live_run_no,liveThr=j.live_threshold==null?j.threshold:j.live_threshold;
   if(out)out.textContent=`저장 완료: RUN ${j.run_no} / ${Number(j.threshold).toFixed(4)}`;
   if(!opts.silent){log({action:'image-vector.representative.settings',run_no:j.run_no,threshold:j.threshold});await loadRepresentativeStatus();}
   return j;
 }catch(e){if(out)out.textContent='저장 실패: '+String(e&&e.message||e);throw e;}
 finally{if(button)button.disabled=false;}
}

async function loadRepresentativeStatus(){
 const el=document.getElementById('ivRepresentativeStatus');if(!el)return;
 try{
   const [sr,jr]=await Promise.all([
     fetch(`${API}/api/gm/builder/image-vector/representative/status?t=${Date.now()}`,{cache:'no-store'}),
     fetch(`${API}/api/gm/builder/image-vector/representative/initial/status?t=${Date.now()}`,{cache:'no-store'})
   ]);
   const j=await sr.json(),jj=await jr.json();
   if(!sr.ok||!j.ok)throw new Error(j.detail||j.error||`HTTP ${sr.status}`);
   if(!jr.ok||!jj.ok)throw new Error(jj.detail||jj.error||`HTTP ${jr.status}`);
   const x=(jj&&jj.job)||{},pv=(jj&&jj.preview)||{};
   syncRepresentativeSettingInputs(j.target_run_no==null?j.run_no:j.target_run_no,j.target_threshold==null?j.threshold:j.target_threshold);
   const liveRun=j.live_run_no==null?j.run_no:j.live_run_no,liveThr=j.live_threshold==null?j.threshold:j.live_threshold;
   paintRepresentativeJob(x);
   el.innerHTML=`<tr><th>현재 LIVE RUN</th><td>${fmt(liveRun)}</td></tr>
   <tr><th>현재 LIVE 유사율</th><td>${Number(liveThr).toFixed(4)}</td></tr>
   <tr><th>다음 Builder TARGET RUN</th><td>${fmt(j.target_run_no==null?j.run_no:j.target_run_no)}</td></tr>
   <tr><th>다음 Builder TARGET 유사율</th><td>${Number(j.target_threshold==null?j.threshold:j.target_threshold).toFixed(4)}</td></tr>
   <tr><th>전체 Vector</th><td>${fmt(j.total_vector)}</td></tr>
   <tr><th>카테고리 후보</th><td>${fmt(j.candidate_vector)}</td></tr>
   <tr><th>카테고리 사전점검</th><td id="ivRepPreviewState">${pv.running?'실행 중':(pv.completed?'완료':(pv.error?'오류':'대기'))}</td></tr>
   <tr><th>카테고리 확정</th><td id="ivRepPreviewResolved">${pv.completed?fmt(pv.category_resolved):(x.category_resolved?fmt(x.category_resolved):'-')}</td></tr>
   <tr><th>카테고리 미확정</th><td id="ivRepPreviewUnresolved">${pv.completed?fmt(pv.category_unresolved):(x.category_unresolved?fmt(x.category_unresolved):'-')}</td></tr>
   <tr><th>비교 그룹</th><td id="ivRepPreviewGroups">${pv.completed?fmt(pv.categories_total):(x.categories_total?fmt(x.categories_total):'-')}</td></tr>
   <tr><th>현재 RUN 완료</th><td>${fmt(j.current_done)}</td></tr>
     <tr><th>제외(run 0)</th><td>${fmt(j.excluded_run0)}</td></tr>
   <tr><th>미수행</th><td>${fmt(j.unprocessed)}</td></tr>
   <tr><th>대표 이미지</th><td>${fmt(j.representatives)}</td></tr>
   <tr><th>최종 대표번호</th><td>${fmt(j.max_representative_no||x.last_representative_no||0)}</td></tr>
   <tr><th>초기 수행</th><td>${x.running?'실행 중':(x.phase==='DONE'?'완료':'대기')} ${x.processed!=null?`(처리 ${fmt(x.processed)} / 건너뜀 ${fmt(x.skipped||0)})`:''}</td></tr>
   <tr><th>수행 단계</th><td>${x.phase||'-'}</td></tr>
   <tr><th>카테고리 진행</th><td>${fmt(x.categories_done||0)} / ${fmt(x.categories_total||0)}</td></tr>
   <tr><th>현재 keyword</th><td>${x.last_category||'-'}</td></tr>
   <tr><th>사전점검 오류</th><td id="ivRepPreviewError">${pv.error||'-'}</td></tr>
   <tr><th>오류</th><td>${x.error||'-'}</td></tr>`;
 }catch(e){el.innerHTML=`<tr><td>대표이미지 상태 조회 실패: ${String(e&&e.message||e)}</td></tr>`;}
}

function paintRepresentativePreview(pv){
 pv=pv||{};
 const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
 set('ivRepPreviewState',pv.running?'실행 중':(pv.completed?'완료':(pv.error?'오류':'대기')));
 set('ivRepPreviewResolved',pv.completed?fmt(pv.category_resolved):'-');
 set('ivRepPreviewUnresolved',pv.completed?fmt(pv.category_unresolved):'-');
 set('ivRepPreviewGroups',pv.completed?fmt(pv.categories_total):'-');
 set('ivRepPreviewError',pv.error||'-');
}
async function fetchRepresentativeInitialStatus(){
 const r=await fetch(`${API}/api/gm/builder/image-vector/representative/initial/status?t=${Date.now()}`,{cache:'no-store'});
 const j=await r.json();
 if(!r.ok||!j.ok)throw new Error(j.detail||j.error||`HTTP ${r.status}`);
 return j;
}
async function previewRepresentativeCategories(button){
 const timed=startButtonTimer(button,'카테고리 점검 시작');
 try{
   const r=await fetch(`${API}/api/gm/builder/image-vector/representative/initial/preview`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
   const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.detail||j.error||`HTTP ${r.status}`);
   log({action:'image-vector.representative.preview',...j});
   paintRepresentativePreview({running:true,completed:false,error:null});
   for(;;){
     await new Promise(resolve=>setTimeout(resolve,1000));
     const sj=await fetchRepresentativeInitialStatus();
     const pv=(sj&&sj.preview)||{};
     paintRepresentativePreview(pv);
     if(!pv.running)break;
   }
   await loadRepresentativeStatus();
 }catch(e){
   const msg=String(e&&e.message||e);log('representative preview error: '+msg);paintRepresentativePreview({running:false,completed:false,error:msg});
 }finally{stopButtonTimer(timed);}
}


async function runRepresentativeBuilder(button){
 const runEl=document.getElementById('ivRepRunInput');
 const runNo=Math.max(1,Math.trunc(Number(runEl&&runEl.value||1)));
 if(!confirm(`RUN ${runNo}을 새로 계산합니다.\n\n기존 대표선정 MAP/통계를 전체 초기화하고 대표번호 #1부터 다시 생성합니다.\n이전 테스트 결과는 DB에 남지 않습니다. 필요한 결과는 CSV로 먼저 보관하세요.\n원본 Vector/상품/카테고리는 변경하지 않습니다.\n\n실행할까요?`))return;
 const timed=startButtonTimer(button,'초기 대표선정 시작');
 try{
   // 화면에 입력한 RUN/유사율을 먼저 중앙설정에 저장한 뒤 그 값으로 실행한다.
   await saveRepresentativeSettings(null,{silent:true});
   const r=await fetch(`${API}/api/gm/builder/image-vector/representative/initial/run`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
   const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.detail||j.error||`HTTP ${r.status}`);
   log({action:'image-vector.representative.initial.run',...j});
   // 본 실행 중에는 DB 전체 COUNT 상태 API를 호출하지 않는다.
   // 메모리에 있는 initial/status만 1초마다 읽어 진행상황을 표시한다.
   for(;;){
     const sj=await fetchRepresentativeInitialStatus();
     const x=(sj&&sj.job)||{};
     paintRepresentativeJob(x);
     if(!x.running){
       if(x.phase==='ERROR')throw new Error(x.error||'대표선정 실행 오류');
       break;
     }
     await new Promise(resolve=>setTimeout(resolve,1000));
   }
   // 완료 후에만 무거운 집계 상태를 한 번 갱신한다.
   await loadRepresentativeStatus();
 }catch(e){log('representative initial run error: '+String(e&&e.message||e));}
 finally{stopButtonTimer(timed);}
}
async function loadRepresentativeStats(){
 const tb=document.getElementById('ivRepresentativeStats');if(!tb)return;try{const r=await fetch(`${API}/api/gm/builder/image-vector/representative/stats?t=${Date.now()}`,{cache:'no-store'});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.detail||j.error||`HTTP ${r.status}`);tb.innerHTML=(j.items||[]).map(x=>`<tr><td>#${fmt(x.representative_no)} · ${x.representative_puid}</td><td>${fmt(x.member_count)}</td><td>${x.avg_similarity==null?'-':Number(x.avg_similarity).toFixed(4)}</td><td>${x.min_similarity==null?'-':Number(x.min_similarity).toFixed(4)}</td><td>${x.max_similarity==null?'-':Number(x.max_similarity).toFixed(4)}</td><td>${fmt(x.run_no)}</td></tr>`).join('')||'<tr><td colspan="6">자료 없음</td></tr>';}catch(e){tb.innerHTML=`<tr><td colspan="6">조회 실패: ${String(e&&e.message||e)}</td></tr>`;}
}
setTimeout(()=>void loadRepresentativeStatus(),300);
setInterval(async()=>{try{const sj=await fetchRepresentativeInitialStatus();paintRepresentativeJob((sj&&sj.job)||{});}catch(_){/* lightweight progress poll only */}},1000);
