async function uploadSafe(tableKey,file,apply){
  const text=await readCsvText(file);
  if((tableKey==='member' || tableKey==='gm_member' || !tableKey) && isCafe24MemberCsvText(text)){
    await uploadCafe24MemberText(text,file.name,apply);
    return;
  }
  const url=`${API}/api/gm/builder/safe-update?table=${encodeURIComponent(tableKey)}&apply=${apply?'YES':'NO'}`;
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'text/csv; charset=utf-8'},body:text});
  if(!r.ok){ const t=await r.text(); throw new Error(`HTTP ${r.status}: ${t.slice(0,500)}`); }
  await downloadCsvResponse(r,(apply?'apply':'dryrun')+'_result_'+tableKey+'_'+Date.now()+'.csv');
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
