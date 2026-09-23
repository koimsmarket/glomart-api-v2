// GM_BUILDER_PRODUCT_GLOMART_CODE_UI_V016_CATEGORY_6SEG_IDENTITY_MATCH
'use strict';
async function gmCodeFetch(path,opt){const r=await fetch(`${API}${path}`,opt);const j=await r.json().catch(()=>({ok:false,error:`HTTP_${r.status}`}));if(!r.ok||!j.ok){const base=j.error||`HTTP ${r.status}`,detail=j.detail?` · ${j.detail}`:'';throw new Error(base+detail);}return j;}
function gmCodeEsc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function gmCodeSummary(j){const s=j.summary||{};return `매칭 ${s.matched||0} (단일 ${s.matched_single||0} / 복수 ${s.matched_multi||0}) · 애매 ${s.ambiguous||0} · 미매칭 ${s.unmatched||0}`;}
async function loadProductGmCodeStatus(){const el=document.getElementById('gmCodeStatus');if(!el)return;try{const j=await gmCodeFetch('/api/gm/builder/product-gm-code/status?t='+Date.now());el.innerHTML=`전체 <b>${j.total||0}</b> · glomart_code 있음 <b>${j.filled||0}</b> · 복수코드 <b>${j.multi||0}</b> · 미분류 <b>${j.empty||0}</b>`;}catch(e){el.textContent=String(e.message||e);}}
async function previewProductGmCode(){const btn=document.getElementById('gmCodePreviewBtn'),body=document.getElementById('gmCodePreviewRows'),sum=document.getElementById('gmCodePreviewSummary');const timer=startButtonTimer(btn,'미리보기');try{const limit=Math.min(Math.max(Number(document.getElementById('gmCodePreviewLimit').value||300),1),2000),j=await gmCodeFetch(`/api/gm/builder/product-gm-code/preview?limit=${limit}&t=${Date.now()}`);sum.textContent=gmCodeSummary(j)+' · '+JSON.stringify((j.summary&&j.summary.by)||{})+` · 이력학습 ${j.history&&j.history.learned||0}`;body.innerHTML=(j.items||[]).map(x=>`<tr><td>${gmCodeEsc(x.product_uid)}</td><td>${gmCodeEsc(x.cp_selected_code)}</td><td>${gmCodeEsc(x.cp_fix_code)}</td><td>${gmCodeEsc(x.mall_category)}</td><td>${gmCodeEsc(x.category_keyword)}</td><td>${gmCodeEsc(x.keyword)}</td><td>${gmCodeEsc(x.match_by)}</td><td>${gmCodeEsc(x.source_field)}</td><td>${gmCodeEsc(x.source_value)}</td><td><b>${gmCodeEsc(x.gm_code)}</b></td><td>${gmCodeEsc(x.category_name)}</td><td>${gmCodeEsc(x.history_count||0)}</td></tr>`).join('')||'<tr><td colspan="12">대상 없음</td></tr>';log({action:j.action,summary:j.summary,history:j.history});}catch(e){sum.textContent=String(e.message||e);log(String(e.message||e));}finally{stopButtonTimer(timer);}}

function gmKeywordNormSummary(n){n=n||{};return `한국어 정제 상품 ${n.updated_products||0} · 변환 필드 ${n.field_changes||0} · 매핑어 ${n.mapped_terms||0} · 미해결어 ${n.unresolved_terms||0} · 다중후보 ${n.ambiguous_terms||0}`;}
async function normalizeProductKeywords(){const btn=document.getElementById('gmCodeNormalizeBtn'),sum=document.getElementById('gmCodePreviewSummary');const timer=startButtonTimer(btn,'한국어 정제');try{const j=await gmCodeFetch('/api/gm/builder/product-gm-code/normalize-keywords',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const n=j.normalization||{};sum.textContent=gmKeywordNormSummary(n);log(j);await loadProductGmCodeStatus();}catch(e){sum.textContent=String(e.message||e);log(String(e.message||e));alert(String(e.message||e));}finally{stopButtonTimer(timer);}}
async function analyzeProductGmCode(){const btn=document.getElementById('gmCodeAnalyzeBtn'),sum=document.getElementById('gmCodePreviewSummary');const timer=startButtonTimer(btn,'전체 분석');try{const j=await gmCodeFetch('/api/gm/builder/product-gm-code/analyze?t='+Date.now());sum.textContent=`전체 분석 · ${gmKeywordNormSummary(j.normalization)} · 대상 ${j.scanned||0} · ${gmCodeSummary(j)} · `+JSON.stringify((j.summary&&j.summary.by)||{})+` · 이력학습 ${j.history&&j.history.learned||0} · 복수 최대 ${j.multi_max||0}개`;log({action:j.action,scanned:j.scanned,summary:j.summary,history:j.history,multi_max:j.multi_max});}catch(e){sum.textContent=String(e.message||e);log(String(e.message||e));}finally{stopButtonTimer(timer);}}
async function applyProductGmCode(){if(!confirm('glomart_code가 비어 있는 상품만 매칭하여 저장합니다. 복수 정확매칭은 | 구분자로 저장하고 기존 glomart_code는 덮어쓰지 않습니다. 적용할까요?'))return;const btn=document.getElementById('gmCodeApplyBtn'),timer=startButtonTimer(btn,'적용');try{const j=await gmCodeFetch('/api/gm/builder/product-gm-code/apply?confirm=YES',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});log(j);document.getElementById('gmCodePreviewSummary').textContent=`적용 완료 · ${gmKeywordNormSummary(j.normalization)} · glomart_code ${j.updated||0}건 업데이트 · ${gmCodeSummary(j)}`;await loadProductGmCodeStatus();}catch(e){log(String(e.message||e));alert(String(e.message||e));}finally{stopButtonTimer(timer);}}
window.addEventListener('DOMContentLoaded',()=>loadProductGmCodeStatus());
function downloadUnmatchedProductGmCode(){window.location.href=`${API}/api/gm/builder/product-gm-code/unmatched.csv?t=${Date.now()}`;}


async function loadGmKeywordCleanupCandidates(){
  const body=document.getElementById('gmKeywordCleanupRows'),sum=document.getElementById('gmKeywordCleanupSummary'),btn=document.getElementById('gmKeywordCleanupLoadBtn');
  if(!body||!sum)return; const timer=startButtonTimer(btn,'후보 조회');
  try{
    const j=await gmCodeFetch('/api/gm/builder/product-gm-code/cleanup-candidates?limit=1000&t='+Date.now());
    const totalDelete=(j.items||[]).reduce((a,x)=>a+Number(x.deletable_count||0),0), totalProtect=(j.items||[]).reduce((a,x)=>a+Number(x.protected_count||0),0);
    sum.textContent=`검색 0~1회 · 미분류 키워드 후보 ${j.count||0}개 · 삭제가능 합계 ${totalDelete} · 보호 합계 ${totalProtect} (키워드간 중복 포함)`;
    body.innerHTML=(j.items||[]).map((x,i)=>`<tr><td><input type="checkbox" class="gmKwCleanCheck" data-index="${i}"></td><td>${gmCodeEsc(x.value)}</td><td>${gmCodeEsc((x.fields||[]).join(' | '))}</td><td>${gmCodeEsc(x.product_count||0)}</td><td><b>${gmCodeEsc(x.deletable_count||0)}</b></td><td>${gmCodeEsc(x.protected_count||0)}</td><td>${gmCodeEsc(x.protected_order||0)}</td><td>${gmCodeEsc(x.protected_basket||0)}</td><td>${gmCodeEsc(x.protected_wish||0)}</td><td>${gmCodeEsc(x.search_count||0)}</td><td>${gmCodeEsc(x.first_search_at||'')}</td><td>${gmCodeEsc(x.last_search_at||'')}</td><td>${gmCodeEsc((x.samples||[]).join(' / '))}</td></tr>`).join('')||'<tr><td colspan="13">후보 없음</td></tr>';
    window.__GM_KW_CLEAN_ITEMS=j.items||[];
  }catch(e){sum.textContent=String(e.message||e);log(String(e.message||e));}finally{stopButtonTimer(timer);}
}
function gmKeywordCleanupSelectAll(on){document.querySelectorAll('.gmKwCleanCheck').forEach(x=>x.checked=!!on);}
async function deleteSelectedGmKeywords(){
  const all=window.__GM_KW_CLEAN_ITEMS||[],sel=[];
  document.querySelectorAll('.gmKwCleanCheck:checked').forEach(c=>{const x=all[Number(c.dataset.index)];if(x)sel.push({value:x.value,fields:x.fields});});
  if(!sel.length){alert('정리할 이상 키워드를 선택해 주세요.');return;}
  const allSelected=sel.map(x=>all.find(y=>y.value===x.value)).filter(Boolean);
  const deleteEstimate=allSelected.reduce((a,x)=>a+Number(x.deletable_count||0),0);
  const protectEstimate=allSelected.reduce((a,x)=>a+Number(x.protected_count||0),0);
  if(!confirm(`선택한 ${sel.length}개 이상 키워드에 연결된 미분류 상품을 정리합니다.\n\n삭제가능 표시 합계: ${deleteEstimate}건 (키워드간 중복 가능)\n보호 표시 합계: ${protectEstimate}건\n\n주문/판매/장바구니/찜 이력이 있는 상품은 서버에서 다시 검사하여 삭제하지 않습니다. 실제 상품 행을 삭제할까요?`))return;
  const btn=document.getElementById('gmKeywordCleanupDeleteBtn'),timer=startButtonTimer(btn,'상품 정리');
  try{const j=await gmCodeFetch('/api/gm/builder/product-gm-code/cleanup-delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:sel,confirm:'DELETE UNCLASSIFIED PRODUCTS'})});document.getElementById('gmKeywordCleanupSummary').textContent=`정리 완료 · 후보상품 ${j.candidate_products||0} · 삭제 ${j.deleted_products||0} · 보호 ${j.protected_products||0}`;log(j);await loadGmKeywordCleanupCandidates();await loadProductGmCodeStatus();}catch(e){alert(String(e.message||e));log(String(e.message||e));}finally{stopButtonTimer(timer);}
}


async function gmFdHsCategoryFileText(){
  const el=document.getElementById('gmFdHsCategoryFile'),f=el&&el.files&&el.files[0];
  if(!f)throw new Error('FD/HS 최종 CSV 파일을 선택하세요.');
  if(!/\.csv$/i.test(f.name))throw new Error('최종 업로드는 CSV 파일만 사용하세요.');
  return {file:f,text:await f.text(),prefix:String(document.getElementById('gmFdHsCategoryPrefix').value||'').toUpperCase()};
}
function gmFdHsCategorySummary(j){
  return `${j.prefix||''} · 현재 ${j.current_rows||0}행 · 파일 ${j.file_rows||0}행 · 기존 ${j.existing_rows||0}행 · 신규 ${j.new_rows||0}행 · cp기존 ${j.cp_existing||0} · cp신규 ${j.cp_new||0} · 가상ID ${j.id_existing||0} · 비표준기존 ${j.gm_existing||0} · 비표준신규 ${j.gm_new||0} · 부모검증 ${j.parent_check?'Y':'N'}`;
}
async function previewFdHsCategoryReplace(){
  const btn=document.getElementById('gmFdHsCategoryPreviewBtn'),sum=document.getElementById('gmFdHsCategorySummary'),timer=startButtonTimer(btn,'카테고리 검증');
  try{
    const x=await gmFdHsCategoryFileText();
    const j=await gmCodeFetch(`/api/gm/builder/product-gm-code/fd-hs-category/preview?prefix=${encodeURIComponent(x.prefix)}&t=${Date.now()}`,{
      method:'POST',headers:{'Content-Type':'text/csv; charset=utf-8'},body:x.text
    });
    sum.textContent='검증 완료 · '+gmFdHsCategorySummary(j);log(j);
  }catch(e){
    sum.textContent=String(e.message||e);log(String(e.message||e));alert(String(e.message||e));
  }finally{stopButtonTimer(timer);}
}
async function applyFdHsCategoryReplace(){
  let x;try{x=await gmFdHsCategoryFileText();}catch(e){alert(String(e.message||e));return;}
  const typed=prompt(`${x.prefix} 최종 6세그먼트 카테고리를 적용합니다.\n\n실행하려면 APPLY 를 입력하세요.`);
  if(typed!=='APPLY')return;
  const btn=document.getElementById('gmFdHsCategoryApplyBtn'),sum=document.getElementById('gmFdHsCategorySummary'),timer=startButtonTimer(btn,'카테고리 적용');
  try{
    const confirmCode='APPLY';
    const j=await gmCodeFetch(`/api/gm/builder/product-gm-code/fd-hs-category/apply?prefix=${encodeURIComponent(x.prefix)}&confirm=${encodeURIComponent(confirmCode)}`,{
      method:'POST',headers:{'Content-Type':'text/csv; charset=utf-8'},body:x.text
    });
    sum.textContent=`적용 완료 · ${j.prefix} 기존 ${j.updated_existing||0}행 갱신 · 신규 ${j.inserted_new||0}행 · 최종 ${j.total_rows||0}행 · 검증 ${j.post_verify?'OK':'NG'}`;
    log(j);
  }catch(e){
    sum.textContent=String(e.message||e);log(String(e.message||e));alert(String(e.message||e));
  }finally{stopButtonTimer(timer);}
}

function gmFdHs6Summary(j){const s=j&&j.summary||{};return `대상 ${s.target||0} · 매칭 ${s.matched||0} · 변경 ${s.changed||0} · 동일 ${s.same||0} · 미매칭 ${s.unmatched||0} · 범위외 ${s.outside_scope||0}`;}
async function previewFdHs6DepthRematch(){
  const btn=document.getElementById('gmFdHs6PreviewBtn'),body=document.getElementById('gmFdHs6Rows'),sum=document.getElementById('gmFdHs6Summary');
  const timer=startButtonTimer(btn,'FD/HS 미리보기');
  try{
    const limit=Math.min(Math.max(Number(document.getElementById('gmCodePreviewLimit').value||300),1),2000);
    const j=await gmCodeFetch(`/api/gm/builder/product-gm-code/fd-hs-6depth/preview?limit=${limit}&t=${Date.now()}`);
    sum.textContent=gmFdHs6Summary(j)+` · 6단계 FD/HS 카테고리 ${j.category_count||0}개 · 이력학습 ${j.history&&j.history.learned||0}`;
    body.innerHTML=(j.items||[]).map(x=>`<tr><td>${gmCodeEsc(x.product_uid)}</td><td>${gmCodeEsc(x.current_glomart_code)}</td><td><b>${gmCodeEsc(x.resolved_glomart_code||'')}</b></td><td>${x.changed?'<b>변경</b>':(x.eligible?'동일':'보류')}</td><td>${gmCodeEsc(x.match_by)}</td><td>${gmCodeEsc(x.source_field)}</td><td>${gmCodeEsc(x.source_value)}</td><td>${gmCodeEsc(x.keyword)}</td><td>${gmCodeEsc(x.category_keyword)}</td></tr>`).join('')||'<tr><td colspan="9">대상 없음</td></tr>';
    log({action:j.action,summary:j.summary,history:j.history,category_count:j.category_count});
  }catch(e){sum.textContent=String(e.message||e);log(String(e.message||e));}
  finally{stopButtonTimer(timer);}
}
async function applyFdHs6DepthRematch(){
  const typed=prompt('FD/HS 기존 glomart_code를 새 6단계 카테고리로 재매칭합니다.\n\n실행하려면 APPLY 를 입력하세요.');
  if(typed!=='APPLY')return;
  const btn=document.getElementById('gmFdHs6ApplyBtn'),sum=document.getElementById('gmFdHs6Summary'),timer=startButtonTimer(btn,'FD/HS 적용');
  try{
    const j=await gmCodeFetch('/api/gm/builder/product-gm-code/fd-hs-6depth/apply?confirm=FDHS_REMAP',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:'FDHS_REMAP'})});
    sum.textContent=`적용 완료 · ${gmFdHs6Summary(j)} · 실제 업데이트 ${j.updated||0}건 · ${gmKeywordNormSummary(j.normalization)}`;
    log(j);await loadProductGmCodeStatus();
  }catch(e){sum.textContent=String(e.message||e);log(String(e.message||e));alert(String(e.message||e));}
  finally{stopButtonTimer(timer);}
}

