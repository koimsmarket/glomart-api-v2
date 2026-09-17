// GM_BUILDER_PRODUCT_QUEUE_UI_V001
// Read-only product queue adaptive-concurrency monitor.
function pqPct(v){return v==null?'-':(Number(v)*100).toFixed(1)+'%';}
function pqMb(v){return v==null?'-':Number(v).toFixed(1)+' MB';}
async function loadProductQueueParallelStatus(){
  const body=document.getElementById('productQueueParallelStatus');if(!body)return;
  try{
    const r=await fetch(`${API}/api/gm/builder/product-queue/status?t=${Date.now()}`,{cache:'no-store'});
    const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.detail||j.error||`HTTP ${r.status}`);
    const c=j.controller||{},m=j.memory||{},cm=j.controller_memory||{},cpu=j.cpu||{},db=j.db_pool||{};
    body.innerHTML=`
      <tr><th>허용 병렬수</th><td><b>${c.ready?fmt(c.allowedConcurrency):'-'}</b></td></tr>
      <tr><th>현재 실행</th><td><b>${c.ready?fmt(c.active):'-'} / ${c.ready?fmt(c.allowedConcurrency):'-'}</b></td></tr>
      <tr><th>대기 Queue</th><td>${c.ready?fmt(c.pending):'-'}</td></tr>
      <tr><th>Controller Min / Max</th><td>${c.ready?fmt(c.min):'-'} / ${c.ready?fmt(c.max):'-'}</td></tr>
      <tr><th>CPU Load</th><td>${pqPct(cpu.load_ratio)} (${fmt(cpu.count)} core)</td></tr>
      <tr><th>Controller 메모리</th><td>${cm.percent==null?'-':cm.percent+'%'} (V002 판단값)</td></tr>
      <tr><th>컨테이너 메모리</th><td><b>${m.percent==null?'-':m.percent+'%'}</b> (${pqMb(m.used_mb)} / ${pqMb(m.limit_mb)})</td></tr>
      <tr><th>DB Pool</th><td>busy ${fmt(db.busy)} / max ${fmt(db.max)} · idle ${fmt(db.idle)} · wait ${fmt(db.waiting)}</td></tr>
      <tr><th>Controller 갱신</th><td>${c.updated_at||'worker 첫 계산 대기'}</td></tr>`;
  }catch(e){body.innerHTML=`<tr><td>Product Queue 상태 조회 실패: ${String(e&&e.message||e)}</td></tr>`;}
}
loadProductQueueParallelStatus();
setInterval(()=>loadProductQueueParallelStatus(),10000);
