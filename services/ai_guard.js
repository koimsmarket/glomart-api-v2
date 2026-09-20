'use strict';
// GM_AI_CATEGORY_CONNECT_V005
// Persistent AI billing/rate guard using the existing gm_runtime_config table.
// No new table: settings + rolling hour/day state are kept as config rows.

const {monthKey}=require('./ai_usage');

const DEFAULTS={
  ai_guard_enabled:['1','BOOLEAN','AI_GUARD','AI 호출 안전장치 사용 여부'],
  ai_emergency_stop:['0','BOOLEAN','AI_GUARD','즉시 모든 AI 호출 중단'],
  ai_monthly_budget_usd:['8','NUMBER','AI_GUARD','서버 자체 월 예산 USD. OpenAI 조직 한도보다 낮게 설정'],
  ai_daily_budget_usd:['2','NUMBER','AI_GUARD','서버 자체 일 예산 USD'],
  ai_hourly_request_limit:['30','NUMBER','AI_GUARD','시간당 최대 AI 요청 수'],
  ai_daily_request_limit:['300','NUMBER','AI_GUARD','일 최대 AI 요청 수'],
  ai_max_output_tokens:['256','NUMBER','AI 1회 요청 최대 출력 토큰'],
  ai_retry_max:['2','NUMBER','AI 호출 실패 시 최대 재시도 횟수. 호출 모듈이 재시도를 사용할 때 적용'],
  ai_duplicate_cooldown_sec:['300','NUMBER','동일 작업키 중복 호출 차단 시간(초)'],
  ai_price_gpt_5_6_luna_input:['0.20','NUMBER','gpt-5.6-luna 입력 100만 토큰당 USD'],
  ai_price_gpt_5_6_luna_output:['1.20','NUMBER','gpt-5.6-luna 출력 100만 토큰당 USD'],
  ai_price_gpt_5_6_sol_input:['4.00','NUMBER','gpt-5.6-sol 입력 100만 토큰당 USD'],
  ai_price_gpt_5_6_sol_output:['20.00','NUMBER','gpt-5.6-sol 출력 100만 토큰당 USD']
};
const STATE_KEY='ai_guard_usage_state';

function S(v){return String(v==null?'':v).trim();}
function N(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
function B(v,d=false){const s=S(v).toLowerCase();return ['1','true','y','yes','on'].includes(s)?true:(['0','false','n','no','off'].includes(s)?false:d);}
function clampInt(v,d,min,max){const n=Math.floor(N(v,d));return Math.max(min,Math.min(max,n));}
function kstParts(date=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const g=t=>parts.find(x=>x.type===t)?.value||'';
  const day=`${g('year')}-${g('month')}-${g('day')}`;
  return {day,hour:`${day}T${g('hour')}`};
}
async function ensureDefaults(db){
  for(const [key,[value,type,category,description]] of Object.entries(DEFAULTS)){
    // V005: 운영 DB의 구버전 gm_runtime_config에서 description이 VARCHAR(40)인 경우도 안전하게 동작하도록
    // description은 여기서 저장하지 않는다. 설정 의미/라벨은 Builder UI가 담당한다.
    await db.query(`INSERT INTO gm_runtime_config(config_key,config_value,value_type,category,mode,enabled,updated_at)
      VALUES($1,$2,$3,$4,'FIXED',TRUE,now()) ON CONFLICT(config_key) DO NOTHING`,[key,value,type,category]);
  }
  await db.query(`INSERT INTO gm_runtime_config(config_key,config_value,value_type,category,mode,enabled,updated_at)
    VALUES($1,$2,'JSON','AI_STATE','AUTO',TRUE,now())
    ON CONFLICT(config_key) DO NOTHING`,[STATE_KEY,JSON.stringify({hour:'',hour_count:0,day:'',day_count:0,day_cost_usd:0,dedup:{}})]);
}
async function settings(db){
  await ensureDefaults(db);
  const keys=Object.keys(DEFAULTS);
  const r=await db.query(`SELECT config_key,config_value FROM gm_runtime_config WHERE config_key=ANY($1::text[])`,[keys]);
  const m={}; for(const x of r.rows)m[x.config_key]=x.config_value;
  return {
    enabled:B(m.ai_guard_enabled,true),emergency_stop:B(m.ai_emergency_stop,false),
    monthly_budget_usd:Math.max(0,N(m.ai_monthly_budget_usd,8)),daily_budget_usd:Math.max(0,N(m.ai_daily_budget_usd,2)),
    hourly_request_limit:clampInt(m.ai_hourly_request_limit,30,1,100000),daily_request_limit:clampInt(m.ai_daily_request_limit,300,1,1000000),
    max_output_tokens:clampInt(m.ai_max_output_tokens,256,16,128000),retry_max:clampInt(m.ai_retry_max,2,0,10),
    duplicate_cooldown_sec:clampInt(m.ai_duplicate_cooldown_sec,300,0,86400),
    price_luna_input:Math.max(0,N(m.ai_price_gpt_5_6_luna_input,0.20)),price_luna_output:Math.max(0,N(m.ai_price_gpt_5_6_luna_output,1.20)),
    price_sol_input:Math.max(0,N(m.ai_price_gpt_5_6_sol_input,4.00)),price_sol_output:Math.max(0,N(m.ai_price_gpt_5_6_sol_output,20.00))
  };
}
async function saveSettings(db,input={}){
  await ensureDefaults(db);
  const values={
    ai_guard_enabled:B(input.enabled,true)?'1':'0',ai_emergency_stop:B(input.emergency_stop,false)?'1':'0',
    ai_monthly_budget_usd:String(Math.max(0,N(input.monthly_budget_usd,8))),ai_daily_budget_usd:String(Math.max(0,N(input.daily_budget_usd,2))),
    ai_hourly_request_limit:String(clampInt(input.hourly_request_limit,30,1,100000)),ai_daily_request_limit:String(clampInt(input.daily_request_limit,300,1,1000000)),
    ai_max_output_tokens:String(clampInt(input.max_output_tokens,256,16,128000)),ai_retry_max:String(clampInt(input.retry_max,2,0,10)),
    ai_duplicate_cooldown_sec:String(clampInt(input.duplicate_cooldown_sec,300,0,86400)),
    ai_price_gpt_5_6_luna_input:String(Math.max(0,N(input.price_luna_input,0.20))),ai_price_gpt_5_6_luna_output:String(Math.max(0,N(input.price_luna_output,1.20))),
    ai_price_gpt_5_6_sol_input:String(Math.max(0,N(input.price_sol_input,4.00))),ai_price_gpt_5_6_sol_output:String(Math.max(0,N(input.price_sol_output,20.00)))
  };
  for(const [key,value] of Object.entries(values))await db.query(`UPDATE gm_runtime_config SET config_value=$2,updated_at=now() WHERE config_key=$1`,[key,value]);
  return settings(db);
}
function pricingFor(model,st){
  const m=S(model).toLowerCase();
  if(m.startsWith('gpt-5.6-luna'))return {input:st.price_luna_input,output:st.price_luna_output};
  if(m.startsWith('gpt-5.6-sol')||m==='gpt-5.6')return {input:st.price_sol_input,output:st.price_sol_output};
  return null;
}
function estimateCost(model,usage,st){
  const p=pricingFor(model,st); if(!p)throw new Error('AI_MODEL_PRICE_NOT_CONFIGURED:'+S(model));
  const input=Math.max(0,N(usage&&usage.input_tokens,0)),output=Math.max(0,N(usage&&usage.output_tokens,0));
  return (input*p.input+output*p.output)/1000000;
}
async function monthUsage(db){
  try{const r=await db.query(`SELECT COALESCE(SUM(estimated_cost),0)::numeric AS cost,COALESCE(SUM(request_count),0)::bigint AS requests,COALESCE(SUM(total_tokens),0)::bigint AS tokens FROM gm_ai_usage_monthly WHERE usage_month=$1`,[monthKey()]);return {cost:N(r.rows[0]?.cost,0),requests:N(r.rows[0]?.requests,0),tokens:N(r.rows[0]?.tokens,0)};}catch(_){return {cost:0,requests:0,tokens:0};}
}
async function withState(db,fn){
  const client=typeof db.connect==='function'?await db.connect():db; const own=client!==db;
  try{
    await client.query('BEGIN');
    await ensureDefaults(client);
    const r=await client.query(`SELECT config_value FROM gm_runtime_config WHERE config_key=$1 FOR UPDATE`,[STATE_KEY]);
    let state={}; try{state=JSON.parse(r.rows[0]?.config_value||'{}')||{};}catch(_){state={};}
    const now=Date.now(),kp=kstParts();
    if(state.hour!==kp.hour){state.hour=kp.hour;state.hour_count=0;}
    if(state.day!==kp.day){state.day=kp.day;state.day_count=0;state.day_cost_usd=0;}
    state.dedup=state.dedup&&typeof state.dedup==='object'?state.dedup:{};
    for(const [k,t] of Object.entries(state.dedup))if(now-N(t,0)>86400000)delete state.dedup[k];
    const out=await fn(state,client,{now,...kp});
    await client.query(`UPDATE gm_runtime_config SET config_value=$2,updated_at=now() WHERE config_key=$1`,[STATE_KEY,JSON.stringify(state)]);
    await client.query('COMMIT'); return out;
  }catch(e){try{await client.query('ROLLBACK');}catch(_){} throw e;}finally{if(own)client.release();}
}
async function preflight(db,{model,max_output_tokens,dedup_key=''}={}){
  const st=await settings(db); if(!st.enabled)return {settings:st,guarded:false,max_output_tokens:Math.max(16,N(max_output_tokens,64))};
  if(st.emergency_stop){const e=new Error('AI_EMERGENCY_STOP');e.code='AI_EMERGENCY_STOP';throw e;}
  if(!pricingFor(model,st)){const e=new Error('AI_MODEL_PRICE_NOT_CONFIGURED:'+S(model));e.code='AI_MODEL_PRICE_NOT_CONFIGURED';throw e;}
  const month=await monthUsage(db);
  if(st.monthly_budget_usd>0&&month.cost>=st.monthly_budget_usd){const e=new Error('AI_MONTHLY_BUDGET_EXCEEDED');e.code='AI_MONTHLY_BUDGET_EXCEEDED';throw e;}
  const requested=clampInt(max_output_tokens,64,16,128000); if(requested>st.max_output_tokens){const e=new Error(`AI_MAX_OUTPUT_TOKENS_EXCEEDED:${requested}>${st.max_output_tokens}`);e.code='AI_MAX_OUTPUT_TOKENS_EXCEEDED';throw e;}
  return withState(db,async(state,_client,ctx)=>{
    if(st.hourly_request_limit>0&&N(state.hour_count,0)>=st.hourly_request_limit){const e=new Error('AI_HOURLY_REQUEST_LIMIT_EXCEEDED');e.code='AI_HOURLY_REQUEST_LIMIT_EXCEEDED';throw e;}
    if(st.daily_request_limit>0&&N(state.day_count,0)>=st.daily_request_limit){const e=new Error('AI_DAILY_REQUEST_LIMIT_EXCEEDED');e.code='AI_DAILY_REQUEST_LIMIT_EXCEEDED';throw e;}
    if(st.daily_budget_usd>0&&N(state.day_cost_usd,0)>=st.daily_budget_usd){const e=new Error('AI_DAILY_BUDGET_EXCEEDED');e.code='AI_DAILY_BUDGET_EXCEEDED';throw e;}
    const dk=S(dedup_key); if(dk&&st.duplicate_cooldown_sec>0){const prev=N(state.dedup[dk],0);if(prev&&ctx.now-prev<st.duplicate_cooldown_sec*1000){const e=new Error('AI_DUPLICATE_COOLDOWN');e.code='AI_DUPLICATE_COOLDOWN';throw e;}state.dedup[dk]=ctx.now;}
    state.hour_count=N(state.hour_count,0)+1;state.day_count=N(state.day_count,0)+1;
    return {settings:st,guarded:true,max_output_tokens:Math.min(requested,st.max_output_tokens),month,state:{hour:state.hour,hour_count:state.hour_count,day:state.day,day_count:state.day_count,day_cost_usd:N(state.day_cost_usd,0)}};
  });
}
async function postSuccess(db,{model,usage}={}){
  const st=await settings(db),cost=estimateCost(model,usage||{},st);
  await withState(db,async(state)=>{state.day_cost_usd=N(state.day_cost_usd,0)+cost;return null;});
  return {estimated_cost:cost,currency:'USD'};
}
async function status(db){
  const st=await settings(db),month=await monthUsage(db);
  const state=await withState(db,async(s)=>({hour:s.hour,hour_count:N(s.hour_count,0),day:s.day,day_count:N(s.day_count,0),day_cost_usd:N(s.day_cost_usd,0)}));
  return {settings:st,month,state};
}
module.exports={ensureDefaults,settings,saveSettings,pricingFor,estimateCost,preflight,postSuccess,status};
