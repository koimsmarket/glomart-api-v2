let recordMeta=null, recordItems=[], selectedRecord=null, selectedKey=null;
function esc(v){ return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function displayValue(v){ if(v===null)return 'NULL'; if(typeof v==='object')return JSON.stringify(v); return String(v); }
function metaOf(c){ return recordMeta && recordMeta.column_meta ? (recordMeta.column_meta[c]||{}) : {}; }
function isArrayMeta(m){ return m && (m.data_type==='ARRAY' || String(m.udt_name||'').startsWith('_')); }
function scalarUdt(m){ const u=String(m&&m.udt_name||'').toLowerCase(); return u.startsWith('_')?u.slice(1):u; }
function typeLabel(m){ const a=isArrayMeta(m); const u=scalarUdt(m)||String(m&&m.data_type||'').toLowerCase()||'unknown'; return a?`${u}[]`:u; }
function isBooleanMeta(m){ return scalarUdt(m)==='bool' && !isArrayMeta(m); }
function isJsonMeta(m){ return ['json','jsonb'].includes(scalarUdt(m)) && !isArrayMeta(m); }
async function initRecordEditor(){ await fillSelect('tableSelect'); await loadRecordMeta(); }
async function loadRecordMeta(){
  const table=document.getElementById('tableSelect').value; if(!table)return;
  const r=await fetch(`${API}/api/gm/builder/record/meta?table=${encodeURIComponent(table)}&t=${Date.now()}`); const j=await r.json();
  if(!r.ok||!j.ok){ log(j); return; } recordMeta=j; closeEditor();
  document.getElementById('fieldSelect').innerHTML='<option value="">전체</option>'+j.columns.map(c=>`<option value="${esc(c)}">${esc(c)} · ${esc(typeLabel(metaOf(c)))}</option>`).join('');
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
function fieldControl(c,v,locked){
  const m=metaOf(c), nullable=m.is_nullable==='YES', type=typeLabel(m), id='fld_'+c;
  let control='';
  if(isBooleanMeta(m)){
    const vv=v===true?'true':v===false?'false':'';
    control=`<select id="${esc(id)}" data-col="${esc(c)}" ${locked?'disabled':''}><option value="true" ${vv==='true'?'selected':''}>true</option><option value="false" ${vv==='false'?'selected':''}>false</option></select>`;
  }else{
    const shown=v===null?'':(typeof v==='object'?JSON.stringify(v):String(v));
    control=`<textarea id="${esc(id)}" data-col="${esc(c)}" ${locked?'disabled':''}>${esc(shown)}</textarea>`;
  }
  const nullCtl=!locked && nullable?`<label class="null-check"><input type="checkbox" data-null-col="${esc(c)}" ${v===null?'checked':''}> NULL로 저장</label>`:'';
  const hint=isArrayMeta(m)?' · 배열은 JSON 배열 형식':isJsonMeta(m)?' · JSON 형식':'';
  return `<label>${esc(c)} · ${esc(type)}${locked?' · 보호':''}${esc(hint)}</label>${control}${nullCtl}`;
}
function editRecord(i){
  selectedRecord=recordItems[i]; selectedKey=chooseKey(selectedRecord); if(!selectedKey){log('이 레코드는 유효한 기준키가 없어 수정할 수 없습니다.');return;}
  const editable=new Set(recordMeta.editable||[]); document.getElementById('keyInfo').textContent='기준키: '+JSON.stringify(selectedKey);
  document.getElementById('editorFields').innerHTML=recordMeta.columns.map(c=>fieldControl(c,selectedRecord[c],!editable.has(c))).join('');
  document.getElementById('editorCard').style.display='block'; document.getElementById('editorCard').scrollIntoView({behavior:'smooth',block:'start'});
}
function closeEditor(){ selectedRecord=null;selectedKey=null;const c=document.getElementById('editorCard');if(c)c.style.display='none'; }
function parseTypedInput(c,text){
  const m=metaOf(c), u=scalarUdt(m);
  if(isArrayMeta(m)){
    let a; try{a=JSON.parse(text);}catch(_){throw new Error(`${c}: 배열은 JSON 배열 형식이어야 합니다.`);} if(!Array.isArray(a))throw new Error(`${c}: 배열은 [..] 형식이어야 합니다.`); return a;
  }
  if(['json','jsonb'].includes(u)){
    try{return JSON.parse(text);}catch(_){throw new Error(`${c}: 올바른 JSON이 아닙니다.`);}
  }
  if(u==='bool'){
    const s=String(text).toLowerCase(); if(s==='true')return true;if(s==='false')return false;throw new Error(`${c}: true 또는 false만 가능합니다.`);
  }
  // pg가 number로 반환하는 기본 숫자형은 number로 비교해 불필요한 UPDATE를 막는다.
  if(['int2','int4','float4','float8'].includes(u)){
    const n=Number(String(text).replace(/,/g,'')); if(!Number.isFinite(n))throw new Error(`${c}: 올바른 숫자가 아닙니다.`); return n;
  }
  // int8/numeric은 JS 정밀도 손실을 피하려 문자열 그대로 서버에 보내 DB 타입 기준으로 검증한다.
  return text;
}
function currentControlValue(c){
  const el=document.querySelector(`[data-col="${CSS.escape(c)}"]`); return el?el.value:'';
}
async function applyRecordUpdate(){
  if(!selectedRecord||!selectedKey)return;
  const changes={}, original={};
  try{
    for(const c of recordMeta.editable||[]){
      const el=document.querySelector(`[data-col="${CSS.escape(c)}"]`); if(!el)continue;
      const nc=document.querySelector(`input[data-null-col="${CSS.escape(c)}"]`);
      const nv=nc&&nc.checked?null:parseTypedInput(c,currentControlValue(c));
      if(JSON.stringify(nv)!==JSON.stringify(selectedRecord[c])){ changes[c]=nv; original[c]=selectedRecord[c]; }
    }
  }catch(e){ log(e.message||String(e)); return; }
  const names=Object.keys(changes); if(!names.length){log('변경된 컬럼이 없습니다.');return;}
  if(!confirm(`다음 ${names.length}개 컬럼을 수정합니다.\n${names.join(', ')}\n\n진행하시겠습니까?`))return;
  const table=document.getElementById('tableSelect').value;
  const r=await fetch(`${API}/api/gm/builder/record/update`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table,key:selectedKey,changes,original})}); const j=await r.json(); log(j); if(!r.ok||!j.ok)return; await searchRecords();
}
window.addEventListener('DOMContentLoaded',initRecordEditor);
