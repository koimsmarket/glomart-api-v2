let recordMeta=null, recordItems=[], selectedRecord=null, selectedKey=null;
function esc(v){ return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function displayValue(v){ if(v===null)return 'NULL'; if(typeof v==='object')return JSON.stringify(v); return String(v); }
async function initRecordEditor(){ await fillSelect('tableSelect'); await loadRecordMeta(); }
async function loadRecordMeta(){
  const table=document.getElementById('tableSelect').value; if(!table)return;
  const r=await fetch(`${API}/api/gm/builder/record/meta?table=${encodeURIComponent(table)}&t=${Date.now()}`); const j=await r.json();
  if(!r.ok||!j.ok){ log(j); return; } recordMeta=j; closeEditor();
  document.getElementById('fieldSelect').innerHTML='<option value="">전체</option>'+j.columns.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
}
async function searchRecords(){
  const table=document.getElementById('tableSelect').value, field=document.getElementById('fieldSelect').value, value=document.getElementById('valueInput').value, mode=document.getElementById('modeSelect').value, limit=document.getElementById('limitInput').value||50;
  if(field && !value){ log('조회 컬럼을 선택한 경우 조회값이 필요합니다.'); return; }
  const q=new URLSearchParams({table,limit,mode}); if(field){q.set('field',field);q.set('value',value);}
  const r=await fetch(`${API}/api/gm/builder/record/search?${q.toString()}`); const j=await r.json(); if(!r.ok||!j.ok){log(j);return;}
  recordItems=j.items||[]; document.getElementById('resultInfo').textContent=`${j.table} · ${j.count}건`;
  renderResults(); closeEditor();
}
function renderResults(){
  const t=document.getElementById('resultTable'); if(!recordItems.length){t.innerHTML='<tbody><tr><td>조회 결과 없음</td></tr></tbody>';return;}
  const cols=recordMeta.columns; t.innerHTML=`<thead><tr><th>선택</th>${cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>`+recordItems.map((row,i)=>`<tr><td><button onclick="editRecord(${i})">수정</button></td>${cols.map(c=>`<td title="${esc(displayValue(row[c]))}">${esc(displayValue(row[c]))}</td>`).join('')}</tr>`).join('')+'</tbody>';
}
function chooseKey(row){ for(const ks of recordMeta.key_sets||[]){ if(ks.every(k=>row[k]!==null&&row[k]!==undefined&&String(row[k])!=='')){ const o={};ks.forEach(k=>o[k]=row[k]);return o; } } return null; }
function editRecord(i){
  selectedRecord=recordItems[i]; selectedKey=chooseKey(selectedRecord); if(!selectedKey){log('이 레코드는 유효한 기준키가 없어 수정할 수 없습니다.');return;}
  const editable=new Set(recordMeta.editable||[]); document.getElementById('keyInfo').textContent='기준키: '+JSON.stringify(selectedKey);
  document.getElementById('editorFields').innerHTML=recordMeta.columns.map(c=>{ const locked=!editable.has(c), v=selectedRecord[c]; return `<label>${esc(c)}${locked?' · 보호':''}</label><textarea data-col="${esc(c)}" ${locked?'disabled':''} data-null="${v===null?'1':'0'}">${esc(v===null?'':displayValue(v))}</textarea>${!locked?'<label class="null-check"><input type="checkbox" data-null-col="'+esc(c)+'" '+(v===null?'checked':'')+'> NULL로 저장</label>':''}`; }).join('');
  document.getElementById('editorCard').style.display='block'; document.getElementById('editorCard').scrollIntoView({behavior:'smooth',block:'start'});
}
function closeEditor(){ selectedRecord=null;selectedKey=null;const c=document.getElementById('editorCard');if(c)c.style.display='none'; }
function parsedValue(original,text){
  if(typeof original==='number'){ const n=Number(text.replace(/,/g,'')); return Number.isFinite(n)?n:text; }
  if(typeof original==='boolean') return String(text).toLowerCase()==='true';
  if(original && typeof original==='object'){ try{return JSON.parse(text);}catch(_){return text;} }
  return text;
}
async function applyRecordUpdate(){
  if(!selectedRecord||!selectedKey)return;
  const changes={}; for(const c of recordMeta.editable||[]){ const ta=document.querySelector(`textarea[data-col="${CSS.escape(c)}"]`); if(!ta)continue; const nc=document.querySelector(`input[data-null-col="${CSS.escape(c)}"]`); const nv=nc&&nc.checked?null:parsedValue(selectedRecord[c],ta.value); if(JSON.stringify(nv)!==JSON.stringify(selectedRecord[c]))changes[c]=nv; }
  const names=Object.keys(changes); if(!names.length){log('변경된 컬럼이 없습니다.');return;}
  if(!confirm(`다음 ${names.length}개 컬럼을 수정합니다.\n${names.join(', ')}\n\n진행하시겠습니까?`))return;
  const table=document.getElementById('tableSelect').value;
  const r=await fetch(`${API}/api/gm/builder/record/update`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table,key:selectedKey,changes})}); const j=await r.json(); log(j); if(!r.ok||!j.ok)return; await searchRecords();
}
window.addEventListener('DOMContentLoaded',initRecordEditor);
