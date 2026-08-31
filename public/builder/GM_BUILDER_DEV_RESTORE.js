async function uploadDev(tableKey,file,apply){
  const text=await readCsvText(file);
  const url=`${API}/api/gm/builder/safe-update?table=${encodeURIComponent(tableKey)}&apply=${apply?'YES':'NO'}&file_mode=EXACT`;
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'text/csv; charset=utf-8'},body:text});
  if(!r.ok){const t=await r.text();throw new Error(`HTTP ${r.status}: ${t.slice(0,500)}`);} await downloadCsvResponse(r,(apply?'dev_file_restore':'dev_dryrun')+'_'+tableKey+'_'+Date.now()+'.csv');
}
async function devOverwrite(apply,button){
  const f=document.getElementById('devFile').files[0]; if(!f){alert('Excel 또는 CSV 파일을 선택하세요.');return;}
  if(apply && prompt('실행하려면 DEV FILE RESTORE 를 입력하세요.')!=='DEV FILE RESTORE') return;
  const table=document.getElementById('devTable').value; const timed=startButtonTimer(button,apply?'강제 업로드 중':'개발 검증 중');
  try{await uploadDev(table,f,apply);log({table,file:f.name,mode:apply?'RESTORE':'DRY_RUN',result:'DONE'});}catch(e){log(String(e&&e.message||e));}finally{stopButtonTimer(timed);}
}
async function devOverwriteAll(apply,button){
  const files=[...document.getElementById('devMultiFiles').files]; if(!files.length){alert('파일들을 선택하세요.');return;}
  if(apply && prompt('실행하려면 DEV FILE RESTORE ALL 을 입력하세요.')!=='DEV FILE RESTORE ALL') return;
  const timed=startButtonTimer(button,apply?'여러 파일 업로드 중':'여러 파일 검증 중'); const result=[];
  try{for(const f of files){const key=inferTableFromFileName(f.name);if(!key){result.push({file:f.name,result:'SKIP'});continue;}await uploadDev(key,f,apply);result.push({file:f.name,table:key,result:'DONE'});}log(result);}catch(e){log(String(e&&e.message||e));}finally{stopButtonTimer(timed);}
}
fillSelect('devTable');
