// GM_BUILDER_IMAGE_VECTOR_CLASSIFICATION_UI_V001
// Classification UI only.
// IMPORTANT:
// - This is separate from IMAGE VECTOR BACKGROUND OFF/AUTO/ON.
// - DRY RUN = calculate only, no DB changes.
// - APPLY = create gm_vector_category and assign gm_product_image_vector.class_id together.
// - Lightweight exports intentionally exclude vector_image/vector_center payloads.

let ivClassPollTimer = null;

function ivClassGroups(){
  const el=document.getElementById('ivClassGroups');
  return String(el&&el.value||'FD').trim().toUpperCase();
}
function ivClassFmtState(s){
  return ({IDLE:'대기',STARTING:'시작 중',START:'시작',PRODUCT_SCOPE:'대상 확인',LOADED:'Vector 로드 완료',BUILDING:'분류 중',RESULT:'분류 계산 완료',APPLIED:'DB 적용 완료',COMPLETE:'완료',FAILED:'실패'})[String(s||'')]||String(s||'-');
}
function ivClassSetButtons(running){
  ['ivClassDryRun','ivClassApply'].forEach(id=>{const b=document.getElementById(id);if(b)b.disabled=!!running;});
}
function ivClassRender(j){
  const s=j&&j.state||{};
  const d=j&&j.database||{};
  const r=s.result||{};
  const p=s.progress||{};
  const status=document.getElementById('ivClassStatus');
  if(status){
    status.innerHTML=`
      <tr><th>대상 대분류</th><td><b>${(d.groups||s.groups||[]).join(', ')||'-'}</b></td></tr>
      <tr><th>실행 모드</th><td>${s.mode||'-'}</td></tr>
      <tr><th>현재 상태</th><td><b>${ivClassFmtState(s.phase)}</b>${s.running?' · 실행중':''}</td></tr>
      <tr><th>대상 원본512</th><td>${fmt(d.total||p.vectors||0)}건</td></tr>
      <tr><th>현재 카테고리</th><td>Node ${fmt(d.nodes||0)} / Leaf ${fmt(d.leaves||0)}</td></tr>
      <tr><th>선택범위 class_id</th><td>${fmt(d.assigned||0)}건 / 미기록 ${fmt(d.unassigned||0)}건</td></tr>
      <tr><th>전체 class_id / Leaf 합계</th><td>${fmt(d.assigned_all||0)} / ${fmt(d.leaf_product_count||0)} ${Number(d.assigned_all||0)===Number(d.leaf_product_count||0)?'✓':'⚠'}</td></tr>
      <tr><th>참조 오류</th><td>${fmt(d.orphan_assignments||0)}건</td></tr>
      <tr><th>진행</th><td>Node ${fmt(p.nodes||0)} / Leaf 배정 ${fmt(p.leaf_assigned||0)} / Depth ${p.current_depth==null?'-':p.current_depth}</td></tr>
      <tr><th>DRY/APPLY 결과</th><td>${r.vectors!=null?`Vector ${fmt(r.vectors)} / Node ${fmt(r.nodes)} / Leaf ${fmt(r.leaves)} / Max depth ${r.max_depth} / 평균 Leaf ${r.avg_leaf} / 최대 Leaf ${r.max_leaf} / cohesion ${r.avg_leaf_cohesion} / assigned ${fmt(r.assigned_check)} / ${fmt(r.total_elapsed_ms)} ms`:'-'}</td></tr>
      <tr><th>오류</th><td>${s.error||'-'}</td></tr>`;
  }
  ivClassSetButtons(!!s.running);
  const logEl=document.getElementById('ivClassLog');
  if(logEl)logEl.textContent=(s.logs||[]).slice(-40).join('\n')||'분류 로그 없음';
}
async function loadImageVectorClassificationStatus(){
  try{
    const groups=encodeURIComponent(ivClassGroups());
    const r=await fetch(`${API}/api/gm/builder/image-vector/classification/status?groups=${groups}&t=${Date.now()}`,{cache:'no-store'});
    const j=await r.json();
    if(!r.ok||!j.ok)throw new Error(j.detail||j.error||`HTTP ${r.status}`);
    ivClassRender(j);
    if(j.state&&j.state.running){
      if(!ivClassPollTimer)ivClassPollTimer=setInterval(loadImageVectorClassificationStatus,3000);
    }else if(ivClassPollTimer){
      clearInterval(ivClassPollTimer);ivClassPollTimer=null;
    }
  }catch(e){
    const out=document.getElementById('ivClassResult');
    if(out)out.textContent='분류 상태 조회 실패: '+String(e&&e.message||e);
  }
}
async function startImageVectorClassification(apply,button){
  const groups=ivClassGroups();
  if(!groups){alert('대상 대분류 코드를 입력하세요. 예: FD 또는 FD,HS');return;}
  if(apply){
    const msg=`${groups} 범위로 시각 카테고리를 실제 재생성합니다.\n\n`+
      `gm_vector_category와 class_id는 선택한 범위 기준으로 함께 교체됩니다.\n`+
      `원본 vector_image / category_group은 변경하지 않습니다.\n\n계속할까요?`;
    if(!confirm(msg))return;
  }
  const timed=startButtonTimer(button,apply?'분류 적용 시작':'분류 검증 시작');
  const out=document.getElementById('ivClassResult');
  try{
    const r=await fetch(`${API}/api/gm/builder/image-vector/classification/start`,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({groups,apply:!!apply})
    });
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.detail||j.error||`HTTP ${r.status}`);
    if(out)out.textContent=`${apply?'APPLY':'DRY RUN'} 시작: ${groups} / PID ${j.pid||'-'}`;
    log({action:apply?'image-vector.classification.apply.start':'image-vector.classification.dryrun.start',...j});
    await loadImageVectorClassificationStatus();
  }catch(e){
    const msg=String(e&&e.message||e);if(out)out.textContent='분류 시작 실패: '+msg;log('image-vector classification error: '+msg);
  }finally{stopButtonTimer(timed);}
}
function downloadVectorClassCategories(){
  window.location.href=`${API}/api/gm/builder/image-vector/classification/export/categories.csv?t=${Date.now()}`;
}
function downloadVectorClassAssignments(){
  const groups=encodeURIComponent(ivClassGroups());
  window.location.href=`${API}/api/gm/builder/image-vector/classification/export/assignments.csv?groups=${groups}&t=${Date.now()}`;
}

loadImageVectorClassificationStatus();
