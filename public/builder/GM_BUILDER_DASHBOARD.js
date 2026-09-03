function fmt(n){ if(n===null||n===undefined) return '-'; return Number(n).toLocaleString(); }
function diffHtml(v){ if(v===null||v===undefined||v==='') return ''; const n=Number(v)||0; if(n>0) return `<span class="plus">+${fmt(n)}</span>`; if(n<0) return `<span class="minus">${fmt(n)}</span>`; return '0'; }
function badge(level){ level=String(level||'normal'); const txt={normal:'정상',prepare:'증설 준비',warning:'증설 진행',danger:'긴급 조치',unknown:'확인불가'}[level]||level; return `<span class="badge ${level}">${txt}</span>`; }
async function loadDashboard(save){
  try{
    const r=await fetch(`${API}/api/gm/dashboard/realtime?save=${save?'1':'0'}&t=${Date.now()}`);
    const j=await r.json();
    if(!j.ok){ log(j); return; }
    const cur=j.current||{}, counts=cur.counts||{}, diff=cur.diff_from_previous||{}, q=cur.queue||{}, db=cur.db_size||{};
    document.getElementById('statusTime').textContent = `현재 조회: ${cur.server_time||cur.snapshot_at||''}` + (j.previous&&j.previous.snapshot_at ? ` / 직전 스냅샷: ${j.previous.snapshot_at}` : '');
    const order=['gm_smartfit_space','gm_smartfit_space_vector','gm_smartfit_template','gm_smartfit_template_vector','gm_smartfit_item','gm_smartfit_collection','gm_smartfit_category','gm_product','gm_product_image_vector','gm_product_option','gm_product_archive','gm_category','gm_category_keyword','gm_search_keyword_stat','gm_category_search_stat','gm_category_search_monthly','gm_category_search_yearly','gm_product_sales_monthly','gm_product_sales_yearly','gm_product_country_sales_monthly','gm_product_country_sales_yearly','gm_category_sales_monthly','gm_category_sales_yearly','gm_category_country_sales_monthly','gm_category_country_sales_yearly','gm_basket','gm_order','gm_order_item','gm_supplier','gm_cs','gm_cs_message','gm_member','gm_member_address','gm_product_upsert_queue','gm_keyword_relation','gm_keyword_translate','gm_search_log','gm_dashboard_snapshot'];
    document.getElementById('tableStatus').innerHTML = order.map(t=>`<tr><td>${t}</td><td class="num">${fmt(counts[t])}</td><td class="num">${diffHtml(diff[t])}</td></tr>`).join('');
    document.getElementById('queueStatus').innerHTML = `
      <tr><th>pending</th><td class="num">${fmt(q.pending)}</td></tr>
      <tr><th>processing</th><td class="num">${fmt(q.processing)}</td></tr>
      <tr><th>done</th><td class="num">${fmt(q.done)}</td></tr>
      <tr><th>failed</th><td class="num">${fmt(q.failed)}</td></tr>
      <tr><th>total</th><td class="num">${fmt(q.total)}</td></tr>
      <tr><th>last processed</th><td>${q.last_processed_at||'-'}</td></tr>`;
    document.getElementById('dbStatus').innerHTML = `
      <p>DB 사용량: <b>${db.mb==null?'-':fmt(db.mb)+' MB'}</b></p>
      <p>기준 용량: <b>${db.limit_mb==null?'-':fmt(db.limit_mb)+' MB'}</b></p>
      <p>사용률: <b>${db.percent==null?'-':db.percent+'%'}</b> ${badge(db.level)}</p>
      <p>Queue 경고: ${badge((cur.warning||{}).queue)}</p>
      <p>API 응답: ${fmt(cur.api_response_ms)} ms</p>`;
    log({action:'dashboard.loaded', saved:j.saved, current:cur.warning||{}, counts, queue:q, db_size:db});
  }catch(e){ log('dashboard error: '+(e&&e.message||e)); }
}
async function saveSnapshot(){
  const r=await fetch(`${API}/api/gm/dashboard/snapshot`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({force:true})});
  const j=await r.json(); log(j); await loadDashboard(false);
}

loadDashboard(false); setInterval(()=>loadDashboard(false),60000);

// GM_IMAGE_VECTOR_BACKGROUND_DASHBOARD_V004
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

// GM_RUNTIME_CONFIG_DEVICE_LANG_DASHBOARD_V001
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
function pair(a,b){return `${fmt(a)} / ${fmt(b)}`;}
function dlAction(x){
  const lang=cfgEsc(x.lang_code),st=String(x.status||'');
  if(st==='BUILTIN')return '기존팩';
  let h='';
  if(st==='NEW'||st==='FAILED')h+=`<button onclick="generateDeviceLang('${lang}')">생성</button> `;
  if(st==='GENERATED'||st==='APPROVED')h+=`<button onclick="exportDeviceLang('${lang}')">CSV</button> `;
  if(st==='GENERATED'||st==='APPROVED')h+=`<input type="file" id="dlFile_${lang}" accept=".csv" style="max-width:140px"> <button onclick="importDeviceLang('${lang}')">업로드</button> `;
  if(st==='GENERATED')h+=`<button class="green" onclick="approveDeviceLang('${lang}')">승인</button>`;
  return h||'-';
}
async function loadDeviceLanguages(){
  const tb=document.getElementById('deviceLangRows'),gs=document.getElementById('deviceLangGenerator');if(!tb)return;
  try{
    const r=await fetch(`${API}/api/gm/builder/device-lang?t=${Date.now()}`,{cache:'no-store'});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||`HTTP ${r.status}`);
    const g=j.generator||{};if(gs)gs.innerHTML=`생성기: <b>${cfgEsc(g.mode||'-')}</b> / ${cfgEsc(g.state||'-')} / 메모리 ${cfgEsc(g.memory_percent==null?'-':g.memory_percent+'%')} / UI 원본 ${fmt(j.source_count)}건`;
    tb.innerHTML=(j.items||[]).map(x=>`<tr><td><b>${cfgEsc(String(x.lang_code||'').toUpperCase())}</b></td><td>${cfgEsc(x.status)}</td><td>v${fmt(x.pack_version)} / ${fmt(x.pack_count)}</td><td>${pair(x.visit_day_count,x.visit_yesterday_count)}</td><td>${pair(x.visit_month_count,x.visit_last_month_count)}</td><td>${pair(x.visit_year_count,x.visit_last_year_count)}</td><td>${fmt(x.visit_total_count)}</td><td>${fmt(x.download_count)}</td><td>${dlAction(x)}</td></tr>`).join('')||'<tr><td colspan="9">데이터 없음</td></tr>';
  }catch(e){tb.innerHTML=`<tr><td colspan="9">언어 조회 실패: ${cfgEsc(e&&e.message||e)}</td></tr>`;}
}
async function generateDeviceLang(lang){if(!confirm(`${lang.toUpperCase()} UI 사전을 지금 생성할까요? AUTO 모드에서는 야간에 자동 생성됩니다.`))return;const r=await fetch(`${API}/api/gm/builder/device-lang/${encodeURIComponent(lang)}/generate`,{method:'POST'});const j=await r.json();if(!r.ok||!j.ok){alert(j.error||j.detail||`HTTP ${r.status}`);return;}log({action:'device-lang.generated',lang,...j.result});await loadDeviceLanguages();}
function exportDeviceLang(lang){window.location.href=`${API}/api/gm/builder/device-lang/${encodeURIComponent(lang)}/export?t=${Date.now()}`;}
async function importDeviceLang(lang){const el=document.getElementById(`dlFile_${lang}`),file=el&&el.files&&el.files[0];if(!file){alert('교정 CSV를 선택하세요.');return;}const fd=new FormData();fd.append('file',file,file.name);const r=await fetch(`${API}/api/gm/builder/device-lang/${encodeURIComponent(lang)}/import`,{method:'POST',body:fd});const j=await r.json();if(!r.ok||!j.ok){alert((j.error||`HTTP ${r.status}`)+(j.issue_count?` / 오류 ${j.issue_count}건`:''));return;}log({action:'device-lang.imported',lang,pack_count:j.pack_count});await loadDeviceLanguages();}
async function approveDeviceLang(lang){if(!confirm(`${lang.toUpperCase()} 언어팩을 APPROVED로 배포할까요? 다음 방문부터 DEVICE 사용자가 다운로드합니다.`))return;const r=await fetch(`${API}/api/gm/builder/device-lang/${encodeURIComponent(lang)}/approve`,{method:'POST'});const j=await r.json();if(!r.ok||!j.ok){alert(j.error||`HTTP ${r.status}`);return;}log({action:'device-lang.approved',lang,version:j.item&&j.item.pack_version});await loadDeviceLanguages();}
async function loadCountryStats(){
  const tb=document.getElementById('countryStatRows');if(!tb)return;
  try{const r=await fetch(`${API}/api/gm/builder/country-stat?t=${Date.now()}`,{cache:'no-store'});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||`HTTP ${r.status}`);tb.innerHTML=(j.items||[]).map(x=>`<tr><td><b>${cfgEsc(x.country_code)}</b></td><td>${fmt(x.member_count)}</td><td>${pair(x.visit_day_count,x.visit_yesterday_count)}</td><td>${pair(x.visit_month_count,x.visit_last_month_count)}</td><td>${pair(x.visit_year_count,x.visit_last_year_count)}</td><td>${fmt(x.visit_total_count)}</td></tr>`).join('')||'<tr><td colspan="6">데이터 없음</td></tr>';}catch(e){tb.innerHTML=`<tr><td colspan="6">국가 조회 실패: ${cfgEsc(e&&e.message||e)}</td></tr>`;}
}
loadRuntimeConfig();loadDeviceLanguages();loadCountryStats();
setInterval(()=>{loadDeviceLanguages();loadCountryStats();},60000);
