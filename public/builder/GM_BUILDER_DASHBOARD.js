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
