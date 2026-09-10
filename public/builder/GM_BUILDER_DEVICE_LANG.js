// GM_BUILDER_DEVICE_LANG_UI_V001
// Device-language pack and country-stat UI only.
// This module is self-contained and does not depend on runtime-config UI functions.

function dlEsc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function pair(a,b){return `${fmt(a)} / ${fmt(b)}`;}
function dlAction(x){
  const lang=dlEsc(x.lang_code),st=String(x.status||'');
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
    const g=j.generator||{};if(gs)gs.innerHTML=`생성기: <b>${dlEsc(g.mode||'-')}</b> / ${dlEsc(g.state||'-')} / 메모리 ${dlEsc(g.memory_percent==null?'-':g.memory_percent+'%')} / UI 원본 ${fmt(j.source_count)}건`;
    tb.innerHTML=(j.items||[]).map(x=>`<tr><td><b>${dlEsc(String(x.lang_code||'').toUpperCase())}</b></td><td>${dlEsc(x.status)}</td><td>v${fmt(x.pack_version)} / ${fmt(x.pack_count)}</td><td>${pair(x.visit_day_count,x.visit_yesterday_count)}</td><td>${pair(x.visit_month_count,x.visit_last_month_count)}</td><td>${pair(x.visit_year_count,x.visit_last_year_count)}</td><td>${fmt(x.visit_total_count)}</td><td>${fmt(x.download_count)}</td><td>${dlAction(x)}</td></tr>`).join('')||'<tr><td colspan="9">데이터 없음</td></tr>';
  }catch(e){tb.innerHTML=`<tr><td colspan="9">언어 조회 실패: ${dlEsc(e&&e.message||e)}</td></tr>`;}
}
async function generateDeviceLang(lang){if(!confirm(`${lang.toUpperCase()} UI 사전을 지금 생성할까요? AUTO 모드에서는 야간에 자동 생성됩니다.`))return;const r=await fetch(`${API}/api/gm/builder/device-lang/${encodeURIComponent(lang)}/generate`,{method:'POST'});const j=await r.json();if(!r.ok||!j.ok){alert(j.error||j.detail||`HTTP ${r.status}`);return;}log({action:'device-lang.generated',lang,...j.result});await loadDeviceLanguages();}
function exportDeviceLang(lang){window.location.href=`${API}/api/gm/builder/device-lang/${encodeURIComponent(lang)}/export?t=${Date.now()}`;}
async function importDeviceLang(lang){const el=document.getElementById(`dlFile_${lang}`),file=el&&el.files&&el.files[0];if(!file){alert('교정 CSV를 선택하세요.');return;}const fd=new FormData();fd.append('file',file,file.name);const r=await fetch(`${API}/api/gm/builder/device-lang/${encodeURIComponent(lang)}/import`,{method:'POST',body:fd});const j=await r.json();if(!r.ok||!j.ok){alert((j.error||`HTTP ${r.status}`)+(j.issue_count?` / 오류 ${j.issue_count}건`:''));return;}log({action:'device-lang.imported',lang,pack_count:j.pack_count});await loadDeviceLanguages();}
async function approveDeviceLang(lang){if(!confirm(`${lang.toUpperCase()} 언어팩을 APPROVED로 배포할까요? 다음 방문부터 DEVICE 사용자가 다운로드합니다.`))return;const r=await fetch(`${API}/api/gm/builder/device-lang/${encodeURIComponent(lang)}/approve`,{method:'POST'});const j=await r.json();if(!r.ok||!j.ok){alert(j.error||`HTTP ${r.status}`);return;}log({action:'device-lang.approved',lang,version:j.item&&j.item.pack_version});await loadDeviceLanguages();}
async function loadCountryStats(){
  const tb=document.getElementById('countryStatRows');if(!tb)return;
  try{const r=await fetch(`${API}/api/gm/builder/country-stat?t=${Date.now()}`,{cache:'no-store'});const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||`HTTP ${r.status}`);tb.innerHTML=(j.items||[]).map(x=>`<tr><td><b>${dlEsc(x.country_code)}</b></td><td>${fmt(x.member_count)}</td><td>${pair(x.visit_day_count,x.visit_yesterday_count)}</td><td>${pair(x.visit_month_count,x.visit_last_month_count)}</td><td>${pair(x.visit_year_count,x.visit_last_year_count)}</td><td>${fmt(x.visit_total_count)}</td></tr>`).join('')||'<tr><td colspan="6">데이터 없음</td></tr>';}catch(e){tb.innerHTML=`<tr><td colspan="6">국가 조회 실패: ${dlEsc(e&&e.message||e)}</td></tr>`;}
}
loadDeviceLanguages();
loadCountryStats();
setInterval(()=>{loadDeviceLanguages();loadCountryStats();},60000);
