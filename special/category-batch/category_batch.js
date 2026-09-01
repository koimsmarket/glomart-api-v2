'use strict';
/* GM_CATEGORY_BATCH_SPECIAL_V018
 * Special one-off category/vector preload module.
 * Existing search/vector routes are not modified.
 */
const express=require('express');
const path=require('path');
const {Worker}=require('worker_threads');
const router=express.Router();
const ADMIN_IDS=new Set(['derzon','derzon1287','msoon']);
const DIM=512;
const control={mode:'STOPPED',batch_date:'',updated_at:null,updated_by:'',command:''};
const leases=new Map();
const serverQueue=[];
const serverQueued=new Set();
const serverFailUntil=new Map();
let serverWorkers=0, serverConcurrency=15, poolRef=null;
let vectorThread=null, vectorTaskSeq=0;
const vectorInflight=new Map();
const S=v=>String(v==null?'':v).trim();
const N=(v,d)=>Number.isFinite(Number(v))?Number(v):d;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function pool(req){const p=req.app&&req.app.locals&&req.app.locals.pool;if(!p)throw new Error('DB_POOL_NOT_AVAILABLE');poolRef=p;return p;}
function auth(req,res){const m=S((req.body&&req.body.member_id)||(req.query&&req.query.member_id));if(!ADMIN_IDS.has(m)){res.status(403).json({ok:false,error:'ADMIN_ID_REQUIRED'});return null;}return m;}
function log(tag,o){console.log('[GM_CATEGORY_BATCH_SPECIAL_V018 '+tag+']',JSON.stringify(Object.assign({ts:new Date().toISOString()},o||{})));}
function splitKeywords(v){return [...new Set(S(v).split('/').map(x=>x.trim()).filter(Boolean))];}
function batchDate(v){const x=S(v);return /^\d{4}-\d{2}-\d{2}$/.test(x)?x:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function vectorValid(alias='v'){return `${alias}.vector_image IS NOT NULL AND array_length(${alias}.vector_image,1)=${DIM}`;}
function prioritySql(){return `CASE WHEN gm_code LIKE 'FD-%' THEN 1 WHEN gm_code LIKE 'HS-%' THEN 2 ELSE 3 END`;}

router.get('/api/special/category-batch/control',(req,res)=>{const m=auth(req,res);if(!m)return;res.json({ok:true,version:'GM_CATEGORY_BATCH_SPECIAL_V018',control});});
router.get('/api/special/category-batch/concurrency',(req,res)=>{const m=auth(req,res);if(!m)return;res.json({ok:true,concurrency:serverConcurrency,active:serverWorkers,queued:serverQueue.length});});
router.post('/api/special/category-batch/concurrency',(req,res)=>{const m=auth(req,res);if(!m)return;serverConcurrency=clamp(Math.round(N(req.body&&req.body.concurrency,serverConcurrency)),1,32);log('SERVER_CONCURRENCY',{member:m,concurrency:serverConcurrency,active:serverWorkers,queued:serverQueue.length});pumpServerWorkers();res.json({ok:true,concurrency:serverConcurrency,active:serverWorkers,queued:serverQueue.length});});
router.post('/api/special/category-batch/command',(req,res)=>{const m=auth(req,res);if(!m)return;pool(req);const cmd=S(req.body&&req.body.command);if(cmd==='#카테고리 검색#')control.mode='RUN';else if(cmd==='#카테고리 일시정지#')control.mode='PAUSE';else if(cmd==='#카테고리 중지#')control.mode='STOPPED';else return res.status(400).json({ok:false,error:'UNKNOWN_COMMAND'});if(cmd==='#카테고리 검색#')control.batch_date=batchDate(req.body&&req.body.batch_date||control.batch_date);control.updated_at=new Date().toISOString();control.updated_by=m;control.command=cmd;log('COMMAND',{member:m,mode:control.mode,batch_date:control.batch_date});res.json({ok:true,control});});

async function release(deviceId,complete){const l=leases.get(deviceId);if(!l)return null;try{if(complete)await l.client.query('UPDATE gm_category SET created_at=NOW(),updated_at=NOW() WHERE category_id=$1',[l.category_id]);await l.client.query('SELECT pg_advisory_unlock($1::bigint)',[l.category_id]);}finally{l.client.release();leases.delete(deviceId);}return l.category_id;}
router.post('/api/special/category-batch/next',async(req,res)=>{const m=auth(req,res);if(!m)return;const p=pool(req),deviceId=S(req.body&&req.body.device_id),bd=batchDate(req.body&&req.body.batch_date||control.batch_date);if(!deviceId)return res.status(400).json({ok:false,error:'device_id required'});if(control.mode!=='RUN')return res.json({ok:true,state:control.mode,category:null,batch_date:bd});if(leases.has(deviceId)){const l=leases.get(deviceId),q=await l.client.query("SELECT category_id,gm_code,name_ko,leaf_yn,created_at FROM gm_category WHERE category_id=$1 AND UPPER(COALESCE(leaf_yn,''))='Y'",[l.category_id]);const r=q.rows[0];return res.json({ok:true,state:'LEASED',batch_date:bd,category:r?Object.assign(r,{keywords:splitKeywords(r.name_ko)}):null});}
 const q=await p.query(`SELECT category_id,gm_code,name_ko,leaf_yn,depth,sort_order,created_at FROM gm_category WHERE COALESCE(name_ko,'')<>'' AND UPPER(COALESCE(leaf_yn,''))='Y' AND (created_at IS NULL OR created_at < $1::date) ORDER BY ${prioritySql()} ASC, depth ASC, sort_order ASC, category_id ASC LIMIT 120`,[bd]);
 for(const row of q.rows){const c=await p.connect();let keep=false;try{const lk=await c.query('SELECT pg_try_advisory_lock($1::bigint) ok',[row.category_id]);if(lk.rows[0]&&lk.rows[0].ok){const chk=await c.query("SELECT category_id,gm_code,name_ko,leaf_yn,created_at FROM gm_category WHERE category_id=$1 AND UPPER(COALESCE(leaf_yn,''))='Y' AND (created_at IS NULL OR created_at < $2::date)",[row.category_id,bd]);if(chk.rows[0]){leases.set(deviceId,{category_id:row.category_id,client:c,member_id:m,leased_at:Date.now(),batch_date:bd});keep=true;log('LEASE',{device_id:deviceId,category_id:row.category_id,gm_code:row.gm_code,name_ko:row.name_ko,leaf_yn:row.leaf_yn,batch_date:bd});return res.json({ok:true,state:'LEASED',batch_date:bd,category:Object.assign(chk.rows[0],{keywords:splitKeywords(chk.rows[0].name_ko)})});}await c.query('SELECT pg_advisory_unlock($1::bigint)',[row.category_id]);}}finally{if(!keep)c.release();}}
 res.json({ok:true,state:'EMPTY',category:null,batch_date:bd});
});
router.post('/api/special/category-batch/complete',async(req,res)=>{const m=auth(req,res);if(!m)return;pool(req);const d=S(req.body&&req.body.device_id),id=Number(req.body&&req.body.category_id||0),l=leases.get(d);if(!l||Number(l.category_id)!==id)return res.status(409).json({ok:false,error:'LEASE_MISMATCH'});await release(d,true);log('CATEGORY_DONE',{device_id:d,category_id:id});res.json({ok:true,category_id:id});});
router.post('/api/special/category-batch/release',async(req,res)=>{const m=auth(req,res);if(!m)return;pool(req);const d=S(req.body&&req.body.device_id),id=await release(d,false);res.json({ok:true,category_id:id});});

router.get('/api/special/category-batch/search-state',async(req,res)=>{const m=auth(req,res);if(!m)return;const p=pool(req),kw=S(req.query.keyword),st=S(req.query.started_at),rid=S(req.query.request_id);if(!st||(!kw&&!rid))return res.status(400).json({ok:false,error:'started_at and keyword/request_id required'});let q;if(rid){q=await p.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE status='pending')::int pending,COUNT(*) FILTER(WHERE status='processing')::int processing,COUNT(*) FILTER(WHERE status='done')::int done,COUNT(*) FILTER(WHERE status='failed')::int failed,COUNT(DISTINCT mall_code)::int mall_count,ARRAY_REMOVE(ARRAY_AGG(DISTINCT keyword),NULL) keywords,MAX(created_at) last_created_at FROM gm_product_upsert_queue WHERE request_id LIKE $1 AND created_at >= $2::timestamptz`,[rid+'%',st]);}else{q=await p.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE status='pending')::int pending,COUNT(*) FILTER(WHERE status='processing')::int processing,COUNT(*) FILTER(WHERE status='done')::int done,COUNT(*) FILTER(WHERE status='failed')::int failed,COUNT(DISTINCT mall_code)::int mall_count,ARRAY_REMOVE(ARRAY_AGG(DISTINCT keyword),NULL) keywords,MAX(created_at) last_created_at FROM gm_product_upsert_queue WHERE keyword=$1 AND created_at >= $2::timestamptz`,[kw,st]);}const x=q.rows[0]||{},last=x.last_created_at?new Date(x.last_created_at).getTime():0,quiet=last?Math.max(0,(Date.now()-last)/1000):0,settled=Number(x.total||0)>0&&Number(x.pending||0)===0&&Number(x.processing||0)===0&&quiet>=5;res.json({ok:true,total:+x.total||0,pending:+x.pending||0,processing:+x.processing||0,done:+x.done||0,failed:+x.failed||0,mall_count:+x.mall_count||0,keywords:x.keywords||[],quiet_sec:Math.round(quiet*10)/10,settled});});

function enqueue(sourceId,items){
 const now=Date.now();let added=0;
 for(const item of items){
  if(!item.product_uid||!item.image_url||serverQueued.has(item.product_uid))continue;
  if((serverFailUntil.get(item.product_uid)||0)>now)continue;
  serverQueued.add(item.product_uid);serverQueue.push({cycle_id:sourceId||'UPSERT',item,retry:0});added++;
 }
 pumpServerWorkers();return added;
}
/* V018: product.js event is only a lightweight handoff. Heavy image/AI work runs in a Worker thread. */
function onProductUpsert(x){
 if(control.mode!=='RUN'||!x)return;
 const item={product_uid:S(x.product_uid),mall_code:S(x.mall_code),image_url:S(x.image_url)};
 if(!item.product_uid||!item.image_url)return;
 const added=enqueue('UPSERT',[item]);
 if(added)log('UPSERT_VECTOR_ENQUEUE',{product_uid:item.product_uid,mall_code:item.mall_code,keyword:S(x.keyword),queue:serverQueue.length,workers:serverWorkers,concurrency:serverConcurrency});
}
process.on('gm:special-product-upsert',onProductUpsert);
router.get('/api/special/category-batch/vector-status',(req,res)=>{const m=auth(req,res);if(!m)return;res.json({ok:true,server_only:true,queued:serverQueue.length,active:serverWorkers,concurrency:serverConcurrency});});

function ensureVectorThread(){
 if(vectorThread)return vectorThread;
 const workerPath=path.join(__dirname,'vector_worker.js');
 const w=new Worker(workerPath);
 vectorThread=w;
 w.on('online',()=>{log('VECTOR_THREAD_ONLINE',{concurrency:serverConcurrency});try{w.postMessage({type:'config',concurrency:serverConcurrency});}catch(_){} });
 w.on('message',msg=>{if(!msg||msg.type!=='result')return;void finishVectorTask(msg);});
 w.on('error',e=>{log('VECTOR_THREAD_ERROR',{error:S(e&&e.message||e)});});
 w.on('exit',code=>{
   log('VECTOR_THREAD_EXIT',{code,inflight:vectorInflight.size});
   vectorThread=null;
   const pending=[...vectorInflight.values()].map(x=>x.job);vectorInflight.clear();serverWorkers=Math.max(0,serverWorkers-pending.length);
   for(const j of pending)retryOrFail(j,new Error('VECTOR_THREAD_EXIT_'+code));
   if(serverQueue.length)setTimeout(pumpServerWorkers,100);
 });
 return w;
}
function retryOrFail(j,e){
 if(j.retry<2){j.retry++;serverQueue.push(j);}else{serverQueued.delete(j.item.product_uid);serverFailUntil.set(j.item.product_uid,Date.now()+60000);}
 log('SERVER_VECTOR_FAIL',{cycle_id:j.cycle_id,product_uid:j.item.product_uid,retry:j.retry,error:S(e&&e.message||e),workers:serverWorkers,concurrency:serverConcurrency});
}
function markVectorOk(j,elapsedMs){
 serverQueued.delete(j.item.product_uid);
 log('SERVER_VECTOR_OK',{cycle_id:j.cycle_id,product_uid:j.item.product_uid,elapsed_ms:elapsedMs,queue_left:serverQueue.length,workers:serverWorkers,concurrency:serverConcurrency});
}
async function finishVectorTask(msg){
 const rec=vectorInflight.get(msg.task_id);if(!rec)return;
 vectorInflight.delete(msg.task_id);const j=rec.job;
 try{
   if(!msg.ok)throw new Error(S(msg.error)||'VECTOR_WORKER_FAIL');
   const v=Array.isArray(msg.vector)?msg.vector:null;
   if(!v||v.length!==DIM)throw new Error('embedding dimension '+(v&&v.length||0));
   await poolRef.query('INSERT INTO gm_product_image_vector(product_uid,vector_image) VALUES($1,$2::real[]) ON CONFLICT(product_uid) DO UPDATE SET vector_image=EXCLUDED.vector_image',[j.item.product_uid,v]);
   markVectorOk(j,Date.now()-rec.started_at);
 }catch(e){retryOrFail(j,e);}
 finally{serverWorkers=Math.max(0,serverWorkers-1);pumpServerWorkers();}
}
async function dispatchVectorJob(j){
 serverWorkers++;const started=Date.now();
 try{
   const ex=await poolRef.query(`SELECT 1 FROM gm_product_image_vector WHERE product_uid=$1 AND ${vectorValid('gm_product_image_vector')} LIMIT 1`,[j.item.product_uid]);
   if(ex.rowCount){markVectorOk(j,Date.now()-started);serverWorkers--;pumpServerWorkers();return;}
   const taskId=++vectorTaskSeq;
   vectorInflight.set(taskId,{job:j,started_at:started});
   const w=ensureVectorThread();
   w.postMessage({type:'task',task_id:taskId,product_uid:j.item.product_uid,image_url:j.item.image_url});
 }catch(e){serverWorkers=Math.max(0,serverWorkers-1);retryOrFail(j,e);pumpServerWorkers();}
}
function pumpServerWorkers(){
 while(serverQueue.length&&serverWorkers<serverConcurrency){const j=serverQueue.shift();void dispatchVectorJob(j);}
 if(vectorThread){try{vectorThread.postMessage({type:'config',concurrency:serverConcurrency});}catch(_){} }
}
module.exports=router;
