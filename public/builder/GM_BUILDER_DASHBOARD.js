// GM_BUILDER_DASHBOARD_V060_CORE_ONLY
// Dashboard core only: database/queue status and snapshot.
// Domain UI code belongs in separate GM_BUILDER_*.js files.

function fmt(n){ if(n===null||n===undefined) return '-'; return Number(n).toLocaleString(); }
function diffHtml(v){ if(v===null||v===undefined||v==='') return ''; const n=Number(v)||0; if(n>0) return `<span class="plus">+${fmt(n)}</span>`; if(n<0) return `<span class="minus">${fmt(n)}</span>`; return '0'; }
function badge(level){ level=String(level||'normal'); const txt={normal:'정상',prepare:'증설 준비',warning:'증설 진행',danger:'긴급 조치',unknown:'확인불가'}[level]||level; return `<span class="badge ${level}">${txt}</span>`; }
// Snapshot-only dashboard. Deprecated expensive realtime requests are NEVER performed here.
async function gmStatsLoadCachedV007(){
  const state=document.getElementById('gmStatsCachedStateV007');
  const rows=document.getElementById('gmStatsCachedRowsV007');
  try{
    const r=await fetch(`${API}/api/gm/builder/stats/snapshot`,{cache:'no-store'});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const j=await r.json();
    if(!j.ok) throw new Error(j.code||'snapshot unavailable');
    const list=Array.isArray(j.items)?j.items:[];
    if(state) state.textContent=j.setup_required?`통합 통계 테이블 준비 전 · 기존 스냅샷 ${list.length}개 표시`:`저장된 통계 ${list.length}개 (자동 계산 없음)`;
    if(rows){
      rows.replaceChildren();
      if(!list.length){const tr=rows.insertRow();const td=tr.insertCell();td.colSpan=5;td.textContent='저장된 통계가 없습니다.';}
      for(const v of list){
        const tr=rows.insertRow();
        for(const value of [v.service_code,v.major_category,v.table_name,v.row_count==null?'미확인':Number(v.row_count).toLocaleString(),v.calculated_at?new Date(v.calculated_at).toLocaleString('ko-KR'):'-']){
          const td=tr.insertCell();td.textContent=value==null?'':String(value);
        }
      }
    }
    const statusTime=document.getElementById('statusTime');
    if(statusTime) statusTime.textContent='실시간 전체 통계 조회 중단 · 저장 통계만 사용';
    const oldTable=document.getElementById('tableStatus');if(oldTable)oldTable.innerHTML='<tr><td>상단 저장 통계에서 확인</td></tr>';
    const oldQueue=document.getElementById('queueStatus');if(oldQueue)oldQueue.innerHTML='<tr><td>실시간 Queue 조회 비활성 (DB 부하 방지)</td></tr>';
    const oldDb=document.getElementById('dbStatus');if(oldDb)oldDb.textContent='저장된 통계만 표시합니다.';
  }catch(e){if(state)state.textContent='저장 통계 조회 실패: '+String(e.message||e);}
}
async function loadDashboard(save){return gmStatsLoadCachedV007();}

async function saveSnapshot(){ throw new Error('갱신 작업 미연결'); }

loadDashboard(false); // no periodic statistics refresh
