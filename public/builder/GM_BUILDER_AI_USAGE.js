// GM_BUILDER_AI_USAGE_V001
(function(){
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
  function n(v){return Number(v||0).toLocaleString();}
  function money(v,c){const x=Number(v||0);return x?`${c||'USD'} ${x.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:6})}`:'-';}
  function thisMonth(){const d=new Date(),f=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit'}),p=f.formatToParts(d);return `${p.find(x=>x.type==='year').value}-${p.find(x=>x.type==='month').value}`;}
  function costText(map){const a=Object.entries(map||{}).filter(([,v])=>Number(v||0)!==0);return a.length?a.map(([c,v])=>money(v,c)).join(' / '):'-';}
  async function load(){
    const m=document.getElementById('aiUsageMonth');if(!m)return;
    const month=m.value||thisMonth();
    const status=document.getElementById('aiUsageStatus'),body=document.getElementById('aiUsageRows');
    if(status)status.textContent='조회 중...';
    try{
      const r=await fetch(`${API}/api/gm/builder/ai-usage?month=${encodeURIComponent(month)}&t=${Date.now()}`),j=await r.json();
      if(!j.ok)throw new Error(j.error||j.detail||'AI usage load failed');
      const t=j.totals||{},pt=j.previous_totals||{};
      status.innerHTML=`<b>${esc(j.month)}</b> · 호출 ${n(t.request_count)}건 · 총 ${n(t.total_tokens)} tokens · 비용 ${esc(costText(t.cost_by_currency))}<br><span class="small">지난달 ${esc(j.previous_month)}: ${n(pt.request_count)}건 / ${n(pt.total_tokens)} tokens / ${esc(costText(pt.cost_by_currency))}</span>`;
      body.innerHTML=(j.items||[]).map(x=>`<tr>
        <td>${esc(x.service_group)}</td><td><b>${esc(x.task_name_ko)}</b><br><span class="small">${esc(x.task_type)}</span></td>
        <td>${esc(x.provider||'-')}</td><td>${esc(x.model_name||'-')}</td>
        <td class="num">${n(x.request_count)}</td><td class="num">${n(x.prompt_tokens)}</td><td class="num">${n(x.completion_tokens)}</td><td class="num">${n(x.total_tokens)}</td>
        <td class="num">${esc(money(x.estimated_cost,x.currency))}</td><td>${esc(x.last_used_at||'-')}</td></tr>`).join('')||'<tr><td colspan="10">등록된 작업 없음</td></tr>';
      if(window.log)log({action:'ai_usage.loaded',month:j.month,totals:t});
    }catch(e){
      if(status)status.textContent='조회 실패: '+(e&&e.message||e);
      if(body)body.innerHTML='<tr><td colspan="10">조회 실패</td></tr>';
    }
  }
  window.loadAiUsage=load;
  window.aiUsageCurrentMonth=function(){const m=document.getElementById('aiUsageMonth');if(m)m.value=thisMonth();load();};
  window.addEventListener('DOMContentLoaded',()=>{const m=document.getElementById('aiUsageMonth');if(m&&!m.value)m.value=thisMonth();load();});
})();
