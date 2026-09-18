// GM_BUILDER_RUNTIME_CONFIG_UI_V003_SPECIAL_ORDER
// Central runtime-config UI only. No image-vector or device-language logic belongs here.

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

loadRuntimeConfig();

function toggleRuntimeConfig(){const c=document.getElementById('runtimeConfigCard');if(!c)return;const open=c.style.display==='none';c.style.display=open?'block':'none';if(open){loadRuntimeConfig();loadSpecialCategoryPlan();}}

// GM_BUILDER_SPECIAL_CATEGORY_PLAN_V002_V046_COMPAT
function specialPlanEsc(v){return cfgEsc(v);}
function paintSpecialOrderPreview(){
  const el=document.getElementById('specialCategoryPlanPreview'),tb=document.getElementById('specialCategoryPlanRows');if(!el||!tb)return;
  const rows=[];
  for(const tr of tb.querySelectorAll('tr[data-prefix]')){const input=tr.querySelector('.sp-order');const no=Number(input&&input.value||0);if(Number.isInteger(no)&&no>0)rows.push({no,prefix:tr.dataset.prefix,name:(tr.children[2]&&tr.children[2].textContent||'').trim()});}
  rows.sort((a,b)=>a.no-b.no||a.prefix.localeCompare(b.prefix));
  el.textContent=rows.length?('실행순서: '+rows.map(x=>`${x.no}. ${x.name}(${x.prefix})`).join(' → ')):'실행순서: 번호를 지정한 카테고리 없음';
}
async function loadSpecialCategoryPlan(){
  const tb=document.getElementById('specialCategoryPlanRows'),st=document.getElementById('specialCategoryPlanStatus'),ym=document.getElementById('specialApplyYm');if(!tb||!ym)return;
  try{
    const r=await fetch(`${API}/api/gm/builder/config/special-category-plan?t=${Date.now()}`,{cache:'no-store'});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||`HTTP ${r.status}`);
    ym.value=j.apply_ym||'';
    const rows=j.categories||[];
    tb.innerHTML=rows.map(x=>`<tr data-prefix="${specialPlanEsc(x.prefix)}"><td><input class="sp-order" type="number" min="1" step="1" value="${x.no==null?'':specialPlanEsc(x.no)}" style="width:80px"></td><td><b>${specialPlanEsc(x.prefix)}</b></td><td>${specialPlanEsc(x.name_ko)}</td><td>${specialPlanEsc(x.sort_order)}</td></tr>`).join('')||'<tr><td colspan="4">대분류 없음</td></tr>';
    tb.querySelectorAll('.sp-order').forEach(el=>el.addEventListener('input',paintSpecialOrderPreview));
    if(st)st.textContent=`적용연월 ${j.apply_ym||'-'} · 번호 지정 ${rows.filter(x=>x.no!=null).length}개 · 번호 없음은 SPECIAL 제외`; paintSpecialOrderPreview();
  }catch(e){tb.innerHTML=`<tr><td colspan="4">SPECIAL 계획 조회 실패: ${specialPlanEsc(e&&e.message||e)}</td></tr>`;if(st)st.textContent='조회 실패';const pv=document.getElementById('specialCategoryPlanPreview');if(pv)pv.textContent='실행순서 조회 실패';}
}
async function saveSpecialCategoryPlan(){
  const ym=document.getElementById('specialApplyYm'),tb=document.getElementById('specialCategoryPlanRows');if(!ym||!tb)return;
  const categories=[];const used=new Set();
  for(const tr of tb.querySelectorAll('tr[data-prefix]')){
    const raw=tr.querySelector('.sp-order').value.trim();if(!raw)continue;
    const no=Number(raw);if(!Number.isInteger(no)||no<1){alert('번호는 1 이상의 정수만 가능합니다.');return;}
    if(used.has(no)){alert(`중복 번호 ${no}가 있습니다.`);return;}used.add(no);categories.push({prefix:tr.dataset.prefix,no});
  }
  if(!/^\d{4}-\d{2}$/.test(ym.value)){alert('적용연월을 선택하세요.');return;}
  if(!categories.length){alert('최소 1개 대분류에 번호를 지정하세요.');return;}
  categories.sort((a,b)=>a.no-b.no||a.prefix.localeCompare(b.prefix));
  const r=await fetch(`${API}/api/gm/builder/config/special-category-plan`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apply_ym:ym.value,categories})});const j=await r.json();if(!r.ok||!j.ok){alert(j.error||`HTTP ${r.status}`);return;}
  log({action:'special-category-plan.saved',apply_ym:ym.value,order:j.order||categories});const st=document.getElementById('specialCategoryPlanStatus');if(st)st.textContent=`저장 완료 · ${ym.value} · ${(j.order||categories).length}개`;await loadRuntimeConfig();await loadSpecialCategoryPlan();
}

