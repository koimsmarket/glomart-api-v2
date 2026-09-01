'use strict';
/* GM_CATEGORY_BATCH_SPECIAL_V014
 * Special one-off category/vector preload module.
 * Existing search/vector routes are not modified.
 */
const express=require('express');
const router=express.Router();
const ADMIN_IDS=new Set(['derzon','derzon1287','msoon']);
const DIM=512;
const VECTOR_CHUNK=250;
const CYCLE_TTL_MS=2*60*1000;
const control={mode:'STOPPED',batch_date:'',updated_at:null,updated_by:'',command:''};
const leases=new Map();
const cycles=new Map();
const serverQueue=[];
const serverQueued=new Set();
let serverWorkers=0, serverConcurrency=10, modelPromise=null, poolRef=null, seq=0;
const S=v=>String(v==null?'':v).trim();
const N=(v,d)=>Number.isFinite(Number(v))?Number(v):d;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function pool(req){const p=req.app&&req.app.locals&&req.app.locals.pool;if(!p)throw new Error('DB_POOL_NOT_AVAILABLE');poolRef=p;return p;}
function auth(req,res){const m=S((req.body&&req.body.member_id)||(req.query&&req.query.member_id));if(!ADMIN_IDS.has(m)){res.status(403).json({ok:false,error:'ADMIN_ID_REQUIRED'});return null;}return m;}
function log(tag,o){console.log('[GM_CATEGORY_BATCH_SPECIAL_V014 '+tag+']',JSON.stringify(Object.assign({ts:new Date().toISOString()},o||{})));}
function splitKeywords(v){return [...new Set(S(v).split('/').map(x=>x.trim()).filter(Boolean))];}
function batchDate(v){const x=S(v);return /^\d{4}-\d{2}-\d{2}$/.test(x)?x:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function vectorValid(alias='v'){return `${alias}.vector_image IS NOT NULL AND array_length(${alias}.vector_image,1)=${DIM}`;}
function prioritySql(){return `CASE WHEN gm_code LIKE 'FD-%' THEN 1 WHEN gm_code LIKE 'HS-%' THEN 2 ELSE 3 END`;}

router.get('/api/special/category-batch/control',(req,res)=>{const m=auth(req,res);if(!m)return;res.json({ok:true,version:'GM_CATEGORY_BATCH_SPECIAL_V014',control});});
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

function cleanupCycles(){const now=Date.now();for(const [id,c] of cycles){if(c.finished_at&&now-c.finished_at>CYCLE_TTL_MS)cycles.delete(id);}}
async function searchKeywords(p,kw,st,rid){if(rid){const r=await p.query(`SELECT ARRAY_REMOVE(ARRAY_AGG(DISTINCT keyword),NULL) keywords FROM gm_product_upsert_queue WHERE request_id LIKE $1 AND created_at >= $2::timestamptz`,[rid+'%',st]);const a=(r.rows[0]&&r.rows[0].keywords||[]).map(S).filter(Boolean);if(a.length)return a;}return kw?[kw]:[];}
async function cycleItems(p,kw,st,rid){const kws=await searchKeywords(p,kw,st,rid);if(!kws.length)return {total:0,items:[],keywords:[]};const q=await p.query(`SELECT p.product_uid,p.mall_code,p.thumb_origin_url image_url,COUNT(*) OVER()::int total_missing FROM gm_product p LEFT JOIN gm_product_image_vector v ON v.product_uid=p.product_uid WHERE p.keyword=ANY($1::text[]) AND COALESCE(p.updated_at,p.created_at)>=($2::timestamptz-interval '2 minutes') AND COALESCE(p.thumb_origin_url,'')<>'' AND NOT (${vectorValid('v')}) ORDER BY COALESCE(p.updated_at,p.created_at),p.product_uid LIMIT ${VECTOR_CHUNK}`,[kws,st]);const total=q.rows.length?Number(q.rows[0].total_missing||0):0;return {total,keywords:kws,items:q.rows.map(r=>({product_uid:S(r.product_uid),mall_code:S(r.mall_code),image_url:S(r.image_url)}))};}
function enqueue(cycleId,items){for(const item of items){if(!item.product_uid||serverQueued.has(item.product_uid))continue;serverQueued.add(item.product_uid);serverQueue.push({cycle_id:cycleId,item,retry:0});}pumpServerWorkers();}
router.post('/api/special/category-batch/vector-cycle',async(req,res)=>{const m=auth(req,res);if(!m)return;const p=pool(req),kw=S(req.body&&req.body.keyword),st=S(req.body&&req.body.started_at),rid=S(req.body&&req.body.request_id),dev=S(req.body&&req.body.device_id),ratio=clamp(Math.round(N(req.body&&req.body.server_ratio,70)),0,100);if(!kw||!st||!dev)return res.status(400).json({ok:false,error:'keyword/started_at/device_id required'});cleanupCycles();const found=await cycleItems(p,kw,st,rid),items=found.items,cnt=Math.min(items.length,Math.round(items.length*ratio/100)),sv=items.slice(0,cnt),ph=items.slice(cnt),id=`C${Date.now()}_${++seq}`;const byId=new Map(items.map(x=>[x.product_uid,x]));cycles.set(id,{cycle_id:id,keyword:kw,search_keywords:found.keywords||[kw],request_id:rid,started_at:st,all_ids:items.map(x=>x.product_uid),server_ids:sv.map(x=>x.product_uid),phone_ids:ph.map(x=>x.product_uid),by_id:byId,failed_ids:new Set(),finished_at:0});enqueue(id,sv);log('VECTOR_SPLIT',{cycle_id:id,chunk_total:items.length,keyword_remaining:found.total,server:sv.length,phone:ph.length,ratio});res.json({ok:true,cycle_id:id,total:items.length,keyword_remaining:found.total,server_count:sv.length,phone_count:ph.length,phone_tasks:ph});});
router.get('/api/special/category-batch/vector-status',async(req,res)=>{const m=auth(req,res);if(!m)return;const p=pool(req),id=S(req.query.cycle_id),c=cycles.get(id);if(!c)return res.status(404).json({ok:false,error:'CYCLE_NOT_FOUND'});const q=c.all_ids.length?await p.query(`SELECT product_uid FROM gm_product_image_vector WHERE product_uid=ANY($1::text[]) AND ${vectorValid('gm_product_image_vector')}`,[c.all_ids]):{rows:[]},done=new Set(q.rows.map(r=>S(r.product_uid))),sd=c.server_ids.filter(x=>done.has(x)).length,pd=c.phone_ids.filter(x=>done.has(x)).length,remaining=c.all_ids.length-done.size;const mq=await p.query(`SELECT COUNT(*)::int n FROM gm_product p LEFT JOIN gm_product_image_vector v ON v.product_uid=p.product_uid WHERE p.keyword=ANY($1::text[]) AND COALESCE(p.updated_at,p.created_at)>=($2::timestamptz-interval '2 minutes') AND COALESCE(p.thumb_origin_url,'')<>'' AND NOT (${vectorValid('v')})`,[(c.search_keywords&&c.search_keywords.length)?c.search_keywords:[c.keyword],c.started_at]);const keywordRemaining=Number(mq.rows[0]&&mq.rows[0].n||0);const fallback=[];for(const uid of c.failed_ids){if(!done.has(uid)){const item=c.by_id.get(uid);if(item)fallback.push(item);}}if(remaining===0)c.finished_at=c.finished_at||Date.now();res.json({ok:true,cycle_id:id,total:c.all_ids.length,remaining,keyword_remaining:keywordRemaining,server_total:c.server_ids.length,server_done:sd,phone_total:c.phone_ids.length,phone_done:pd,server_failed:fallback.length,fallback_phone_tasks:fallback,server_queue:serverQueue.length,server_running:serverWorkers>0,server_workers_active:serverWorkers,server_concurrency:serverConcurrency});});

async function loadModel(){
 if(modelPromise)return modelPromise;
 modelPromise=(async()=>{
  const cacheDir=process.env.GM_HF_CACHE_DIR||'/tmp/glomart-hf-cache';
  process.env.HF_HOME=process.env.HF_HOME||cacheDir;
  process.env.TRANSFORMERS_CACHE=process.env.TRANSFORMERS_CACHE||cacheDir;
  log('SERVER_AI_LOAD_START',{model:'Xenova/mobileclip_s0',cache_dir:cacheDir});
  const T=await import('@huggingface/transformers');
  if(T.env){T.env.cacheDir=cacheDir;T.env.useBrowserCache=false;}
  const processor=await T.AutoProcessor.from_pretrained('Xenova/mobileclip_s0');
  const Model=T.CLIPVisionModelWithProjection||T.AutoModel;
  const model=await Model.from_pretrained('Xenova/mobileclip_s0',{quantized:true,device:'cpu'});
  log('SERVER_AI_READY',{dim:DIM,cache_dir:cacheDir});return {T,processor,model};
 })().catch(e=>{modelPromise=null;log('SERVER_AI_LOAD_FAIL',{error:S(e&&e.message||e)});throw e;});
 return modelPromise;
}
async function infer(url){const A=await loadModel(),r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'image/*,*/*;q=0.8'},redirect:'follow'});if(!r.ok)throw new Error('image HTTP '+r.status);const blob=await r.blob(),raw=await A.T.RawImage.fromBlob(blob),inputs=await A.processor(raw),o=await A.model(inputs),t=o.image_embeds||o.image_embedding||o.pooler_output;if(!t||!t.data||t.data.length!==DIM)throw new Error('embedding dimension '+(t&&t.data&&t.data.length||0));const v=new Array(DIM);let n=0;for(let i=0;i<DIM;i++){const x=Number(t.data[i])||0;v[i]=x;n+=x*x;}n=Math.sqrt(n)||1;for(let i=0;i<DIM;i++)v[i]/=n;return v;}
async function serverWorker(){
 serverWorkers++;
 try{
  while(serverQueue.length){
   const j=serverQueue.shift(),t=Date.now();
   try{
    const ex=await poolRef.query(`SELECT 1 FROM gm_product_image_vector WHERE product_uid=$1 AND ${vectorValid('gm_product_image_vector')} LIMIT 1`,[j.item.product_uid]);
    if(!ex.rowCount){const v=await infer(j.item.image_url);await poolRef.query('INSERT INTO gm_product_image_vector(product_uid,vector_image) VALUES($1,$2::real[]) ON CONFLICT(product_uid) DO UPDATE SET vector_image=EXCLUDED.vector_image',[j.item.product_uid,v]);}
    serverQueued.delete(j.item.product_uid);log('SERVER_VECTOR_OK',{cycle_id:j.cycle_id,product_uid:j.item.product_uid,elapsed_ms:Date.now()-t,queue_left:serverQueue.length,workers:serverWorkers,concurrency:serverConcurrency});
   }catch(e){
    if(j.retry<2){j.retry++;serverQueue.push(j);}else{serverQueued.delete(j.item.product_uid);const c=cycles.get(j.cycle_id);if(c)c.failed_ids.add(j.item.product_uid);}
    log('SERVER_VECTOR_FAIL',{cycle_id:j.cycle_id,product_uid:j.item.product_uid,retry:j.retry,error:S(e&&e.message||e),workers:serverWorkers,concurrency:serverConcurrency});
   }
   await new Promise(r=>setTimeout(r,0));
  }
 }finally{serverWorkers--;if(serverQueue.length)pumpServerWorkers();}
}
function pumpServerWorkers(){while(serverQueue.length&&serverWorkers<serverConcurrency)serverWorker();}
module.exports=router;
