'use strict';
// GM_AI_USAGE_V001
// Shared monthly AI/API usage accumulator.
// Callers record usage after a provider response. This module does not call any AI provider.

function text(v){ return String(v == null ? '' : v).trim(); }
function nonnegInt(v){ const n=Number(v); return Number.isFinite(n) && n>0 ? Math.floor(n) : 0; }
function nonnegNum(v){ const n=Number(v); return Number.isFinite(n) && n>0 ? n : 0; }
function yn(v, d='Y'){ const s=text(v).toUpperCase(); return s==='N'?'N':(s==='Y'?'Y':d); }

function monthKey(value){
  const d=value ? new Date(value) : new Date();
  const safe=Number.isNaN(d.getTime()) ? new Date() : d;
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit'}).formatToParts(safe);
  const y=parts.find(x=>x.type==='year')?.value;
  const m=parts.find(x=>x.type==='month')?.value;
  return `${y}-${m}-01`;
}

async function ensureTask(db, meta={}){
  const taskType=text(meta.task_type||meta.taskType).toUpperCase();
  if(!taskType) throw new Error('task_type required');
  const group=text(meta.service_group||meta.serviceGroup||'OTHER').toUpperCase();
  const name=text(meta.task_name_ko||meta.taskNameKo||taskType);
  const description=text(meta.description);
  const active=yn(meta.active_yn||meta.activeYn,'Y');
  const sort=Number.isFinite(Number(meta.sort_order||meta.sortOrder))?Number(meta.sort_order||meta.sortOrder):100;
  await db.query(`INSERT INTO gm_ai_usage_task
    (task_type,service_group,task_name_ko,description,active_yn,sort_order,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,now(),now())
    ON CONFLICT(task_type) DO UPDATE SET
      service_group=EXCLUDED.service_group,
      task_name_ko=EXCLUDED.task_name_ko,
      description=CASE WHEN EXCLUDED.description='' THEN gm_ai_usage_task.description ELSE EXCLUDED.description END,
      active_yn=EXCLUDED.active_yn,
      sort_order=EXCLUDED.sort_order,
      updated_at=now()`,[taskType,group,name,description,active,sort]);
  return taskType;
}

async function recordUsage(db, input={}){
  if(!db || typeof db.query!=='function') throw new Error('db required');
  const taskType=await ensureTask(db,input);
  const prompt=nonnegInt(input.prompt_tokens ?? input.promptTokens);
  const completion=nonnegInt(input.completion_tokens ?? input.completionTokens);
  const suppliedTotal=nonnegInt(input.total_tokens ?? input.totalTokens);
  const total=suppliedTotal || (prompt+completion);
  const requests=Math.max(1,nonnegInt(input.request_count ?? input.requestCount) || 1);
  const provider=text(input.provider).toUpperCase();
  const model=text(input.model_name ?? input.modelName);
  const cost=nonnegNum(input.estimated_cost ?? input.estimatedCost);
  const currency=(text(input.currency)||'USD').toUpperCase();
  const usedAt=input.used_at||input.usedAt||new Date().toISOString();
  const month=monthKey(usedAt);
  const r=await db.query(`INSERT INTO gm_ai_usage_monthly
    (usage_month,task_type,provider,model_name,request_count,prompt_tokens,completion_tokens,total_tokens,estimated_cost,currency,last_used_at,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),now())
    ON CONFLICT(usage_month,task_type,provider,model_name,currency) DO UPDATE SET
      request_count=gm_ai_usage_monthly.request_count+EXCLUDED.request_count,
      prompt_tokens=gm_ai_usage_monthly.prompt_tokens+EXCLUDED.prompt_tokens,
      completion_tokens=gm_ai_usage_monthly.completion_tokens+EXCLUDED.completion_tokens,
      total_tokens=gm_ai_usage_monthly.total_tokens+EXCLUDED.total_tokens,
      estimated_cost=gm_ai_usage_monthly.estimated_cost+EXCLUDED.estimated_cost,
      last_used_at=GREATEST(COALESCE(gm_ai_usage_monthly.last_used_at,EXCLUDED.last_used_at),EXCLUDED.last_used_at),
      updated_at=now()
    RETURNING *`,[month,taskType,provider,model,requests,prompt,completion,total,cost,currency,usedAt]);
  return r.rows[0];
}

module.exports={ensureTask,recordUsage,monthKey};
