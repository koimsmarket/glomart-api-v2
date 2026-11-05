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
  const counts={UPDATED:0,VALID_UPDATE:0,INSERTED:0,VALID_INSERT:0,FAIL:0,SKIP:0,SKIP_CELL:0,STOPPED:0,OTHER:0};
  const parsed=(window.XLSX?XLSX.utils.sheet_to_json(XLSX.read(csv,{type:'string',raw:true}).Sheets.Sheet1,{defval:''}):[]);
  for(const row of parsed){ const k=String(row.result||''); if(Object.prototype.hasOwnProperty.call(counts,k)) counts[k]++; else counts.OTHER++; }
  const ts=Date.now();
  const reportName=(leafOnly?'leaf_apply':(apply?'apply':'dryrun'))+'_result_'+tableKey+'_'+ts+'.csv';
  const summary={
    table:tableKey,
    mode:leafOnly?'LEAF_ONLY_APPLY':(apply?'APPLY':'DRY_RUN'),
    run_id:r.headers.get('X-GM-Safe-Update-Run-Id')||'',
    processed:Number(r.headers.get('X-GM-Safe-Update-Processed')||parsed.length||0),
    updated:Number(r.headers.get('X-GM-Safe-Update-Updated')||0),
    skipped:Number(r.headers.get('X-GM-Safe-Update-Skipped')||0),
    invalid:Number(r.headers.get('X-GM-Safe-Update-Invalid')||0),
    result_counts:counts,
    report_file:reportName,
    verified_db_readback:false,
    status:counts.FAIL>0||counts.STOPPED>0||Number(r.headers.get('X-GM-Safe-Update-Invalid')||0)>0?'PARTIAL_OR_FAILED':(parsed.length===0?'UNVERIFIED_REPORT':(apply?'SERVER_APPLY_REPORTED':'VALIDATION_ONLY'))
  };
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=reportName; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  return summary;
}
function safeUpdateResult(summary,filename){
  const el=document.getElementById('safeUpdateResult');
  if(!el)return;
  const c=summary&&summary.result_counts||{};
  const mode=summary&&summary.mode==='DRY_RUN'?'검증만 실행 · DB 변경 없음':'실제 업데이트 요청';
  let state=summary&&summary.status;
  if(!summary)state='UNVERIFIED_REPORT';
  const heading=state==='PARTIAL_OR_FAILED'?'일부 실패 / 처리 내역 확인 필요':state==='UNVERIFIED_REPORT'?'서버 응답 확인 · 처리 행 판정 불가':state==='VALIDATION_ONLY'?'검증 완료 (DB 미변경)':'서버 업데이트 처리 응답 수신';
  const details='파일: '+filename+' | '+mode+' | 처리 '+(summary&&summary.processed||0)+'행 | 수정 '+(c.UPDATED||0)+' | 신규 '+(c.INSERTED||0)+' | 실패 '+(c.FAIL||0)+' | 중단 '+(c.STOPPED||0)+' | 건너뜀 '+(c.SKIP||0)+' | 유효 수정 '+(c.VALID_UPDATE||0)+' | 유효 신규 '+(c.VALID_INSERT||0);
  el.textContent=heading+'\n'+details+'\n보고서: '+(summary&&summary.report_file||'-')+' (다운로드 요청)\nDB 재조회 검증: 미실시';
}
function safeUpdateError(err){
 const el=document.getElementById('safeUpdateResult');if(!el)return;
 const message=String(err&&err.message||err);
 const label=/HTTP 401|BUILDER_AUTH_INVALID/.test(message)?'인증 실패 (HTTP 401) · 작업 거부':/HTTP 403/.test(message)?'권한 부족 (HTTP 403) · 작업 거부':/인증 취소/.test(message)?'인증 취소 · 작업 미실행':'업로드/검증 실패 또는 처리 상태 미확인';
 el.textContent=label+'\n'+message+'\n파일 반영 여부는 서버 기록 또는 DB 재조회로 확인해야 합니다.';
}

async function send(apply,button){
  const f=document.getElementById('file').files[0]; if(!f){alert('Excel 또는 CSV 파일을 선택하세요.');return;}
  const table=document.getElementById('upTable').value; const timed=startButtonTimer(button,apply?'업데이트 중':'검증 중');
  try{ const summary=await uploadSafe(table,f,apply); safeUpdateResult(summary,f.name);log({file:f.name,result:summary&&summary.status||'UNVERIFIED',...summary}); }catch(e){safeUpdateError(e);log(String(e&&e.message||e));}finally{stopButtonTimer(timed);}
}
async function sendAll(apply,button){
  const files=[...document.getElementById('multiFiles').files]; if(!files.length){alert('파일들을 선택하세요.');return;}
  const timed=startButtonTimer(button,apply?'전체 업데이트 중':'전체 검증 중'); const result=[];
  try{ for(const f of files){ const text=await readCsvText(f); if(isCafe24MemberCsvText(text)){ await uploadCafe24MemberText(text,f.name,apply); result.push({file:f.name,table:'cafe24_member',result:'DONE'}); continue; } const key=inferTableFromFileName(f.name); if(!key){result.push({file:f.name,result:'SKIP',reason:'테이블명 추정 실패'});continue;} await uploadSafe(key,f,apply); result.push({file:f.name,table:key,result:'SERVER_RESPONDED'}); } log(result); }catch(e){safeUpdateError(e);log(String(e&&e.message||e));}finally{stopButtonTimer(timed);}
}
function dryRun(button){return send(false,button)} function applyUpdate(button){return send(true,button)} function dryRunAll(button){return sendAll(false,button)} function applyAll(button){return sendAll(true,button)}
fillSelect('upTable').then(()=>{try{const key=new URLSearchParams(location.search||'').get('table');const el=document.getElementById('upTable');if(key&&el&&Array.from(el.options).some(o=>o.value===key))el.value=key;}catch(_){}});

async function applyLeafOnly(button){
  const f=document.getElementById('file').files[0]; if(!f){alert('Excel 또는 CSV 파일을 선택하세요.');return;}
  const table=document.getElementById('upTable').value;
  if(table!=='category'){ log('카테고리(gm_category)를 선택해야 합니다.'); return; }
  const timed=startButtonTimer(button,'leaf_yn 업데이트 중');
  try{
    const summary=await uploadSafe(table,f,true,true);
    log({file:f.name,...summary});
  }catch(e){safeUpdateError(e);log(String(e&&e.message||e));}finally{stopButtonTimer(timed);}
}
