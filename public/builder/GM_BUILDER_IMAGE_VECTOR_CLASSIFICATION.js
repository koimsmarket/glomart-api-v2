// GM_BUILDER_IMAGE_VECTOR_CLASSIFICATION_UI_V003
// V032 Classification UI only.
// - 분류 생성 = 운영 DB를 건드리지 않고 STAGING 결과를 만든다.
// - APPLY = 검증된 STAGING을 운영 gm_vector_category + class_id에 함께 반영한다.
// - STAGING은 APPLY 후에도 보존되며 다음 분류 시작 직전 자동 삭제된다.
// - 필요하면 사용자가 "STAGING 삭제" 버튼으로 수동 삭제할 수 있다.
// - 512D vector_image/vector_center는 경량 검증 다운로드에 포함하지 않는다.

let ivClassPollTimer=null;
function ivClassGroups(){const el=document.getElementById('ivClassGroups');return String(el&&el.value||'FD').trim().toUpperCase();}
function ivClassFmtState(s){return({IDLE:'대기',STARTING:'시작 중',START:'시작',PRODUCT_SCOPE:'대상 확인',LOADING:'Vector 배치 로드',LOADED:'Vector 로드 완료',BUILDING:'카테고리 생성 중',RESULT:'분류 계산 완료',STAGING:'STAGING 기록 중',STAGED:'STAGING 완료',APPLIED:'운영 DB 적용 완료',COMPLETE:'완료',FAILED:'실패'})[String(s||'')]||String(s||'-');}
function ivClassSetButtons(running){['ivClassBuild','ivClassApply','ivClassClearStage'].forEach(id=>{const b=document.getElementById(id);if(b)b.disabled=!!running;});const c=document.getElementById('ivClassCancel');if(c)c.disabled=!running;}
function ivClassRender(j){
  const s=j&&j.state||{},d=j&&j.database||{},st=j&&j.stage||{},r=s.result||{},p=s.progress||{};
  const status=document.getElementById('ivClassStatus');if(status)status.innerHTML=`
    <tr><th>대상 대분류</th><td><b>${(d.groups||s.groups||[]).join(', ')||'-'}</b></td></tr>
    <tr><th>현재 상태</th><td><b>${ivClassFmtState(s.phase)}</b>${s.running?' · 실행중':''}</td></tr>
    <tr><th>STAGING JOB</th><td>${st.job_id||s.job_id||'-'}</td></tr>
    <tr><th>대상 원본512</th><td>${fmt(d.total||p.total_vectors||p.vectors||0)}건</td></tr>
    <tr><th>STAGING 카테고리</th><td>Node ${fmt(st.nodes||0)} / Leaf ${fmt(st.leaves||0)}</td></tr>
    <tr><th>STAGING PUID 배정</th><td>${fmt(st.assignments||0)} / Leaf 합계 ${fmt(st.leaf_product_count||0)} ${Number(st.assignments||0)===Number(st.leaf_product_count||0)&&Number(st.assignments||0)>0?'✓':''}</td></tr>
    <tr><th>STAGING 오류</th><td>참조 ${fmt(st.orphan_assignments||0)} / 중복 ${fmt(st.duplicate_assignments||0)}</td></tr>
    <tr><th>운영 카테고리</th><td>Node ${fmt(d.nodes||0)} / Leaf ${fmt(d.leaves||0)}</td></tr>
    <tr><th>운영 class_id</th><td>선택범위 ${fmt(d.assigned||0)} / 미기록 ${fmt(d.unassigned||0)} / 참조오류 ${fmt(d.orphan_assignments||0)}</td></tr>
    <tr><th>진행</th><td>Vector ${fmt(p.vectors||0)}${p.total_vectors?` / ${fmt(p.total_vectors)}`:''} · Node ${fmt(p.nodes||0)} · Leaf배정 ${fmt(p.leaf_assigned||0)} · Depth ${p.current_depth==null?'-':p.current_depth}</td></tr>
    <tr><th>분류 결과</th><td>${r.vectors!=null?`Vector ${fmt(r.vectors)} / Node ${fmt(r.nodes)} / Leaf ${fmt(r.leaves)} / Max depth ${r.max_depth} / 평균 Leaf ${r.avg_leaf} / 최대 Leaf ${r.max_leaf} / cohesion ${r.avg_leaf_cohesion} / assigned ${fmt(r.assigned_check)} / ${fmt(r.total_elapsed_ms)} ms`:'-'}</td></tr>
    <tr><th>오류</th><td>${s.error||'-'}</td></tr>`;
  ivClassSetButtons(!!s.running);const logEl=document.getElementById('ivClassLog');if(logEl)logEl.textContent=(s.logs||[]).slice(-60).join('\n')||'분류 로그 없음';
}
let ivClassStatusBusy=false;
async function loadImageVectorClassificationStatus(){
  if(ivClassStatusBusy)return;
  ivClassStatusBusy=true;
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),8000);
  try{
    const groups=encodeURIComponent(ivClassGroups());
    const r=await fetch(`${API}/api/gm/builder/image-vector/classification/status?groups=${groups}&t=${Date.now()}`,{cache:'no-store',signal:ctl.signal});
    const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.detail||j.error||`HTTP ${r.status}`);
    ivClassRender(j);
    if(j.state&&j.state.running){if(!ivClassPollTimer)ivClassPollTimer=setInterval(loadImageVectorClassificationStatus,5000);}else if(ivClassPollTimer){clearInterval(ivClassPollTimer);ivClassPollTimer=null;}
  }catch(e){const out=document.getElementById('ivClassResult');if(out)out.textContent='분류 상태 조회 실패: '+(e&&e.name==='AbortError'?'8초 응답시간 초과':String(e&&e.message||e));}
  finally{clearTimeout(timer);ivClassStatusBusy=false;}
}
async function startImageVectorClassification(button){
  const groups=ivClassGroups();if(!groups){alert('대상 대분류 코드를 입력하세요. 예: FD 또는 FD,HS');return;}
  if(!confirm(`${groups} 범위의 새 STAGING 분류를 시작합니다.\n\n직전 STAGING 데이터는 이 시점에 삭제되고 새 결과로 교체됩니다.\n운영 카테고리/class_id는 아직 변경하지 않습니다.\n\n계속할까요?`))return;
  const timed=startButtonTimer(button,'STAGING 분류 시작'),out=document.getElementById('ivClassResult');try{const r=await fetch(`${API}/api/gm/builder/image-vector/classification/start`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({groups})});const j=await r.json().catch(()=>({}));if(!r.ok||!j.ok)throw new Error(j.detail||j.error||`HTTP ${r.status}`);if(out)out.textContent=`STAGING 분류 시작: ${groups} / JOB ${j.job_id||'-'} / PID ${j.pid||'-'}`;log({action:'image-vector.classification.stage.start',...j});await loadImageVectorClassificationStatus();}catch(e){const msg=String(e&&e.message||e);if(out)out.textContent='분류 시작 실패: '+msg;log('image-vector classification error: '+msg);}finally{stopButtonTimer(timed);}
}

async function cancelImageVectorClassification(button){
  if(!confirm('현재 STAGING 분류 작업만 중지합니다.\n운영 카테고리/class_id는 변경하지 않습니다.\n\n중지할까요?'))return;
  const out=document.getElementById('ivClassResult');
  try{
    const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),8000);
    const r=await fetch(`${API}/api/gm/builder/image-vector/classification/cancel`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:ctl.signal});
    clearTimeout(timer);
    const j=await r.json().catch(()=>({}));if(!r.ok||!j.ok)throw new Error(j.detail||j.error||`HTTP ${r.status}`);
    if(out)out.textContent=j.cancelled?`분류 중지 요청 완료 / PID ${j.pid||'-'}`:'실행 중인 분류 작업 없음';
    setTimeout(loadImageVectorClassificationStatus,500);
  }catch(e){if(out)out.textContent='분류 중지 실패: '+String(e&&e.message||e);}
}

async function applyImageVectorClassification(button){
  const groups=ivClassGroups();if(!confirm(`${groups} STAGING 결과를 운영 DB에 적용합니다.\n\n1) gm_vector_category 재생성\n2) gm_product_image_vector.class_id 기록\n을 한 트랜잭션으로 처리합니다.\nSTAGING은 적용 후에도 보존됩니다.\n\n계속할까요?`))return;
  const timed=startButtonTimer(button,'운영 DB 적용'),out=document.getElementById('ivClassResult');try{const r=await fetch(`${API}/api/gm/builder/image-vector/classification/apply`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({groups})});const j=await r.json().catch(()=>({}));if(!r.ok||!j.ok)throw new Error(j.detail||j.error||`HTTP ${r.status}`);if(out)out.textContent=`APPLY 완료: ${fmt(j.applied&&j.applied.assigned||0)}건 / STAGING 보존`;log({action:'image-vector.classification.apply',...j});await loadImageVectorClassificationStatus();}catch(e){const msg=String(e&&e.message||e);if(out)out.textContent='APPLY 실패: '+msg;log('image-vector classification apply error: '+msg);}finally{stopButtonTimer(timed);}
}
async function clearImageVectorClassificationStage(button){
  if(!confirm('현재 STAGING 분류 결과를 수동 삭제합니다.\n운영 gm_vector_category와 class_id는 삭제하지 않습니다.\n\n계속할까요?'))return;
  const timed=startButtonTimer(button,'STAGING 삭제'),out=document.getElementById('ivClassResult');try{const r=await fetch(`${API}/api/gm/builder/image-vector/classification/stage/clear`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const j=await r.json().catch(()=>({}));if(!r.ok||!j.ok)throw new Error(j.detail||j.error||`HTTP ${r.status}`);if(out)out.textContent=`STAGING 삭제 완료: 카테고리 ${fmt(j.categories_deleted||0)} / PUID ${fmt(j.assignments_deleted||0)}`;log({action:'image-vector.classification.stage.clear',...j});await loadImageVectorClassificationStatus();}catch(e){const msg=String(e&&e.message||e);if(out)out.textContent='STAGING 삭제 실패: '+msg;}finally{stopButtonTimer(timed);}
}
function dl(path){window.location.href=`${API}${path}${path.includes('?')?'&':'?'}t=${Date.now()}`;}
function downloadVectorClassStageCategories(){dl('/api/gm/builder/image-vector/classification/export/stage/categories.csv');}
function downloadVectorClassStageAssignments(){dl('/api/gm/builder/image-vector/classification/export/stage/assignments.csv');}
function downloadVectorClassCategories(){dl('/api/gm/builder/image-vector/classification/export/categories.csv');}
function downloadVectorClassAssignments(){const groups=encodeURIComponent(ivClassGroups());dl(`/api/gm/builder/image-vector/classification/export/assignments.csv?groups=${groups}`);}
loadImageVectorClassificationStatus();
