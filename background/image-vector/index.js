'use strict';
/* GM_IMAGE_VECTOR_BACKGROUND_V004
 * Image-vector processing is completely detached from SPECIAL/category search.
 *
 * Persistent work source: gm_image_vector_pending
 *   row exists  = work remains
 *   vector UPSERT succeeds = delete exactly the processed UID+URL+updated_at row
 *
 * Operating mode (persisted in gm_image_vector_background_config):
 *   OFF  = never start new vector jobs
 *   AUTO = 00:00~08:00 Asia/Seoul only. Start at RSS <= 70%, stop at RSS >= 80%.
 *          70~80% is hysteresis: keep the current run/stop state.
 *   ON   = force run regardless of time and memory.
 *
 * Memory percentage is process RSS / container memory limit. Worker-thread/model
 * memory belongs to this Node process and is included in RSS.
 */
const express=require('express');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {Worker}=require('worker_threads');
const router=express.Router();
const {parseCsv}=require('../../routes/builder/core');
const DIM=512;
const TICK_MS=Math.max(2000,Number(process.env.GM_IMAGE_VECTOR_TICK_MS||5000));
const MAX_SLOTS=Math.max(1,Math.min(8,Number(process.env.GM_IMAGE_VECTOR_MAX_SLOTS||4)));
const FETCH_WINDOW=Math.max(8,Math.min(100,Number(process.env.GM_IMAGE_VECTOR_FETCH_WINDOW||30)));
const FAIL_COOLDOWN_MS=Math.max(60000,Number(process.env.GM_IMAGE_VECTOR_FAIL_COOLDOWN_MS||600000));
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
const S=v=>String(v==null?'':v).trim();
function log(tag,o){console.log('[GM_IMAGE_VECTOR_BACKGROUND_V004 '+tag+']',JSON.stringify(Object.assign({ts:new Date().toISOString()},o||{})));}
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
function memorySnapshot(){
  const rss=Number(process.memoryUsage().rss||0);
  const limit=containerLimit();
  const ratio=limit>0?rss/limit:1;
  return {used_bytes:rss,total_bytes:limit,ratio,percent:Math.round(ratio*1000)/10,source:'process_rss/container_limit'};
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
  const c=await poolRef.connect();
  try{
    await c.query('BEGIN');
    await c.query("SELECT pg_advisory_xact_lock(hashtext('gm_image_vector_background_schema_v2'))");
    const existed=await c.query("SELECT to_regclass('public.gm_image_vector_pending') IS NOT NULL AS existed");
    const wasThere=!!(existed.rows[0]&&existed.rows[0].existed);
    await c.query(`
      CREATE TABLE IF NOT EXISTS gm_image_vector_pending (
        product_uid TEXT PRIMARY KEY,
        image_url TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await c.query('CREATE INDEX IF NOT EXISTS idx_gm_image_vector_pending_updated_at ON gm_image_vector_pending(updated_at ASC)');
    await c.query(`
      CREATE TABLE IF NOT EXISTS gm_image_vector_background_config (
        config_id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (config_id=1),
        mode TEXT NOT NULL DEFAULT 'AUTO' CHECK (mode IN ('OFF','AUTO','ON')),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await c.query("INSERT INTO gm_image_vector_background_config(config_id,mode) VALUES(1,'AUTO') ON CONFLICT(config_id) DO NOTHING");
    await c.query(`
      CREATE OR REPLACE FUNCTION gm_enqueue_image_vector_pending()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF COALESCE(BTRIM(NEW.thumb_origin_url), '') = '' THEN RETURN NEW; END IF;
        IF TG_OP = 'INSERT' OR OLD.thumb_origin_url IS DISTINCT FROM NEW.thumb_origin_url THEN
          INSERT INTO gm_image_vector_pending(product_uid,image_url,updated_at)
          VALUES(NEW.product_uid,NEW.thumb_origin_url,now())
          ON CONFLICT(product_uid) DO UPDATE SET image_url=EXCLUDED.image_url,updated_at=EXCLUDED.updated_at;
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await c.query('DROP TRIGGER IF EXISTS trg_gm_product_image_vector_pending ON gm_product');
    await c.query(`
      CREATE TRIGGER trg_gm_product_image_vector_pending
      AFTER INSERT OR UPDATE OF thumb_origin_url ON gm_product
      FOR EACH ROW EXECUTE FUNCTION gm_enqueue_image_vector_pending()
    `);
    if(!wasThere){
      const seed=await c.query(`
        INSERT INTO gm_image_vector_pending(product_uid,image_url,updated_at)
        SELECT p.product_uid,p.thumb_origin_url,COALESCE(p.updated_at,p.created_at,now())
          FROM gm_product p
          LEFT JOIN gm_product_image_vector v ON v.product_uid=p.product_uid
         WHERE COALESCE(BTRIM(p.thumb_origin_url),'')<>''
           AND (v.product_uid IS NULL OR v.vector_image IS NULL OR array_length(v.vector_image,1)<>${DIM})
        ON CONFLICT(product_uid) DO UPDATE SET image_url=EXCLUDED.image_url,updated_at=EXCLUDED.updated_at
      `);
      log('INITIAL_SEED',{rows:seed.rowCount});
    }
    const cfg=await c.query('SELECT mode FROM gm_image_vector_background_config WHERE config_id=1');
    const saved=S(cfg.rows[0]&&cfg.rows[0].mode).toUpperCase();
    if(VALID_MODES.has(saved))mode=saved;
    await c.query('COMMIT');
    schemaReady=true;
    log('SCHEMA_READY',{pending_migration:'110_gm_image_vector_pending.sql',config_migration:'111_gm_image_vector_background_config.sql',preexisting_pending:wasThere,mode});
  }catch(e){
    try{await c.query('ROLLBACK');}catch(_){ }
    throw e;
  }finally{c.release();}
}
function ensureWorker(){
  if(worker)return worker;
  worker=new Worker(path.join(__dirname,'vector_worker.js'));
  worker.on('online',()=>log('WORKER_ONLINE',{}));
  worker.on('message',msg=>{if(msg&&msg.type==='result')void finish(msg);});
  worker.on('error',e=>{lastError=S(e&&e.message||e);log('WORKER_ERROR',{error:lastError});});
  worker.on('exit',code=>{
    log('WORKER_EXIT',{code,inflight:inflight.size});
    worker=null;
    const now=Date.now();
    for(const rec of inflight.values())failUntil.set(rec.product_uid,now+FAIL_COOLDOWN_MS);
    inflight.clear();
  });
  return worker;
}
function releaseIdleWorker(reason){
  if(worker&&inflight.size===0){
    const w=worker;worker=null;
    try{void w.terminate();}catch(_){ }
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
    const free=Math.max(0,MAX_SLOTS-inflight.size);
    if(free<=0)return;
    const jobs=await pickJobs(free);
    if(!jobs.length){releaseIdleWorker('NO_PENDING');return;}
    const w=ensureWorker();
    for(const row of jobs){
      const taskId=++seq;
      const rec={task_id:taskId,product_uid:S(row.product_uid),image_url:S(row.image_url),updated_at:new Date(row.updated_at).toISOString()};
      inflight.set(taskId,rec);
      w.postMessage({type:'task',...rec});
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
  return {ok:true,version:'GM_IMAGE_VECTOR_BACKGROUND_V004',mode,state:decision.state,running:decision.run,pending,active:inflight.size,max_slots:MAX_SLOTS,memory_percent:mem.percent,memory_used_mb:Math.round(mem.used_bytes/1048576*10)/10,memory_limit_mb:Math.round(mem.total_bytes/1048576*10)/10,memory_source:mem.source,auto_window:'00:00~08:00',auto_start_percent:70,auto_stop_percent:80,inside_auto_window:decision.inside,completed,failed,last_error:lastError||null};
}
function init(pool){
  if(poolRef)return;
  poolRef=pool;
  void ensureSchema().then(()=>{
    timer=setInterval(()=>void pump(),TICK_MS);if(timer&&typeof timer.unref==='function')timer.unref();
    setTimeout(()=>void pump(),Math.min(5000,TICK_MS));
    log('INIT',{tick_ms:TICK_MS,max_slots:MAX_SLOTS,mode,auto_window:'00:00~08:00',start_percent:70,stop_percent:80});
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
    res.json({ok:true,version:'GM_IMAGE_VECTOR_BACKGROUND_V004',received:rows.length,valid:list.length,invalid,upserted,pending});
    setImmediate(()=>void pump());
  }catch(e){
    lastError=S(e&&e.message||e);log('PENDING_IMPORT_FAIL',{error:lastError});
    res.status(500).json({ok:false,error:lastError});
  }
});
function shutdown(){
  if(timer){clearInterval(timer);timer=null;}
  if(worker){try{worker.terminate();}catch(_){ }worker=null;}
}
module.exports={router,init,shutdown};
