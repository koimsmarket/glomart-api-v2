'use strict';
/* GM_IMAGE_VECTOR_BACKGROUND_V008
 * Image-vector processing is completely detached from SPECIAL/category search.
 *
 * Persistent work source: gm_image_vector_pending
 *   row exists  = work remains
 *   vector UPSERT succeeds = delete exactly the processed UID+URL+updated_at row
 *
 * Operating mode (persisted in gm_image_vector_background_config):
 *   OFF  = never start new vector jobs
 *   AUTO = 00:00~08:00 Asia/Seoul only. Start at container memory <= 70%, stop at >= 80%.
 *          70~80% is hysteresis: keep the current run/stop state.
 *   ON   = force run regardless of time and memory.
 *
 * Memory percentage uses cgroup container usage / container limit when available.
 * This includes the persistent MobileCLIP child-process memory.
 */
const express=require('express');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {fork}=require('child_process');
const router=express.Router();
const {parseCsv}=require('../../routes/builder/core');
const DIM=512;
const TICK_MS=Math.max(2000,Number(process.env.GM_IMAGE_VECTOR_TICK_MS||5000));
const MAX_SLOTS=Math.max(1,Math.min(8,Number(process.env.GM_IMAGE_VECTOR_MAX_SLOTS||4)));
const FETCH_WINDOW=Math.max(8,Math.min(100,Number(process.env.GM_IMAGE_VECTOR_FETCH_WINDOW||30)));
const FAIL_COOLDOWN_MS=Math.max(60000,Number(process.env.GM_IMAGE_VECTOR_FAIL_COOLDOWN_MS||600000));
// Vector is always lowest priority, even in ON mode. Product/search saves get a quiet window first.
const FOREGROUND_QUIET_MS=Math.max(3000,Number(process.env.GM_IMAGE_VECTOR_FOREGROUND_QUIET_MS||10000));
const AUTO_START_HOUR=0;
const AUTO_END_HOUR=8;
const AUTO_START_RATIO=0.70;
const AUTO_STOP_RATIO=0.80;
const VALID_MODES=new Set(['OFF','AUTO','ON']);
let poolRef=null,timer=null,worker=null,seq=0,pumping=false;
const inflight=new Map();
const failUntil=new Map();
let completed=0,failed=0,lastError='',lastMemory=null;
let mode='AUTO';
let autoRunning=false;
let schemaReady=false;
let foregroundQuietUntil=0;
let foregroundEventCount=0;
const S=v=>String(v==null?'':v).trim();
function log(tag,o){console.log('[GM_IMAGE_VECTOR_BACKGROUND_V008 '+tag+']',JSON.stringify(Object.assign({ts:new Date().toISOString()},o||{})));}
function readNumber(file){try{const s=fs.readFileSync(file,'utf8').trim();if(!s||s==='max')return null;const n=Number(s);return Number.isFinite(n)&&n>0?n:null;}catch(_){return null;}}
function containerLimit(){
  let limit=readNumber('/sys/fs/cgroup/memory.max');
  if(!limit)limit=readNumber('/sys/fs/cgroup/memory/memory.limit_in_bytes');
  if(!limit||limit>os.totalmem()*8){
    const constrained=typeof process.constrainedMemory==='function'?Number(process.constrainedMemory()||0):0;
    limit=constrained>0?constrained:os.totalmem();
  }
  return limit;
}
function containerUsage(){
  let used=readNumber('/sys/fs/cgroup/memory.current');
  if(!used)used=readNumber('/sys/fs/cgroup/memory/memory.usage_in_bytes');
  if(!used)used=Number(process.memoryUsage().rss||0);
  return used;
}
function memorySnapshot(){
  const used=containerUsage();
  const limit=containerLimit();
  const ratio=limit>0?used/limit:1;
  const source=(readNumber('/sys/fs/cgroup/memory.current')||readNumber('/sys/fs/cgroup/memory/memory.usage_in_bytes'))?'cgroup_usage/container_limit':'process_rss/container_limit_fallback';
  return {used_bytes:used,total_bytes:limit,ratio,percent:Math.round(ratio*1000)/10,source};
}
function kstHour(){return new Date(Date.now()+9*60*60*1000).getUTCHours();}
function inAutoWindow(){const h=kstHour();return h>=AUTO_START_HOUR&&h<AUTO_END_HOUR;}
function operatingDecision(mem){
  const inside=inAutoWindow();
  if(mode==='OFF')return {run:false,state:'OFF',inside};
  if(mode==='ON')return {run:true,state:'FORCED_ON',inside};
  if(!inside){autoRunning=false;return {run:false,state:'AUTO_TIME_WAIT',inside};}
  if(mem.ratio<=AUTO_START_RATIO)autoRunning=true;
  else if(mem.ratio>=AUTO_STOP_RATIO)autoRunning=false;
  return {run:autoRunning,state:autoRunning?'AUTO_RUNNING':'AUTO_MEMORY_WAIT',inside};
}
async function ensureSchema(){
  if(!poolRef)return;
  // Schema ownership belongs ONLY to migrations/110 and 111.
  // Runtime background code never CREATE/ALTER/DROP tables, indexes, functions or triggers.
  // This prevents concurrent catalog updates while the migration bootstrap is running.
  const pending=await poolRef.query("SELECT to_regclass('public.gm_image_vector_pending') AS t");
  const config=await poolRef.query("SELECT to_regclass('public.gm_image_vector_background_config') AS t");
  if(!(pending.rows[0]&&pending.rows[0].t) || !(config.rows[0]&&config.rows[0].t)){
    throw new Error('BACKGROUND_SCHEMA_NOT_READY');
  }
  const cfg=await poolRef.query('SELECT mode FROM gm_image_vector_background_config WHERE config_id=1');
  const saved=S(cfg.rows[0]&&cfg.rows[0].mode).toUpperCase();
  if(VALID_MODES.has(saved))mode=saved;
  schemaReady=true;
  log('SCHEMA_READY',{pending_migration:'110_gm_image_vector_pending.sql',config_migration:'111_gm_image_vector_background_config.sql',mode});
}


function markForegroundActivity(info){
  const now=Date.now();
  foregroundQuietUntil=Math.max(foregroundQuietUntil,now+FOREGROUND_QUIET_MS);
  foregroundEventCount++;
  log('FOREGROUND_PRIORITY',{quiet_ms:FOREGROUND_QUIET_MS,quiet_until:new Date(foregroundQuietUntil).toISOString(),product_uid:S(info&&info.product_uid),mall_code:S(info&&info.mall_code)});
}
function foregroundQuietRemaining(){return Math.max(0,foregroundQuietUntil-Date.now());}

function ensureWorker(){
  if(worker&&worker.connected)return worker;
  const child=fork(path.join(__dirname,'vector_worker.js'),[],{
    stdio:['ignore','inherit','inherit','ipc'],
    env:Object.assign({},process.env,{GM_IMAGE_VECTOR_CHILD:'1'})
  });
  worker=child;
  child.once('spawn',()=>{
    let nice=null;
    try{os.setPriority(child.pid,19);nice=os.getPriority(child.pid);}catch(e){log('LOW_PRIORITY_FAIL',{pid:child.pid,error:S(e&&e.message||e)});}
    log('WORKER_ONLINE',{pid:child.pid||null,runtime:'child_process',nice_priority:nice,policy:'LOWEST_BACKGROUND'});
  });
  child.on('message',msg=>{if(msg&&msg.type==='result')void finish(msg);});
  child.on('error',e=>{lastError=S(e&&e.message||e);log('WORKER_ERROR',{error:lastError});});
  child.on('exit',(code,signal)=>{
    log('WORKER_EXIT',{code,signal:signal||null,inflight:inflight.size});
    if(worker===child)worker=null;
    const now=Date.now();
    for(const rec of inflight.values())failUntil.set(rec.product_uid,now+FAIL_COOLDOWN_MS);
    inflight.clear();
  });
  return worker;
}
function releaseIdleWorker(reason){
  if(worker&&inflight.size===0){
    const w=worker;worker=null;
    try{w.disconnect();}catch(_){ }
    try{w.kill('SIGTERM');}catch(_){ }
    log('WORKER_RELEASE',{reason});
  }
}
async function finish(msg){
  const rec=inflight.get(msg.task_id);if(!rec)return;
  inflight.delete(msg.task_id);
  try{
    if(!msg.ok)throw new Error(S(msg.error)||'VECTOR_WORKER_FAIL');
    const v=Array.isArray(msg.vector)?msg.vector:null;
    if(!v||v.length!==DIM)throw new Error('embedding dimension '+(v&&v.length||0));
    await poolRef.query('INSERT INTO gm_product_image_vector(product_uid,vector_image) VALUES($1,$2::real[]) ON CONFLICT(product_uid) DO UPDATE SET vector_image=EXCLUDED.vector_image',[rec.product_uid,v]);
    const del=await poolRef.query('DELETE FROM gm_image_vector_pending WHERE product_uid=$1 AND image_url=$2 AND updated_at=$3::timestamptz',[rec.product_uid,rec.image_url,rec.updated_at]);
    completed++;failUntil.delete(rec.product_uid);
    log('VECTOR_OK',{product_uid:rec.product_uid,elapsed_ms:Number(msg.elapsed_ms||0),pending_deleted:del.rowCount,active:inflight.size});
  }catch(e){
    failed++;lastError=S(e&&e.message||e);failUntil.set(rec.product_uid,Date.now()+FAIL_COOLDOWN_MS);
    log('VECTOR_FAIL',{product_uid:rec.product_uid,error:lastError,cooldown_ms:FAIL_COOLDOWN_MS,active:inflight.size});
  }
  setImmediate(()=>void pump());
}
async function pickJobs(limit){
  const q=await poolRef.query(`SELECT product_uid,image_url,updated_at FROM gm_image_vector_pending ORDER BY updated_at ASC,product_uid ASC LIMIT $1`,[Math.max(limit,FETCH_WINDOW)]);
  const now=Date.now(),busy=new Set([...inflight.values()].map(x=>x.product_uid));
  return q.rows.filter(r=>{const uid=S(r.product_uid);return uid&&!busy.has(uid)&&((failUntil.get(uid)||0)<=now);}).slice(0,limit);
}
async function pump(){
  if(pumping||!poolRef||!schemaReady)return;
  pumping=true;
  try{
    const mem=memorySnapshot();lastMemory=mem;
    const decision=operatingDecision(mem);
    if(!decision.run){
      if(inflight.size===0)releaseIdleWorker(decision.state);
      return;
    }
    const quietMs=foregroundQuietRemaining();
    if(quietMs>0){
      // Never kill an inference already in progress; just stop taking new work.
      // The child runs at OS nice=19 so foreground/server work preempts its CPU time.
      log('YIELD_FOREGROUND',{mode,state:decision.state,quiet_remaining_ms:quietMs,active:inflight.size,memory_percent:mem.percent});
      return;
    }
    const free=Math.max(0,MAX_SLOTS-inflight.size);
    if(free<=0)return;
    const jobs=await pickJobs(free);
    if(!jobs.length){releaseIdleWorker('NO_PENDING');return;}
    const w=ensureWorker();
    for(const row of jobs){
      const taskId=++seq;
      const rec={task_id:taskId,product_uid:S(row.product_uid),image_url:S(row.image_url),updated_at:new Date(row.updated_at).toISOString()};
      inflight.set(taskId,rec);
      if(!w.connected)throw new Error('VECTOR_CHILD_NOT_CONNECTED');
      w.send({type:'task',...rec});
    }
    log('DISPATCH',{mode,state:decision.state,memory_percent:mem.percent,max_slots:MAX_SLOTS,dispatched:jobs.length,active:inflight.size});
  }catch(e){lastError=S(e&&e.message||e);log('PUMP_FAIL',{error:lastError});}
  finally{pumping=false;}
}
async function setMode(next){
  const m=S(next).toUpperCase();
  if(!VALID_MODES.has(m))throw new Error('INVALID_MODE');
  await poolRef.query('UPDATE gm_image_vector_background_config SET mode=$1,updated_at=now() WHERE config_id=1',[m]);
  mode=m;
  if(mode!=='AUTO')autoRunning=false;
  log('MODE_CHANGE',{mode});
  if(mode==='OFF'&&inflight.size===0)releaseIdleWorker('MODE_OFF');
  setImmediate(()=>void pump());
  return mode;
}
async function statusPayload(){
  const mem=memorySnapshot();lastMemory=mem;
  const decision=operatingDecision(mem);
  let pending=null;
  try{if(poolRef&&schemaReady){const q=await poolRef.query('SELECT COUNT(*)::int AS n FROM gm_image_vector_pending');pending=Number(q.rows[0]&&q.rows[0].n||0);}}catch(e){lastError=S(e&&e.message||e);}
  return {ok:true,version:'GM_IMAGE_VECTOR_BACKGROUND_V008',mode,state:decision.state,running:decision.run,pending,active:inflight.size,max_slots:MAX_SLOTS,memory_percent:mem.percent,memory_used_mb:Math.round(mem.used_bytes/1048576*10)/10,memory_limit_mb:Math.round(mem.total_bytes/1048576*10)/10,memory_source:mem.source,auto_window:'00:00~08:00',auto_start_percent:70,auto_stop_percent:80,inside_auto_window:decision.inside,foreground_quiet:foregroundQuietRemaining()>0,foreground_quiet_remaining_ms:foregroundQuietRemaining(),foreground_quiet_ms:FOREGROUND_QUIET_MS,foreground_event_count:foregroundEventCount,worker_priority:'nice 19 (lowest)',completed,failed,last_error:lastError||null};
}
function init(pool){
  if(poolRef)return;
  poolRef=pool;
  process.on('gm:special-product-upsert',markForegroundActivity);
  void ensureSchema().then(()=>{
    timer=setInterval(()=>void pump(),TICK_MS);if(timer&&typeof timer.unref==='function')timer.unref();
    setTimeout(()=>void pump(),Math.min(5000,TICK_MS));
    log('INIT',{tick_ms:TICK_MS,max_slots:MAX_SLOTS,mode,auto_window:'00:00~08:00',start_percent:70,stop_percent:80,foreground_quiet_ms:FOREGROUND_QUIET_MS,worker_priority:'nice 19'});
  }).catch(e=>{
    lastError=S(e&&e.message||e);log('SCHEMA_FAIL',{error:lastError});
    const retry=setInterval(()=>{void ensureSchema().then(()=>{clearInterval(retry);if(!timer){timer=setInterval(()=>void pump(),TICK_MS);if(timer&&typeof timer.unref==='function')timer.unref();}void pump();}).catch(err=>{lastError=S(err&&err.message||err);log('SCHEMA_RETRY_FAIL',{error:lastError});});},30000);
    if(retry&&typeof retry.unref==='function')retry.unref();
  });
}
router.get('/api/gm/background/image-vector/status',async(req,res)=>{
  try{res.json(await statusPayload());}catch(e){res.status(500).json({ok:false,error:S(e&&e.message||e)});}
});
router.post('/api/gm/background/image-vector/mode',express.json(),async(req,res)=>{
  if(!poolRef||!schemaReady)return res.status(503).json({ok:false,error:'BACKGROUND_NOT_READY'});
  try{await setMode(req.body&&req.body.mode);res.json(await statusPayload());}catch(e){res.status(e&&e.message==='INVALID_MODE'?400:500).json({ok:false,error:S(e&&e.message||e)});}
});

router.post('/api/gm/background/image-vector/pending/import',express.text({type:['text/*','application/csv'],limit:'30mb'}),async(req,res)=>{
  if(!poolRef||!schemaReady)return res.status(503).json({ok:false,error:'BACKGROUND_NOT_READY'});
  try{
    const rows=parseCsv(req.body||'');
    const dedup=new Map();
    let invalid=0;
    for(const row of rows){
      const uid=S(row.product_uid),url=S(row.image_url||row.thumb_origin_url),raw=S(row.updated_at);
      if(!uid||!url){invalid++;continue;}
      let updatedAt=raw;
      if(!updatedAt||!Number.isFinite(Date.parse(updatedAt)))updatedAt=new Date().toISOString();
      else updatedAt=new Date(updatedAt).toISOString();
      dedup.set(uid,{product_uid:uid,image_url:url,updated_at:updatedAt});
    }
    const list=[...dedup.values()];
    if(!list.length)return res.status(400).json({ok:false,error:'NO_VALID_ROWS',received:rows.length,invalid});
    let upserted=0;
    const batchSize=500;
    const client=await poolRef.connect();
    try{
      await client.query('BEGIN');
      for(let i=0;i<list.length;i+=batchSize){
        const part=list.slice(i,i+batchSize);
        const uids=part.map(x=>x.product_uid),urls=part.map(x=>x.image_url),dates=part.map(x=>x.updated_at);
        const q=await client.query(`
          INSERT INTO gm_image_vector_pending(product_uid,image_url,updated_at)
          SELECT * FROM UNNEST($1::text[],$2::text[],$3::timestamptz[])
          ON CONFLICT(product_uid) DO UPDATE
            SET image_url=EXCLUDED.image_url,
                updated_at=EXCLUDED.updated_at
          WHERE EXCLUDED.updated_at >= gm_image_vector_pending.updated_at
        `,[uids,urls,dates]);
        upserted+=q.rowCount;
      }
      await client.query('COMMIT');
    }catch(e){
      try{await client.query('ROLLBACK');}catch(_){ }
      throw e;
    }finally{client.release();}
    const count=await poolRef.query('SELECT COUNT(*)::int AS n FROM gm_image_vector_pending');
    const pending=Number(count.rows[0]&&count.rows[0].n||0);
    log('PENDING_IMPORT',{received:rows.length,valid:list.length,invalid,upserted,pending});
    res.json({ok:true,version:'GM_IMAGE_VECTOR_BACKGROUND_V008',received:rows.length,valid:list.length,invalid,upserted,pending});
    setImmediate(()=>void pump());
  }catch(e){
    lastError=S(e&&e.message||e);log('PENDING_IMPORT_FAIL',{error:lastError});
    res.status(500).json({ok:false,error:lastError});
  }
});
function shutdown(){
  process.removeListener('gm:special-product-upsert',markForegroundActivity);
  if(timer){clearInterval(timer);timer=null;}
  if(worker){try{worker.disconnect();}catch(_){ }try{worker.kill('SIGTERM');}catch(_){ }worker=null;}
}
module.exports={router,init,shutdown};
