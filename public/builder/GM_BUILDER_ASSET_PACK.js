// GM_BUILDER_ASSET_PACK_UI_V002_NEW_BASE_NOW
function apEsc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function loadAssetPack(){const box=document.getElementById('assetPackStatus');if(!box)return;try{const r=await fetch(`${API}/api/gm/builder/asset-pack?t=${Date.now()}`,{cache:'no-store'}),j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||`HTTP ${r.status}`);const c=j.config||{},g=j.generator||{},m=j.category_meta||{};document.getElementById('assetPackMode').value=c.asset_pack_background_mode||'AUTO';document.getElementById('assetPackStart').value=c.asset_pack_auto_start||'00:00';document.getElementById('assetPackEnd').value=c.asset_pack_auto_end||'08:00';document.getElementById('assetPackVersions').innerHTML=`<tr><th>카테고리 기준본</th><td>요청 v${apEsc(c.category_pack_base_target||0)} / 배포 v${apEsc(c.category_pack_base_published||0)}</td></tr><tr><th>카테고리 누적본</th><td>요청 v${apEsc(c.category_pack_delta_target||0)} / 배포 v${apEsc(c.category_pack_delta_published||0)} / 파일 ${(m.delta_versions||[]).length}개</td></tr><tr><th>UI 사전</th><td>요청 v${apEsc(c.ui_dictionary_target||0)} / 배포 v${apEsc(c.ui_dictionary_published||0)}</td></tr>`;box.textContent=`상태 ${g.state||'-'} · 마지막 ${g.last_run_at||'-'}${g.last_error?' · 오류 '+g.last_error:''}`;}catch(e){box.textContent='조회 실패: '+String(e&&e.message||e);}}
async function saveAssetPackSchedule(){const body={mode:document.getElementById('assetPackMode').value,start:document.getElementById('assetPackStart').value,end:document.getElementById('assetPackEnd').value};const r=await fetch(`${API}/api/gm/builder/asset-pack/schedule`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),j=await r.json();if(!r.ok||!j.ok){alert(j.error||`HTTP ${r.status}`);return;}await loadAssetPack();}
async function nextAssetPackVersion(kind){const label={base:'카테고리 기준본',delta:'카테고리 누적본',ui:'UI 사전'}[kind]||kind;if(!confirm(`${label} 요청 버전을 +1 할까요?\nAUTO 모드에서는 야간 작업시간에 생성됩니다.`))return;const r=await fetch(`${API}/api/gm/builder/asset-pack/version/${kind}/next`,{method:'POST'}),j=await r.json();if(!r.ok||!j.ok){alert(j.error||`HTTP ${r.status}`);return;}await loadAssetPack();}
async function publishNewBaseNow(){
  if(!confirm('카테고리 신규 기준본을 지금 생성할까요?\n이미 대기 중인 기준본 요청이 있으면 그 버전을 즉시 생성하고, 없으면 기준본 버전을 +1 한 뒤 바로 생성합니다.'))return;
  const b=document.getElementById('assetPackNewBaseBtn');if(b)b.disabled=true;
  try{
    const r=await fetch(`${API}/api/gm/builder/asset-pack/base/new-now`,{method:'POST'}),j=await r.json();
    if(!r.ok||!j.ok)throw new Error(j.error||j.detail||`HTTP ${r.status}`);
    log({action:'asset-pack.base.new-now',result:j.result});
    await loadAssetPack();
  }catch(e){alert(String(e&&e.message||e));}
  finally{if(b)b.disabled=false;}
}
async function publishAssetPackNow(){if(!confirm('대기 중인 카테고리/UI 사전 배포물을 지금 생성할까요?'))return;const b=document.getElementById('assetPackPublishBtn');if(b)b.disabled=true;try{const r=await fetch(`${API}/api/gm/builder/asset-pack/publish-now`,{method:'POST'}),j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||j.detail||`HTTP ${r.status}`);log({action:'asset-pack.publish-now',result:j.result});await loadAssetPack();}catch(e){alert(String(e&&e.message||e));}finally{if(b)b.disabled=false;}}
window.addEventListener('DOMContentLoaded',loadAssetPack);
