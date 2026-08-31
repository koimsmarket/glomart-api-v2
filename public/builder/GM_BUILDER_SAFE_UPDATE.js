async function uploadSafe(tableKey,file,apply,leafOnly=false){
  const text=await readCsvText(file);
  if((tableKey==='member' || tableKey==='gm_member' || !tableKey) && isCafe24MemberCsvText(text)){
    await uploadCafe24MemberText(text,file.name,apply);
    return null;
  }
  const url=`${API}/api/gm/builder/safe-update?table=${encodeURIComponent(tableKey)}&apply=${apply?'YES':'NO'}${leafOnly?'&leaf_only=YES':''}`;
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'text/csv; charset=utf-8'},body:text});
  if(!r.ok){ const t=await r.text(); throw new Error(`HTTP ${r.status}: ${t.slice(0,500)}`); }
  const csv=await r.text();
  const counts={UPDATED:0,INSERTED:0,FAIL:0,SKIP:0,VALID:0,OTHER:0};
  const parsed=(window.XLSX?XLSX.utils.sheet_to_json(XLSX.read(csv,{type:'string',raw:true}).Sheets.Sheet1,{defval:''}):[]);
  for(const row of parsed){ const k=String(row.result||''); if(Object.prototype.hasOwnProperty.call(counts,k)) counts[k]++; else counts.OTHER++; }
  const summary={table:tableKey,mode:leafOnly?'LEAF_ONLY_APPLY':(apply?'APPLY':'DRY_RUN'),server_version:r.headers.get('X-GM-Builder-Version')||'',processed:r.headers.get('X-GM-Category-Processed')||'',applied:r.headers.get('X-GM-Category-Applied')||'',result_counts:counts};
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=(leafOnly?'leaf_apply':(apply?'apply':'dryrun'))+'_result_'+tableKey+'_'+Date.now()+'.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  return summary;
}
async function send(apply,button){
  const f=document.getElementById('file').files[0]; if(!f){alert('Excel 또는 CSV 파일을 선택하세요.');return;}
  if(apply && prompt('실제 업데이트 하려면 APPLY 라고 입력하세요.')!=='APPLY') return;
  const table=document.getElementById('upTable').value; const timed=startButtonTimer(button,apply?'업데이트 중':'검증 중');
  try{ await uploadSafe(table,f,apply); log({table,file:f.name,mode:apply?'APPLY':'DRY_RUN',result:'DONE'}); }catch(e){log(String(e&&e.message||e));}finally{stopButtonTimer(timed);}
}
async function sendAll(apply,button){
  const files=[...document.getElementById('multiFiles').files]; if(!files.length){alert('파일들을 선택하세요.');return;}
  if(apply && prompt('전체 실제 업데이트 하려면 APPLY ALL 이라고 입력하세요.')!=='APPLY ALL') return;
  const timed=startButtonTimer(button,apply?'전체 업데이트 중':'전체 검증 중'); const result=[];
  try{ for(const f of files){ const text=await readCsvText(f); if(isCafe24MemberCsvText(text)){ await uploadCafe24MemberText(text,f.name,apply); result.push({file:f.name,table:'cafe24_member',result:'DONE'}); continue; } const key=inferTableFromFileName(f.name); if(!key){result.push({file:f.name,result:'SKIP',reason:'테이블명 추정 실패'});continue;} await uploadSafe(key,f,apply); result.push({file:f.name,table:key,result:'DONE'}); } log(result); }catch(e){log(String(e&&e.message||e));}finally{stopButtonTimer(timed);}
}
function dryRun(button){return send(false,button)} function applyUpdate(button){return send(true,button)} function dryRunAll(button){return sendAll(false,button)} function applyAll(button){return sendAll(true,button)}
fillSelect('upTable');

async function applyLeafOnly(button){
  const f=document.getElementById('file').files[0]; if(!f){alert('Excel 또는 CSV 파일을 선택하세요.');return;}
  const table=document.getElementById('upTable').value;
  if(table!=='category'){ log('카테고리(gm_category)를 선택해야 합니다.'); return; }
  if(prompt('leaf_yn만 실제 반영하려면 LEAF APPLY 라고 입력하세요.')!=='LEAF APPLY') return;
  const timed=startButtonTimer(button,'leaf_yn 업데이트 중');
  try{
    const summary=await uploadSafe(table,f,true,true);
    log({file:f.name,...summary});
  }catch(e){log(String(e&&e.message||e));}finally{stopButtonTimer(timed);}
}
