function setAllExportChecks(checked){ document.querySelectorAll('.exportTableCheck').forEach(x=>x.checked=!!checked); }
function selectedExportTables(){ return [...document.querySelectorAll('.exportTableCheck:checked')].map(x=>x.value); }
async function requestCsvExport(table){
  const pageSize = table === 'products' ? 250 : 2000;
  const url = `${API}/api/gm/builder/export?table=${encodeURIComponent(table)}&format=csv&pageSize=${pageSize}&t=${Date.now()}`;
  const r = await fetch(url,{method:'GET',cache:'no-store'});
  if(r.ok) return r;
  const txt = await r.text().catch(()=>String(r.status));
  const err = new Error(`HTTP ${r.status} ${txt.slice(0,500)}`);
  err.httpStatus = r.status;
  throw err;
}
async function writeResponseToDirectory(response,filename,directoryHandle){
  const fileHandle=await directoryHandle.getFileHandle(filename,{create:true});
  const writable=await fileHandle.createWritable();
  let bytes=0;
  try{
    if(response.body && typeof response.body.getReader==='function'){
      const reader=response.body.getReader();
      while(true){
        const {done,value}=await reader.read();
        if(done) break;
        if(value && value.byteLength){
          await writable.write(value);
          bytes+=value.byteLength;
        }
      }
    }else{
      const blob=await response.blob();
      await writable.write(blob);
      bytes=blob.size;
    }
    await writable.close();
  }catch(e){
    try{ await writable.abort(); }catch(_){ }
    throw e;
  }
  const savedFile=await fileHandle.getFile();
  if(savedFile.size!==bytes){
    throw new Error(`저장 크기 불일치: ${filename} (${savedFile.size}/${bytes})`);
  }
  return {filename,bytes:savedFile.size,verified:true,streamed:true};
}
async function responseToBlobWithRetry(table){
  let lastError=null;
  for(let attempt=1;attempt<=2;attempt++){
    try{
      const response=await requestCsvExport(table);
      return await response.blob();
    }catch(e){
      lastError=e;
      const retryable=!e.httpStatus || [502,503,504].includes(e.httpStatus);
      if(!retryable || attempt===2) throw e;
      log(`${table}: 서버 일시 오류, 5초 후 1회 재시도합니다.`);
      await sleep(5000);
    }
  }
  throw lastError||new Error('download failed');
}
async function saveCsvStream(table,filename,directoryHandle){
  let lastError=null;
  for(let attempt=1;attempt<=2;attempt++){
    try{
      const response=await requestCsvExport(table);
      if(directoryHandle){
        return await writeResponseToDirectory(response,filename,directoryHandle);
      }
      if(table==='product_image_vector' && window.showSaveFilePicker && response.body && typeof response.body.getReader==='function'){
        const handle=await window.showSaveFilePicker({
          suggestedName:filename,
          types:[{description:'CSV',accept:{'text/csv':['.csv']}}]
        });
        const writable=await handle.createWritable();
        let bytes=0;
        try{
          const reader=response.body.getReader();
          while(true){
            const {done,value}=await reader.read();
            if(done) break;
            if(value && value.byteLength){
              await writable.write(value);
              bytes+=value.byteLength;
            }
          }
          await writable.close();
        }catch(e){
          try{ await writable.abort(); }catch(_){ }
          throw e;
        }
        return {filename,bytes,verified:true,streamed:true};
      }
      const blob=await response.blob();
      await saveBlobAsFile(blob,filename,null);
      return {filename,bytes:blob.size,verified:false,streamed:false};
    }catch(e){
      lastError=e;
      const retryable=!e.httpStatus || [502,503,504].includes(e.httpStatus);
      if(!retryable || attempt===2) throw e;
      log(`${table}: 전송 중 오류, 5초 후 처음부터 1회 재시도합니다.`);
      await sleep(5000);
    }
  }
  throw lastError||new Error('download failed');
}
async function exportTableToFile(table,format,directoryHandle){
  const stamp=Date.now();
  // Large vector table only: browser-side XLSX conversion duplicates the entire 512D CSV
  // in memory. Save as streamed CSV instead; Excel opens it normally.
  // Every other table keeps the existing behavior unchanged.
  const actualFormat=((table==='products' || table==='product_image_vector') && format==='xlsx') ? 'csv' : format;
  if(actualFormat==='csv'){
    const filename=`${table}_${stamp}.csv`;
    const saved=await saveCsvStream(table,filename,directoryHandle);
    return {...saved,requested_format:format,actual_format:actualFormat};
  }
  if(!window.XLSX) throw new Error('Excel 변환 라이브러리를 불러오지 못했습니다.');
  const csvBlob=await responseToBlobWithRetry(table);
  const text=await csvBlob.text();
  const wb=XLSX.read(text,{type:'string',raw:true});
  const oldName=wb.SheetNames[0];
  const safeName=String(table||'Data').replace(/[\\/*?:[\]]/g,' ').slice(0,31)||'Data';
  if(oldName!==safeName){
    wb.Sheets[safeName]=wb.Sheets[oldName];
    delete wb.Sheets[oldName];
    wb.SheetNames[0]=safeName;
  }
  const out=XLSX.write(wb,{bookType:'xlsx',type:'array',compression:true});
  const blob=new Blob([out],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const filename=`${table}_${stamp}.xlsx`;
  await saveBlobAsFile(blob,filename,directoryHandle);
  return {filename,bytes:blob.size,verified:!!directoryHandle,streamed:false,requested_format:format,actual_format:actualFormat};
}
async function download(button){
  const t=document.getElementById('downTable').value, f=document.getElementById('format').value;
  const timed=startButtonTimer(button,`${f==='xlsx'?'Excel':'CSV'} 준비 중`);
  log(`개별 다운로드 준비 중: ${t} / ${f==='xlsx'?'Excel':'CSV'}`);
  try{
    const saved=await exportTableToFile(t,f,null);
    log(`다운로드 시작: ${saved.filename} / ${timed?timed.seconds:0}초 / ${saved.bytes.toLocaleString()} bytes`);
  }catch(e){ log(`다운로드 오류: ${String(e&&e.message||e)}`); }
  finally{ stopButtonTimer(timed); }
}

let downloadAllRunning=false;
function splitIntoFiveGroups(items){
  const unique=[...new Set(items)];
  const product=unique.includes('products') ? ['products'] : [];
  const rest=unique.filter(x=>x!=='products');
  const groupCount=Math.min(4,Math.max(1,rest.length));
  const groups=[];
  if(product.length) groups.push(product); // 1번 조: 상품 단독
  if(rest.length){
    const restGroups=Array.from({length:groupCount},()=>[]);
    rest.forEach((item,index)=>restGroups[index%groupCount].push(item));
    groups.push(...restGroups.filter(g=>g.length));
  }
  return groups;
}
function sleep(ms){ return new Promise(resolve=>setTimeout(resolve,ms)); }
async function chooseDownloadDirectory(){
  if(!window.isSecureContext || typeof window.showDirectoryPicker!=='function') return null;
  try{
    return await window.showDirectoryPicker({id:'gm-builder-export',mode:'readwrite'});
  }catch(e){
    if(e && e.name==='AbortError') throw new Error('저장 폴더 선택이 취소되었습니다.');
    throw e;
  }
}
async function saveBlobAsFile(blob,filename,directoryHandle){
  if(directoryHandle){
    const fileHandle=await directoryHandle.getFileHandle(filename,{create:true});
    const writable=await fileHandle.createWritable();
    try{
      await writable.write(blob);
      await writable.close();
    }catch(e){
      try{ await writable.abort(); }catch(_){ }
      throw e;
    }
    const savedFile=await fileHandle.getFile();
    if(savedFile.size!==blob.size){
      throw new Error(`저장 크기 불일치: ${filename} (${savedFile.size}/${blob.size})`);
    }
    return {verified:true,size:savedFile.size};
  }
  const a=document.createElement('a');
  const objectUrl=URL.createObjectURL(blob);
  a.href=objectUrl;
  a.download=filename;
  document.body.appendChild(a);
  a.click();
  await sleep(1200);
  URL.revokeObjectURL(objectUrl);
  a.remove();
  return {verified:false,size:blob.size};
}
async function runExportGroup(group,gi,totalGroups,format,timed,shared,directoryHandle){
  const groupResult=[];
  for(let i=0;i<group.length;i++){
    const table=group[i];
    const ordinal=++shared.started;
    setButtonTimerLabel(timed,`${gi+1}/${totalGroups}조 ${ordinal}/${shared.total} ${table}`);
    try{
      // gm_product는 단독 실행하며 Excel 선택 상태에서도 CSV 스트림으로 디스크에 직접 기록합니다.
      const saved=await exportTableToFile(table,format,directoryHandle);
      shared.completed++;
      const actualFormat=saved.actual_format;
      const row={group:gi+1,table,ok:true,bytes:saved.bytes,file:saved.filename,requested_format:format,actual_format:actualFormat,verified:saved.verified,streamed:saved.streamed};
      groupResult.push(row);
      shared.results.push(row);
      log(`${gi+1}/${totalGroups}조 ${shared.completed}/${shared.total} 완료: ${saved.filename}`+(actualFormat!==format?' (상품은 안정성을 위해 CSV)':''));
    }catch(e){
      shared.completed++;
      const msg=String(e&&e.message||e);
      const row={group:gi+1,table,ok:false,error:msg};
      groupResult.push(row);
      shared.results.push(row);
      log(`${gi+1}/${totalGroups}조 ${table} 실패: ${msg} / 다른 조는 계속 진행합니다.`);
    }
    if(i<group.length-1) await sleep(800);
  }
  return groupResult;
}
async function downloadAll(button){
  if(downloadAllRunning) return;
  const selected=selectedExportTables();
  if(!selected.length){ alert('다운로드할 테이블을 하나 이상 선택하세요.'); return; }

  downloadAllRunning=true;
  const f=document.getElementById('format').value;
  const groups=splitIntoFiveGroups(selected);
  const total=selected.length;
  const timed=startButtonTimer(button,`${groups.length}개조 0/${total} 준비 중`);
  const shared={started:0,completed:0,total,results:[]};
  let directoryHandle=null;

  try{
    directoryHandle=await chooseDownloadDirectory();
    if(directoryHandle){
      log(`저장 폴더가 선택되었습니다. 각 파일은 디스크 기록과 크기 확인이 끝난 뒤 다음 파일을 시작합니다.`);
    }else{
      log(`이 브라우저는 폴더 직접 저장을 지원하지 않습니다. 브라우저의 '여러 파일 다운로드 허용'이 필요합니다.`);
    }
    log(`${total}개 테이블을 ${groups.length}개 조로 실행합니다. gm_product는 다른 다운로드와 겹치지 않게 단독 실행하고, 저장 완료가 확인된 뒤 다음 조를 시작합니다.`+(f==='xlsx'&&selected.includes('products')?' 상품은 메모리 멈춤 방지를 위해 CSV로 저장됩니다.':''));
    const groupStatus=[];
    // 중요: gm_product가 포함된 1번 조부터 시작하며, 각 조를 반드시 await합니다.
    // 따라서 상품 다운로드 중에는 다른 테이블 요청이 한 건도 실행되지 않습니다.
    for(let gi=0; gi<groups.length; gi++){
      try{
        await runExportGroup(groups[gi],gi,groups.length,f,timed,shared,directoryHandle);
        groupStatus.push({group:gi+1,status:'fulfilled'});
      }catch(e){
        groupStatus.push({group:gi+1,status:'rejected',error:String(e&&e.message||e)});
      }
      if(gi<groups.length-1) await sleep(1000);
    }
    const okCount=shared.results.filter(x=>x.ok).length;
    const fail=shared.results.filter(x=>!x.ok);
    log({action:'selected-export-product-standalone-stream-save-v041',selected:total,processed:shared.results.length,groups:groups.length,success:okCount,failed:fail.length,seconds:timed?timed.seconds:0,group_status:groupStatus,failures:fail});
    if(fail.length) alert(`다운로드 종료: 성공 ${okCount}개, 실패 ${fail.length}개\n실패한 테이블만 다시 선택해 재실행하세요.`);
  }finally{
    downloadAllRunning=false;
    stopButtonTimer(timed);
  }
}

fillSelect('downTable'); fillChecks('exportTableChecks');
