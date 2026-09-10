// GM_BUILDER_RUNTIME_CONFIG_UI_V001
// Central runtime-config UI only. No image-vector or device-language logic belongs here.

function cfgEsc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function cfgRowValue(items,key){const x=(items||[]).find(r=>r.config_key===key);return x?x.config_value:'-';}
function paintRuntimeSummary(items){
  const el=document.getElementById('runtimeVersionSummary');if(!el)return;
  el.innerHTML=`<tr><th>gm_v1</th><td>${cfgEsc(cfgRowValue(items,'gm_v1'))}</td></tr><tr><th>gm_v2</th><td>${cfgEsc(cfgRowValue(items,'gm_v2'))}</td></tr><tr><th>DEVICE_LANG</th><td>${cfgEsc(cfgRowValue(items,'device_lang_enabled'))}</td></tr><tr><th>생성모드</th><td>${cfgEsc(cfgRowValue(items,'device_lang_background_mode'))}</td></tr>`;
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
