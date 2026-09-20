'use strict';
// GM_BUILDER_AI_USAGE_V001 - read-only monthly AI/API usage monitor.
const express=require('express');
const router=express.Router();
const {dbFrom,ok,fail}=require('./core');

function validMonth(v){
  const s=String(v||'').trim();
  return /^\d{4}-\d{2}$/.test(s)?s:null;
}
function seoulMonth(){
  const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit'}).formatToParts(new Date());
  return `${p.find(x=>x.type==='year').value}-${p.find(x=>x.type==='month').value}`;
}
function previousMonth(s){ const [y,m]=s.split('-').map(Number); const d=new Date(Date.UTC(y,m-2,1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`; }

async function monthRows(db,month){
  const r=await db.query(`SELECT
      t.service_group,t.task_type,t.task_name_ko,t.description,t.active_yn,t.sort_order,
      COALESCE(u.provider,'') AS provider,COALESCE(u.model_name,'') AS model_name,
      COALESCE(u.request_count,0)::bigint AS request_count,
      COALESCE(u.prompt_tokens,0)::bigint AS prompt_tokens,
      COALESCE(u.completion_tokens,0)::bigint AS completion_tokens,
      COALESCE(u.total_tokens,0)::bigint AS total_tokens,
      COALESCE(u.estimated_cost,0)::numeric AS estimated_cost,
      COALESCE(u.currency,'USD') AS currency,u.last_used_at
    FROM gm_ai_usage_task t
    LEFT JOIN gm_ai_usage_monthly u
      ON u.task_type=t.task_type AND u.usage_month=$1::date
    WHERE t.active_yn='Y'
    ORDER BY t.sort_order,t.service_group,t.task_type,u.provider,u.model_name,u.currency`,[month+'-01']);
  return r.rows;
}
function totals(rows){
  const x={request_count:0,prompt_tokens:0,completion_tokens:0,total_tokens:0,cost_by_currency:{}};
  for(const r of rows){
    x.request_count+=Number(r.request_count||0);x.prompt_tokens+=Number(r.prompt_tokens||0);x.completion_tokens+=Number(r.completion_tokens||0);x.total_tokens+=Number(r.total_tokens||0);
    const c=String(r.currency||'USD');x.cost_by_currency[c]=(x.cost_by_currency[c]||0)+Number(r.estimated_cost||0);
  }
  return x;
}

router.get('/api/gm/builder/ai-usage',async(req,res)=>{
  const db=dbFrom(req),month=validMonth(req.query.month)||seoulMonth(),prev=previousMonth(month);
  try{
    const [rows,prevRows,trend]=await Promise.all([
      monthRows(db,month),monthRows(db,prev),
      db.query(`SELECT to_char(usage_month,'YYYY-MM') AS usage_month,
        SUM(request_count)::bigint AS request_count,SUM(total_tokens)::bigint AS total_tokens,
        SUM(estimated_cost)::numeric AS estimated_cost,currency
        FROM gm_ai_usage_monthly
        WHERE usage_month >= ($1::date - interval '11 months')
        GROUP BY usage_month,currency ORDER BY usage_month,currency`,[month+'-01'])
    ]);
    ok(res,{month,previous_month:prev,items:rows,totals:totals(rows),previous_totals:totals(prevRows),trend:trend.rows});
  }catch(e){
    const msg=String(e&&e.message||e);
    fail(res,500,'AI usage monitor failed',{detail:msg,hint:/gm_ai_usage_(task|monthly)/.test(msg)?'migration 123_gm_ai_usage_monthly.sql 적용 필요':''});
  }
});

module.exports=router;
