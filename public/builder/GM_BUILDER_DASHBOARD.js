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
