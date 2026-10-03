// GM_BUILDER_ASSET_PACK_UI_V005_SHOW_SERVER_DETAIL
function apEsc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function loadAssetPack(){
  const box=document.getElementById('assetPackStatus');if(!box)return;
  try{
    const r=await fetch(`${API}/api/gm/builder/asset-pack?t=${Date.now()}`,{cache:'no-store'}),j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||`HTTP ${r.status}`);
    const c=j.config||{},g=j.generator||{},m=j.category_meta||{},v=j.version||{},f=j.category_files||{},pending=j.pending||[];
    document.getElementById('assetPackMode').value=c.asset_pack_background_mode||'AUTO';
    document.getElementById('assetPackStart').value=c.asset_pack_auto_start||'00:00';
    document.getElementById('assetPackEnd').value=c.asset_pack_auto_end||'08:00';
    const bf=f.base_files||{},df=f.delta_files||{},hf=f.hnsw||{};
    const deltaFiles=(v.base_started_at&&v.last_updated_at&&v.base_started_at!==v.last_updated_at)?`${Number(df.ready||0)}/${Number(df.total||25)}`:'-';
    document.getElementById('assetPackVersions').innerHTML=`
      <tr><th>원본 시작일시</th><td><b>${apEsc(v.base_started_at||m.base_started_at||'-')}</b></td></tr>
      <tr><th>추가본 최종일시</th><td><b>${apEsc(v.last_updated_at||m.last_updated_at||'-')}</b></td></tr>
      <tr><th>원본 JSON</th><td>${apEsc(Number(bf.ready||0))}/${apEsc(Number(bf.total||25))}개 언어</td></tr>
      <tr><th>추가본 JSON</th><td>${apEsc(deltaFiles)}${deltaFiles==='-'?'':'개 언어'}</td></tr>
      <tr><th>HNSW JSON</th><td>${hf.ok?'준비':'미생성'} · 버전 ${apEsc(hf.version||'-')} · ${apEsc(Number(hf.count||0))}건 · ${apEsc(Number(hf.bytes||0))} bytes</td></tr>
      <tr><th>원본 카테고리</th><td>${apEsc(v.base_category_count||0)}건</td></tr>
      <tr><th>최근 누적 변경</th><td>${apEsc(v.last_delta_count||0)}건</td></tr>`;
    const ps=document.getElementById('assetPackPendingSummary'),pr=document.getElementById('assetPackPendingRows');
    if(ps)ps.textContent=`추가본 대기 ${Number(j.pending_count||0)}건`;
    if(pr)pr.innerHTML=pending.length?pending.map(x=>`<tr><td>${apEsc(x.status)}</td><td>${apEsc(x.change_kind)}</td><td>${apEsc(x.gm_code)}</td><td>${apEsc(x.cp_code)}</td><td>${apEsc(x.name_ko)}</td><td>${apEsc(x.parent_gm_code||x.parent_cp_code)}</td><td>${apEsc(x.last_seen_at||'')}</td></tr>`).join(''):'<tr><td colspan="7">대기 카테고리 없음</td></tr>';
    box.textContent=`카테고리 JSON ${Number(bf.ready||0)===25?'원본 준비':'원본 미생성'} · HNSW ${hf.ok?'준비':'미생성'} · 상태 ${g.state||'-'}${g.last_error?' · 오류 '+g.last_error:''}`;
  }catch(e){box.textContent='조회 실패: '+String(e&&e.message||e);}
}
async function saveAssetPackSchedule(){
  const body={mode:document.getElementById('assetPackMode').value,start:document.getElementById('assetPackStart').value,end:document.getElementById('assetPackEnd').value};
  const r=await fetch(`${API}/api/gm/builder/asset-pack/schedule`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),j=await r.json();if(!r.ok||!j.ok){alert(j.error||`HTTP ${r.status}`);return;}await loadAssetPack();
}
async function nextAssetPackVersion(kind){
  const label={base:'카테고리 기준본',delta:'카테고리 누적본',ui:'UI 사전'}[kind]||kind;if(!confirm(`${label} 요청 버전을 +1 할까요?\nAUTO 모드에서는 야간 작업시간에 생성됩니다.`))return;
  const r=await fetch(`${API}/api/gm/builder/asset-pack/version/${kind}/next`,{method:'POST'}),j=await r.json();if(!r.ok||!j.ok){alert(j.error||`HTTP ${r.status}`);return;}await loadAssetPack();
}
async function generateCategoryBaseNow(){
  if(!confirm('현재 gm_category 전체로 원본(BASE) 25개국 JSON을 새로 생성할까요?\n성공한 시각이 새 원본 버전(YYYYMMDD_HHMM)이 되며 기존 클라이언트는 BASE를 다시 받습니다.'))return;
  const b=document.getElementById('assetPackBaseGenerateBtn');if(b)b.disabled=true;
  try{
    const r=await fetch(`${API}/api/gm/builder/asset-pack/category/base/generate`,{method:'POST'}),j=await r.json();if(!r.ok||!j.ok)throw new Error(j.detail||j.error||`HTTP ${r.status}`);
    log({action:'category-pack.base.generate',result:j.result});
    alert(`원본 25개국 JSON + HNSW 생성 완료\n버전: ${j.result.base_started_at}\n카테고리: ${j.result.count}건\n파일: ${j.result.files_ready}/25\nHNSW: ${j.result.hnsw_count||0}건`);
    await loadAssetPack();
  }catch(e){alert(String(e&&e.message||e));}finally{if(b)b.disabled=false;}
}
async function generateCategoryDeltaNow(){
  if(!confirm('현재 원본(BASE) 이후의 추가/변경분으로 추가본(DELTA) 25개국 JSON을 생성할까요?\n변경이 없으면 버전 시간은 바뀌지 않습니다.'))return;
  const b=document.getElementById('assetPackDeltaGenerateBtn');if(b)b.disabled=true;
  try{
    const r=await fetch(`${API}/api/gm/builder/asset-pack/category/delta/generate`,{method:'POST'}),j=await r.json();if(!r.ok||!j.ok)throw new Error(j.detail||j.error||`HTTP ${r.status}`);
    log({action:'category-pack.delta.generate',result:j.result});
    if(j.result&&j.result.state==='NO_CHANGES')alert(j.result.hnsw_rebuilt?`카테고리 변경은 없습니다.\n현재 버전(${j.result.last_updated_at})의 HNSW만 새로 생성했습니다.\nHNSW: ${j.result.hnsw_count||0}건`:'원본 이후 추가/변경 카테고리가 없습니다.\n최종 업데이트 시간은 변경하지 않았습니다.');
    else alert(`추가본 25개국 JSON + 전체 HNSW 생성 완료\n버전: ${j.result.last_updated_at}\n누적 변경: ${j.result.count}건\n파일: ${j.result.files_ready}/25\nHNSW: ${j.result.hnsw_count||0}건`);
    await loadAssetPack();
  }catch(e){alert(String(e&&e.message||e));}finally{if(b)b.disabled=false;}
}
// 기존 함수명 호환
async function publishNewBaseNow(){return generateCategoryBaseNow();}
async function publishAssetPackNow(){
  if(!confirm('기존 AUTO 대기 배포를 지금 실행할까요?'))return;
  const r=await fetch(`${API}/api/gm/builder/asset-pack/publish-now`,{method:'POST'}),j=await r.json();if(!r.ok||!j.ok){alert(j.error||j.detail||`HTTP ${r.status}`);return;}await loadAssetPack();
}
window.addEventListener('DOMContentLoaded',loadAssetPack);
