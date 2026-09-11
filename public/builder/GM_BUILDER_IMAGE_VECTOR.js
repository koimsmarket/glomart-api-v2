// GM_BUILDER_IMAGE_VECTOR_UI_V011_REPRESENTATIVE_SAFE_INITIAL
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


async function loadRepresentativeStatus(){
 const el=document.getElementById('ivRepresentativeStatus');if(!el)return;
 try{
   const [sr,jr]=await Promise.all([
     fetch(`${API}/api/gm/builder/image-vector/representative/status?t=${Date.now()}`,{cache:'no-store'}),
     fetch(`${API}/api/gm/builder/image-vector/representative/initial/status?t=${Date.now()}`,{cache:'no-store'})
   ]);
   const j=await sr.json(),jj=await jr.json();
   if(!sr.ok||!j.ok)throw new Error(j.detail||j.error||`HTTP ${sr.status}`);
   const x=(jj&&jj.job)||{};
   el.innerHTML=`<tr><th>현재 RUN</th><td>${fmt(j.run_no)}</td></tr>
   <tr><th>기준 유사율</th><td>${Number(j.threshold).toFixed(4)}</td></tr>
   <tr><th>전체 Vector</th><td>${fmt(j.total_vector)}</td></tr>
   <tr><th>카테고리 후보</th><td>${fmt(j.candidate_vector)}</td></tr>
   <tr><th>카테고리 확정</th><td>${x.category_resolved?fmt(x.category_resolved):'-'}</td></tr>
   <tr><th>카테고리 미확정</th><td>${x.category_unresolved?fmt(x.category_unresolved):'-'}</td></tr>
   <tr><th>현재 RUN 완료</th><td>${fmt(j.current_done)}</td></tr>
   <tr><th>이전 RUN</th><td>${fmt(j.previous_run)}</td></tr>
   <tr><th>제외(run 0)</th><td>${fmt(j.excluded_run0)}</td></tr>
   <tr><th>미수행</th><td>${fmt(j.unprocessed)}</td></tr>
   <tr><th>대표 이미지</th><td>${fmt(j.representatives)}</td></tr>
   <tr><th>최종 대표번호</th><td>${fmt(j.max_representative_no||x.last_representative_no||0)}</td></tr>
   <tr><th>초기 수행</th><td>${x.running?'실행 중':(x.phase==='DONE'?'완료':'대기')} ${x.processed!=null?`(처리 ${fmt(x.processed)} / 건너뜀 ${fmt(x.skipped||0)})`:''}</td></tr>
   <tr><th>수행 단계</th><td>${x.phase||'-'}</td></tr>
   <tr><th>카테고리 진행</th><td>${fmt(x.categories_done||0)} / ${fmt(x.categories_total||0)}</td></tr>
   <tr><th>현재 keyword</th><td>${x.last_category||'-'}</td></tr>
   <tr><th>오류</th><td>${x.error||'-'}</td></tr>`;
 }catch(e){el.innerHTML=`<tr><td>대표이미지 상태 조회 실패: ${String(e&&e.message||e)}</td></tr>`;}
}
async function runRepresentativeBuilder(button){
 if(!confirm('초기 전체 수행을 시작합니다. 카테고리 기준자료를 읽어 비교 그룹을 확정하고, 카테고리별로 Vector를 불러와 처리합니다. 완료된 그룹은 재실행 시 건너뜁니다. 원본 Vector/상품/카테고리 테이블은 변경하지 않습니다. 실행할까요?'))return;
 const timed=startButtonTimer(button,'초기 대표선정 시작');
 try{
   const r=await fetch(`${API}/api/gm/builder/image-vector/representative/initial/run`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
   const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.detail||j.error||`HTTP ${r.status}`);
   log({action:'image-vector.representative.initial.run',...j});
   await loadRepresentativeStatus();
 }catch(e){log('representative initial run error: '+String(e&&e.message||e));}
 finally{stopButtonTimer(timed);}
}
async function loadRepresentativeStats(){
 const tb=document.getElementById('ivRepresentativeStats');if(!tb)return;try{const r=await fetch(`${API}/api/gm/builder/image-vector/representative/stats?t=${Date.now()}`,{cache:'no-store'});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.detail||j.error||`HTTP ${r.status}`);tb.innerHTML=(j.items||[]).map(x=>`<tr><td>#${fmt(x.representative_no)} · ${x.representative_puid}</td><td>${fmt(x.member_count)}</td><td>${x.avg_similarity==null?'-':Number(x.avg_similarity).toFixed(4)}</td><td>${x.min_similarity==null?'-':Number(x.min_similarity).toFixed(4)}</td><td>${x.max_similarity==null?'-':Number(x.max_similarity).toFixed(4)}</td><td>${fmt(x.run_no)}</td></tr>`).join('')||'<tr><td colspan="6">자료 없음</td></tr>';}catch(e){tb.innerHTML=`<tr><td colspan="6">조회 실패: ${String(e&&e.message||e)}</td></tr>`;}
}
setTimeout(()=>void loadRepresentativeStatus(),300);
