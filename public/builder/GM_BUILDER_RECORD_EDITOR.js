let recordMeta=null, recordItems=[], selectedRecord=null, selectedKey=null, lastSearchPayload=null;
function esc(v){ return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function displayValue(v){ if(v===null)return 'NULL'; if(typeof v==='object')return JSON.stringify(v); return String(v); }
function metaOf(c){ return recordMeta && recordMeta.column_meta ? (recordMeta.column_meta[c]||{}) : {}; }
function isArrayMeta(m){ return m && (m.data_type==='ARRAY' || String(m.udt_name||'').startsWith('_')); }
function scalarUdt(m){ const u=String(m&&m.udt_name||'').toLowerCase(); return u.startsWith('_')?u.slice(1):u; }
function typeLabel(m){ const a=isArrayMeta(m); const u=scalarUdt(m)||String(m&&m.data_type||'').toLowerCase()||'unknown'; return a?`${u}[]`:u; }
function isBooleanMeta(m){ return scalarUdt(m)==='bool' && !isArrayMeta(m); }
function isJsonMeta(m){ return ['json','jsonb'].includes(scalarUdt(m)) && !isArrayMeta(m); }
function keySummary(){
  const info=recordMeta&&recordMeta.key_info||[];
  if(!info.length)return '기준키 없음';
  return info.map(x=>`${(x.columns||[]).join('+')} [${x.source||'KEY'}]`).join(' 또는 ');
}
async function initRecordEditor(){ await fillSelect('tableSelect'); await loadRecordMeta(); }
async function loadRecordMeta(){
  const table=document.getElementById('tableSelect').value; if(!table)return;
  const r=await fetch(`${API}/api/gm/builder/record/meta?table=${encodeURIComponent(table)}&t=${Date.now()}`); const j=await r.json();
  if(!r.ok||!j.ok){ log(j); return; } recordMeta=j; recordItems=[]; closeEditor();
  const opts=j.columns.map(c=>`<option value="${esc(c)}">${esc(c)} · ${esc(typeLabel(metaOf(c)))}</option>`).join('');
  document.getElementById('rangeField').innerHTML=opts;
  document.getElementById('sortField').innerHTML='<option value="">기본 정렬</option>'+opts;
  document.getElementById('filterRows').innerHTML='';
  addFilterRow();
  const preferred=j.columns.find(c=>c==='id'||/_id$/i.test(c))||(j.key_sets&&j.key_sets[0]&&j.key_sets[0][0])||j.columns[0]||'';
  if(preferred){ document.getElementById('rangeField').value=preferred; document.getElementById('sortField').value=preferred; }
  document.getElementById('resultInfo').textContent=`조회 전 · 기준키: ${keySummary()}`;
  document.getElementById('resultTable').innerHTML='<tbody><tr><td>조회 전</td></tr></tbody>';
}
const FILTER_OPS=[
  ['exact','정확히 일치'],['not_equal','같지 않음'],['contains','포함'],['starts_with','시작'],['ends_with','끝'],
  ['gt','보다 큼 >'],['gte','이상 ≥'],['lt','보다 작음 <'],['lte','이하 ≤'],['between','범위 BETWEEN'],['in','목록 IN (쉼표)'],
  ['is_null','NULL'],['not_null','NOT NULL']
];
function filterColumnOptions(){ return (recordMeta&&recordMeta.columns||[]).map(c=>`<option value="${esc(c)}">${esc(c)} · ${esc(typeLabel(metaOf(c)))}</option>`).join(''); }
function addFilterRow(preset={}){
  const wrap=document.getElementById('filterRows'); if(!wrap||!recordMeta)return;
  if(wrap.children.length>=8){log('검색 조건은 최대 8개까지 가능합니다.');return;}
  const row=document.createElement('div'); row.className='filter-row';
  row.style.cssText='display:grid;grid-template-columns:minmax(170px,1.2fr) minmax(150px,1fr) minmax(160px,1.3fr) minmax(160px,1.3fr) 72px;gap:8px;align-items:end;margin:8px 0';
  row.innerHTML=`<div><label>컬럼</label><select class="filter-field">${filterColumnOptions()}</select></div><div><label>조건</label><select class="filter-op">${FILTER_OPS.map(x=>`<option value="${x[0]}">${x[1]}</option>`).join('')}</select></div><div><label>값</label><input class="filter-value" placeholder="조회값"></div><div class="filter-value2-wrap" style="display:none"><label>끝값</label><input class="filter-value2" placeholder="범위 끝값"></div><div><button class="red" type="button" onclick="removeFilterRow(this)">삭제</button></div>`;
  wrap.appendChild(row);
  if(preset.field)row.querySelector('.filter-field').value=preset.field;
  if(preset.op)row.querySelector('.filter-op').value=preset.op;
  if(preset.value!==undefined)row.querySelector('.filter-value').value=preset.value;
  if(preset.value2!==undefined)row.querySelector('.filter-value2').value=preset.value2;
  const op=row.querySelector('.filter-op'); op.addEventListener('change',()=>syncFilterRow(row)); syncFilterRow(row);
}
function removeFilterRow(btn){ const row=btn.closest('.filter-row'); if(row)row.remove(); }
function syncFilterRow(row){
  const op=row.querySelector('.filter-op').value;
  const noValue=op==='is_null'||op==='not_null';
  row.querySelector('.filter-value').disabled=noValue;
  row.querySelector('.filter-value2-wrap').style.display=op==='between'?'block':'none';
}
function collectFilters(){
  return [...document.querySelectorAll('#filterRows .filter-row')].map(row=>{
    const op=row.querySelector('.filter-op').value, value=row.querySelector('.filter-value').value.trim(), value2=row.querySelector('.filter-value2').value.trim();
    const f={field:row.querySelector('.filter-field').value,op};
    if(op!=='is_null'&&op!=='not_null')f.value=value;
    if(op==='between')f.value2=value2;
    return f;
  }).filter(f=>f.op==='is_null'||f.op==='not_null'||String(f.value||'')!=='');
}
async function performAdvancedSearch(payload){
  lastSearchPayload=JSON.parse(JSON.stringify(payload));
  const r=await fetch(`${API}/api/gm/builder/record/search-advanced`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const j=await r.json(); if(!r.ok||!j.ok){log(j);return;}
  recordItems=j.items||[];
  if(j.key_sets)recordMeta.key_sets=j.key_sets; if(j.key_info)recordMeta.key_info=j.key_info; if(j.editable)recordMeta.editable=j.editable;
  const filterText=(j.applied_filters||[]).map(f=>`${f.field}:${f.op}${f.value!==undefined?'='+f.value:''}${f.value2!==undefined?'~'+f.value2:''}`).join(' / ');
  document.getElementById('resultInfo').textContent=`${j.table} · ${j.count}건 · ${filterText||'전체'} · 기준키: ${keySummary()}`;
  renderResults(); closeEditor();
}
async function searchAdvancedRecords(){
  const table=document.getElementById('tableSelect').value, limit=document.getElementById('limitInput').value||100;
  await performAdvancedSearch({table,limit,join:document.getElementById('joinSelect').value,filters:collectFilters(),sort_field:document.getElementById('sortField').value,sort_direction:document.getElementById('sortDirection').value});
}
async function searchAllRecords(){
  const table=document.getElementById('tableSelect').value, limit=document.getElementById('limitInput').value||100;
  await performAdvancedSearch({table,limit,filters:[],sort_field:document.getElementById('sortField').value,sort_direction:document.getElementById('sortDirection').value});
}
async function quickRangeSearch(direction){
  const table=document.getElementById('tableSelect').value, field=document.getElementById('rangeField').value, value=document.getElementById('rangeValue').value.trim(), limit=document.getElementById('limitInput').value||100;
  if(!field||!value){log('기준 컬럼과 시작값을 입력하세요.');return;}
  const after=direction==='after';
  document.getElementById('sortField').value=field; document.getElementById('sortDirection').value=after?'ASC':'DESC';
  await performAdvancedSearch({table,limit,join:'AND',filters:[{field,op:after?'gt':'lt',value}],sort_field:field,sort_direction:after?'ASC':'DESC'});
}
function clearSearchConditions(){
  document.getElementById('rangeValue').value=''; document.getElementById('filterRows').innerHTML=''; addFilterRow();
  document.getElementById('joinSelect').value='AND'; document.getElementById('sortDirection').value='ASC';
}
// 기존 외부 호출 호환용: 고급조회로 연결한다.
async function searchRecords(){ return lastSearchPayload?performAdvancedSearch(lastSearchPayload):searchAdvancedRecords(); }
function renderResults(){
  const t=document.getElementById('resultTable');
  if(!recordItems.length){t.innerHTML='<tbody><tr><td>조회 결과 없음</td></tr></tbody>';return;}
  const cols=recordMeta.columns;
  t.innerHTML=`<thead><tr><th>삭제선택</th><th>수정</th>${cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>`+
    recordItems.map((row,i)=>{
      const key=chooseKey(row); const disabled=key?'':'disabled';
      return `<tr><td><input type="checkbox" class="deleteCheck" data-idx="${i}" ${disabled}></td><td><button onclick="editRecord(${i})" ${disabled}>수정</button></td>${cols.map(c=>`<td title="${esc(displayValue(row[c]))}">${esc(displayValue(row[c]))}</td>`).join('')}</tr>`;
    }).join('')+'</tbody>';
}
function chooseKey(row){
  for(const ks of recordMeta.key_sets||[]){
    if(ks.every(k=>row[k]!==null&&row[k]!==undefined&&String(row[k])!=='')){
      const o={}; ks.forEach(k=>o[k]=row[k]); return o;
    }
  }
  return null;
}
function toggleDeleteChecks(on){ document.querySelectorAll('.deleteCheck:not(:disabled)').forEach(x=>x.checked=!!on); }
async function deleteSelectedRecords(){
  const selected=[...document.querySelectorAll('.deleteCheck:checked')]
    .map(ch=>recordItems[Number(ch.dataset.idx)])
    .filter(Boolean)
    .map(row=>({row,key:chooseKey(row)}))
    .filter(x=>x.key);
  if(!selected.length){ log('삭제할 레코드를 체크하세요.'); return; }
  const answer=prompt(`${selected.length}개 레코드를 삭제합니다.\n실행하려면 DELETE SELECTED 를 입력하세요.`);
  if(answer!=='DELETE SELECTED')return;
  const table=document.getElementById('tableSelect').value;
  const r=await fetch(`${API}/api/gm/builder/record/delete-selected`,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({table,confirm:'DELETE SELECTED',items:selected.map(x=>({key:x.key}))})
  });
  const txt=await r.text(); let j; try{j=JSON.parse(txt);}catch(_){j={ok:false,error:'NON_JSON_RESPONSE',status:r.status,text:txt.slice(0,500)};}
  log(j);
  if(!r.ok||!j.ok)return;
  alert(`삭제 완료: ${j.deleted||0}건`);
  await searchRecords();
}
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
  selectedRecord=recordItems[i]; selectedKey=chooseKey(selectedRecord);
  if(!selectedKey){log('이 레코드는 실제 PK/UNIQUE 또는 유효한 Builder 기준키가 없어 수정할 수 없습니다.');return;}
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
  if(['int2','int4','float4','float8'].includes(u)){
    const n=Number(String(text).replace(/,/g,'')); if(!Number.isFinite(n))throw new Error(`${c}: 올바른 숫자가 아닙니다.`); return n;
  }
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
