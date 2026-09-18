// GM_BUILDER_RUNTIME_CONFIG_UI_V004_SPECIAL_ORDER_BOARD
// Central runtime-config UI only. SPECIAL order is managed by a dedicated ordered board.

function cfgEsc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function cfgRowValue(items,key){const x=(items||[]).find(r=>r.config_key===key);return x?x.config_value:'-';}
function paintRuntimeSummary(items){
  const el=document.getElementById('runtimeVersionSummary');if(!el)return;
  el.innerHTML=`<tr><th>gm_v1</th><td>${cfgEsc(cfgRowValue(items,'gm_v1'))}</td></tr><tr><th>gm_v2</th><td>${cfgEsc(cfgRowValue(items,'gm_v2'))}</td></tr><tr><th>gm_v3</th><td>${cfgEsc(cfgRowValue(items,'gm_v3'))}</td></tr><tr><th>상품 마진율</th><td>${cfgEsc(cfgRowValue(items,'product_margin_rate'))}%</td></tr><tr><th>대표벡터 유사율</th><td>${cfgEsc(cfgRowValue(items,'image_vector_representative_similarity'))}</td></tr><tr><th>대표벡터 RUN</th><td>${cfgEsc(cfgRowValue(items,'image_vector_representative_run'))}</td></tr><tr><th>DEVICE_LANG</th><td>${cfgEsc(cfgRowValue(items,'device_lang_enabled'))}</td></tr><tr><th>생성모드</th><td>${cfgEsc(cfgRowValue(items,'device_lang_background_mode'))}</td></tr>`;
}
async function loadRuntimeConfig(){
  const tb=document.getElementById('runtimeConfigRows');if(!tb)return;
  try{
    const r=await fetch(`${API}/api/gm/builder/config?t=${Date.now()}`,{cache:'no-store'});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||`HTTP ${r.status}`);
    const items=j.items||[];paintRuntimeSummary(items);
    tb.innerHTML=items.map(x=>{const protectedKey=x.config_key==='gm_v1'||x.config_key==='gm_v2';return `<tr data-key="${cfgEsc(x.config_key)}"><td>${cfgEsc(x.category)}</td><td><b>${cfgEsc(x.config_key)}</b></td><td><input class="c-val" value="${cfgEsc(x.config_value)}" ${protectedKey?'readonly':''}></td><td><input class="c-type" value="${cfgEsc(x.value_type)}" ${protectedKey?'readonly':''}></td><td><input class="c-mode" value="${cfgEsc(x.mode)}" ${protectedKey?'readonly':''}></td><td><input class="c-on" type="checkbox" ${x.enabled?'checked':''} ${protectedKey?'disabled':''}></td><td><input class="c-desc" value="${cfgEsc(x.description||'')}" ${protectedKey?'readonly':''}></td><td>${protectedKey?'-':`<button onclick="saveRuntimeRow(this)">저장</button>`}</td></tr>`;}).join('');
  }catch(e){tb.innerHTML=`<tr><td colspan="8">설정 조회 실패: ${cfgEsc(e&&e.message||e)}</td></tr>`;}
}
async function saveRuntimeRow(btn){
  const tr=btn.closest('tr');const body={config_key:tr.dataset.key,config_value:tr.querySelector('.c-val').value,value_type:tr.querySelector('.c-type').value,category:tr.children[0].textContent.trim(),mode:tr.querySelector('.c-mode').value,enabled:tr.querySelector('.c-on').checked,description:tr.querySelector('.c-desc').value};
  const r=await fetch(`${API}/api/gm/builder/config`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json();if(!r.ok||!j.ok){alert(j.error||`HTTP ${r.status}`);return;}log({action:'runtime-config.saved',key:body.config_key,value:body.config_value});await loadRuntimeConfig();
}
async function addRuntimeConfig(){
  const body={config_key:document.getElementById('cfgKey').value.trim(),config_value:document.getElementById('cfgValue').value.trim(),category:document.getElementById('cfgCategory').value.trim(),value_type:document.getElementById('cfgType').value,mode:document.getElementById('cfgMode').value.trim(),description:document.getElementById('cfgDesc').value.trim(),enabled:true};
  if(!body.config_key){alert('config_key를 입력하세요.');return;}
  const r=await fetch(`${API}/api/gm/builder/config`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json();if(!r.ok||!j.ok){alert(j.error||`HTTP ${r.status}`);return;}log({action:'runtime-config.added',key:body.config_key});await loadRuntimeConfig();
}
async function nextGmV2(){const r=await fetch(`${API}/api/gm/builder/config/gm-v2/next`,{method:'POST'});const j=await r.json();if(!r.ok||!j.ok){alert(j.error||`HTTP ${r.status}`);return;}log({action:'gm_v2.next',value:j.item&&j.item.config_value});await loadRuntimeConfig();}

let specialPlanAll=[];
let specialPlanSelected=[];
function specialPlanEsc(v){return cfgEsc(v);}
function specialPlanByPrefix(prefix){return specialPlanAll.find(x=>x.prefix===prefix)||null;}
function paintSpecialOrderPreview(){
  const el=document.getElementById('specialCategoryPlanPreview');if(!el)return;
  el.textContent=specialPlanSelected.length?'실행순서: '+specialPlanSelected.map((x,i)=>`${i+1}. ${x.name_ko}(${x.prefix})`).join(' → '):'실행순서: 선택된 카테고리 없음';
}
function renderSpecialPlan(){
  const selectedEl=document.getElementById('specialSelectedList'),availableEl=document.getElementById('specialAvailableList');
  if(!selectedEl||!availableEl)return;
  selectedEl.innerHTML=specialPlanSelected.length?specialPlanSelected.map((x,i)=>`<div data-prefix="${specialPlanEsc(x.prefix)}" style="display:grid;grid-template-columns:42px 1fr auto;gap:8px;align-items:center;border:1px solid #d7d7d7;border-radius:9px;padding:8px 10px;background:#fff"><b>${i+1}</b><span><b>${specialPlanEsc(x.name_ko)}</b> <span class="small">${specialPlanEsc(x.prefix)}</span></span><span style="white-space:nowrap"><button onclick="moveSpecialCategory('${specialPlanEsc(x.prefix)}',-1)" ${i===0?'disabled':''}>↑</button> <button onclick="moveSpecialCategory('${specialPlanEsc(x.prefix)}',1)" ${i===specialPlanSelected.length-1?'disabled':''}>↓</button> <button class="gray" onclick="removeSpecialCategory('${specialPlanEsc(x.prefix)}')">제외</button></span></div>`).join(''):'<div class="status">선택된 SPECIAL 카테고리가 없습니다.</div>';
  const selectedSet=new Set(specialPlanSelected.map(x=>x.prefix));
  const available=specialPlanAll.filter(x=>!selectedSet.has(x.prefix));
  availableEl.innerHTML=available.length?available.map(x=>`<div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;border:1px solid #d7d7d7;border-radius:9px;padding:8px 10px;background:#fff"><span><b>${specialPlanEsc(x.name_ko)}</b> <span class="small">${specialPlanEsc(x.prefix)}</span></span><button onclick="addSpecialCategory('${specialPlanEsc(x.prefix)}')">추가</button></div>`).join(''):'<div class="status">모든 대분류가 실행 순서에 들어 있습니다.</div>';
  paintSpecialOrderPreview();
}
window.moveSpecialCategory=function(prefix,delta){
  const i=specialPlanSelected.findIndex(x=>x.prefix===prefix);if(i<0)return;const j=i+Number(delta||0);if(j<0||j>=specialPlanSelected.length)return;
  [specialPlanSelected[i],specialPlanSelected[j]]=[specialPlanSelected[j],specialPlanSelected[i]];renderSpecialPlan();
};
window.removeSpecialCategory=function(prefix){specialPlanSelected=specialPlanSelected.filter(x=>x.prefix!==prefix);renderSpecialPlan();};
window.addSpecialCategory=function(prefix){const x=specialPlanByPrefix(prefix);if(!x||specialPlanSelected.some(y=>y.prefix===prefix))return;specialPlanSelected.push(x);renderSpecialPlan();};
async function loadSpecialCategoryPlan(){
  const st=document.getElementById('specialCategoryPlanStatus'),ym=document.getElementById('specialApplyYm');if(!ym)return;
  try{
    const r=await fetch(`${API}/api/gm/builder/config/special-category-plan?t=${Date.now()}`,{cache:'no-store'});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||`HTTP ${r.status}`);
    ym.value=j.apply_ym||'';
    specialPlanAll=(j.categories||[]).map(x=>({prefix:String(x.prefix||''),name_ko:String(x.name_ko||''),sort_order:x.sort_order,no:x.no==null?null:Number(x.no)}));
    specialPlanSelected=specialPlanAll.filter(x=>Number.isInteger(x.no)&&x.no>0).sort((a,b)=>a.no-b.no||a.prefix.localeCompare(b.prefix));
    if(st)st.textContent=`적용연월 ${j.apply_ym||'-'} · 실행 ${specialPlanSelected.length}개 · 제외 ${Math.max(0,specialPlanAll.length-specialPlanSelected.length)}개`;
    renderSpecialPlan();
  }catch(e){if(st)st.textContent='SPECIAL 순서 조회 실패: '+String(e&&e.message||e);const pv=document.getElementById('specialCategoryPlanPreview');if(pv)pv.textContent='실행순서 조회 실패';}
}
async function saveSpecialCategoryPlan(){
  const ym=document.getElementById('specialApplyYm');if(!ym)return;
  if(!/^\d{4}-\d{2}$/.test(ym.value)){alert('적용연월을 선택하세요.');return;}
  if(!specialPlanSelected.length){alert('SPECIAL에서 처리할 대분류를 최소 1개 선택하세요.');return;}
  const categories=specialPlanSelected.map((x,i)=>({prefix:x.prefix,no:i+1}));
  const r=await fetch(`${API}/api/gm/builder/config/special-category-plan`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apply_ym:ym.value,categories})});const j=await r.json();
  if(!r.ok||!j.ok){alert(j.error||`HTTP ${r.status}`);return;}
  log({action:'special-category-plan.saved',apply_ym:ym.value,order:j.order||categories});
  const st=document.getElementById('specialCategoryPlanStatus');if(st)st.textContent=`저장 완료 · ${ym.value} · ${(j.order||categories).length}개`;
  await loadSpecialCategoryPlan();
}

window.addEventListener('DOMContentLoaded',()=>{loadRuntimeConfig();loadSpecialCategoryPlan();});
