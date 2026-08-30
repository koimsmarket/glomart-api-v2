'use strict';
/* GM_CATEGORY_BATCH_SPECIAL_SERVER_V003
 * Standalone one-off preload service. It intentionally does NOT require or modify
 * glomart-api-v2/server.js, routes/image_vector.js, or public/image_worker.js.
 * Run as a separate Cloudtype service with the same DATABASE_URL.
 */
const express=require('express');
const cors=require('cors');
const {Pool}=require('pg');
const path=require('path');

const VERSION='GM_CATEGORY_BATCH_SPECIAL_SERVER_V003';
const PORT=Number(process.env.PORT||3000);
const ADMIN_IDS=new Set(['derzon','derzon1287','msoon']);
const DIM=512;
const app=express();
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSL==='1'?{rejectUnauthorized:false}:false});
app.use(cors({origin:(origin,cb)=>cb(null,!origin||/^https:\/\/(m\.)?glomart\.kr$/i.test(origin)||/^https:\/\/koims1287\.cafe24\.com$/i.test(origin)),credentials:false}));
app.use(express.json({limit:'2mb'}));
app.use(express.static(path.join(__dirname,'public'),{maxAge:0}));

const control={mode:'STOPPED',updated_at:null,updated_by:'',command:''};
const deviceLeases=new Map(); // device_id -> {category_id, client}
const cycles=new Map();
const serverQueue=[];
const serverQueued=new Set();
let serverRunning=false;
let modelPromise=null;
let seq=0;

function S(v){return String(v==null?'':v).trim();}
function N(v,d){const n=Number(v);return Number.isFinite(n)?n:d;}
function clamp(n,a,b){return Math.max(a,Math.min(b,n));}
function allowedAdmin(v){return ADMIN_IDS.has(S(v));}
function auth(req,res){
  const member=S((req.body&&req.body.member_id)||(req.query&&req.query.member_id));
  if(!allowedAdmin(member)){res.status(403).json({ok:false,error:'ADMIN_ID_REQUIRED'});return null;}
  return member;
}
function log(tag,obj){console.log('[GM_CATEGORY_BATCH '+tag+']',JSON.stringify(Object.assign({ts:new Date().toISOString()},obj||{})));}
function splitKeywords(v){return [...new Set(S(v).split('/').map(x=>x.trim()).filter(Boolean))];}
function vectorValidSql(alias='v'){return `${alias}.vector_image IS NOT NULL AND array_length(${alias}.vector_image,1)=${DIM}`;}

app.get('/health',async(_req,res)=>{
  try{await pool.query('SELECT 1');res.json({ok:true,version:VERSION,control,cycles:cycles.size,server_queue:serverQueue.length});}
  catch(e){res.status(500).json({ok:false,version:VERSION,error:S(e.message)});}
});
app.post('/api/special/category-batch/command',(req,res)=>{
  const member=auth(req,res);if(!member)return;
  const cmd=S(req.body&&req.body.command);
  if(cmd==='#카테고리 검색#')control.mode='RUN';
  else if(cmd==='#카테고리 일시정지#')control.mode='PAUSE';
  else if(cmd==='#카테고리 중지#')control.mode='STOPPED';
  else return res.status(400).json({ok:false,error:'UNKNOWN_COMMAND'});
  control.updated_at=new Date().toISOString();control.updated_by=member;control.command=cmd;
  log('COMMAND',{member,cmd,mode:control.mode});
  res.json({ok:true,version:VERSION,control});
});
app.get('/api/special/category-batch/control',(req,res)=>{
  const member=auth(req,res);if(!member)return;
  res.json({ok:true,version:VERSION,control});
});

async function releaseDeviceLease(deviceId,markComplete){
  const lease=deviceLeases.get(deviceId);if(!lease)return null;
  try{
    if(markComplete)await lease.client.query('UPDATE gm_category SET created_at=COALESCE(created_at,NOW()) WHERE category_id=$1',[lease.category_id]);
    await lease.client.query('SELECT pg_advisory_unlock($1::bigint)',[lease.category_id]);
  }finally{lease.client.release();deviceLeases.delete(deviceId);}
  return lease.category_id;
}

app.post('/api/special/category-batch/next',async(req,res)=>{
  const member=auth(req,res);if(!member)return;
  const deviceId=S(req.body&&req.body.device_id);if(!deviceId)return res.status(400).json({ok:false,error:'device_id required'});
  if(control.mode!=='RUN')return res.json({ok:true,state:control.mode,category:null});
  if(deviceLeases.has(deviceId)){
    const l=deviceLeases.get(deviceId);
    const q=await l.client.query('SELECT category_id,name_ko,created_at FROM gm_category WHERE category_id=$1',[l.category_id]);
    const row=q.rows[0]||null;
    return res.json({ok:true,state:'LEASED',category:row?Object.assign(row,{keywords:splitKeywords(row.name_ko)}):null});
  }
  const candidates=await pool.query(`SELECT category_id,name_ko FROM gm_category WHERE created_at IS NULL AND COALESCE(name_ko,'')<>'' ORDER BY category_id ASC LIMIT 80`);
  for(const row of candidates.rows){
    const client=await pool.connect();
    try{
      const lk=await client.query('SELECT pg_try_advisory_lock($1::bigint) AS ok',[row.category_id]);
      if(lk.rows[0]&&lk.rows[0].ok){
        const still=await client.query('SELECT category_id,name_ko,created_at FROM gm_category WHERE category_id=$1',[row.category_id]);
        if(still.rows[0]&&!still.rows[0].created_at){
          deviceLeases.set(deviceId,{category_id:row.category_id,client,member_id:member,leased_at:Date.now()});
          log('CATEGORY_LEASE',{device_id:deviceId,category_id:row.category_id,name_ko:row.name_ko});
          return res.json({ok:true,state:'LEASED',category:Object.assign(row,{keywords:splitKeywords(row.name_ko)})});
        }
        await client.query('SELECT pg_advisory_unlock($1::bigint)',[row.category_id]);
      }
    }catch(e){try{client.release();}catch(_){ }throw e;}
    if(!deviceLeases.has(deviceId))client.release();
  }
  res.json({ok:true,state:'EMPTY',category:null});
});
app.post('/api/special/category-batch/complete',async(req,res)=>{
  const member=auth(req,res);if(!member)return;
  const deviceId=S(req.body&&req.body.device_id),categoryId=Number(req.body&&req.body.category_id||0);
  const lease=deviceLeases.get(deviceId);
  if(!lease||Number(lease.category_id)!==categoryId)return res.status(409).json({ok:false,error:'LEASE_MISMATCH'});
  await releaseDeviceLease(deviceId,true);
  log('CATEGORY_DONE',{device_id:deviceId,category_id:categoryId,member_id:member});
  res.json({ok:true,category_id:categoryId});
});
app.post('/api/special/category-batch/release',async(req,res)=>{
  const member=auth(req,res);if(!member)return;
  const deviceId=S(req.body&&req.body.device_id);
  const id=await releaseDeviceLease(deviceId,false);
  log('CATEGORY_RELEASE',{device_id:deviceId,category_id:id,member_id:member});
  res.json({ok:true,category_id:id});
});

app.get('/api/special/category-batch/search-state',async(req,res)=>{
  const member=auth(req,res);if(!member)return;
  const keyword=S(req.query.keyword),startedAt=S(req.query.started_at);
  if(!keyword||!startedAt)return res.status(400).json({ok:false,error:'keyword/started_at required'});
  const q=await pool.query(`SELECT COUNT(*)::int AS total,
    COUNT(*) FILTER(WHERE status='pending')::int AS pending,
    COUNT(*) FILTER(WHERE status='processing')::int AS processing,
    COUNT(*) FILTER(WHERE status='done')::int AS done,
    COUNT(*) FILTER(WHERE status='failed')::int AS failed,
    MAX(created_at) AS last_created_at,MAX(processed_at) AS last_processed_at
    FROM gm_product_upsert_queue WHERE keyword=$1 AND created_at >= $2::timestamptz`,[keyword,startedAt]);
  const x=q.rows[0]||{};const last=x.last_created_at?new Date(x.last_created_at).getTime():0;
  const quietSec=last?Math.max(0,(Date.now()-last)/1000):0;
  const settled=Number(x.total||0)>0&&Number(x.pending||0)===0&&Number(x.processing||0)===0&&quietSec>=5;
  res.json({ok:true,keyword,total:Number(x.total||0),pending:Number(x.pending||0),processing:Number(x.processing||0),done:Number(x.done||0),failed:Number(x.failed||0),quiet_sec:Math.round(quietSec*10)/10,settled});
});

async function getCycleItems(keyword,startedAt,limit=200){
  const q=await pool.query(`SELECT p.product_uid,p.mall_code,p.thumb_origin_url AS image_url
      FROM gm_product p
      LEFT JOIN gm_product_image_vector v ON v.product_uid=p.product_uid
     WHERE p.keyword=$1
       AND COALESCE(p.updated_at,p.created_at) >= ($2::timestamptz - interval '2 minutes')
       AND COALESCE(p.thumb_origin_url,'')<>''
       AND NOT (${vectorValidSql('v')})
     ORDER BY COALESCE(p.updated_at,p.created_at) ASC,p.product_uid ASC
     LIMIT $3`,[keyword,startedAt,limit]);
  return q.rows.map(r=>({product_uid:S(r.product_uid),mall_code:S(r.mall_code),image_url:S(r.image_url)}));
}
function enqueueServer(cycleId,items){
  for(const item of items){if(!item.product_uid||serverQueued.has(item.product_uid))continue;serverQueued.add(item.product_uid);serverQueue.push({cycle_id:cycleId,item,retry:0});}
  runServerQueue();
}
app.post('/api/special/category-batch/vector-cycle',async(req,res)=>{
  const member=auth(req,res);if(!member)return;
  const keyword=S(req.body&&req.body.keyword),startedAt=S(req.body&&req.body.started_at),deviceId=S(req.body&&req.body.device_id);
  const serverRatio=clamp(Math.round(N(req.body&&req.body.server_ratio,70)),0,100);
  const phoneRatio=100-serverRatio;
  if(!keyword||!startedAt||!deviceId)return res.status(400).json({ok:false,error:'keyword/started_at/device_id required'});
  const items=await getCycleItems(keyword,startedAt,200);
  const serverCount=Math.min(items.length,Math.round(items.length*serverRatio/100));
  const serverItems=items.slice(0,serverCount),phoneItems=items.slice(serverCount);
  const cycleId=`C${Date.now()}_${++seq}`;
  cycles.set(cycleId,{cycle_id:cycleId,keyword,device_id:deviceId,member_id:member,created_at:Date.now(),all_ids:items.map(x=>x.product_uid),server_ids:serverItems.map(x=>x.product_uid),phone_ids:phoneItems.map(x=>x.product_uid),server_ratio:serverRatio,phone_ratio:phoneRatio});
  enqueueServer(cycleId,serverItems);
  log('VECTOR_SPLIT',{cycle_id:cycleId,device_id:deviceId,keyword,total:items.length,server:serverItems.length,phone:phoneItems.length,server_ratio:serverRatio,phone_ratio:phoneRatio});
  res.json({ok:true,cycle_id:cycleId,total:items.length,server_count:serverItems.length,phone_count:phoneItems.length,phone_tasks:phoneItems});
});
app.get('/api/special/category-batch/vector-status',async(req,res)=>{
  const member=auth(req,res);if(!member)return;
  const cycleId=S(req.query.cycle_id),c=cycles.get(cycleId);if(!c)return res.status(404).json({ok:false,error:'CYCLE_NOT_FOUND'});
  const ids=c.all_ids;if(!ids.length)return res.json({ok:true,cycle_id:cycleId,total:0,done:0,remaining:0,server_done:0,phone_done:0});
  const q=await pool.query(`SELECT product_uid FROM gm_product_image_vector WHERE product_uid=ANY($1::text[]) AND ${vectorValidSql('gm_product_image_vector')}`,[ids]);
  const done=new Set(q.rows.map(r=>S(r.product_uid)));
  const serverDone=c.server_ids.filter(x=>done.has(x)).length,phoneDone=c.phone_ids.filter(x=>done.has(x)).length;
  res.json({ok:true,cycle_id:cycleId,keyword:c.keyword,total:ids.length,done:done.size,remaining:ids.length-done.size,server_total:c.server_ids.length,server_done:serverDone,server_remaining:c.server_ids.length-serverDone,phone_total:c.phone_ids.length,phone_done:phoneDone,phone_remaining:c.phone_ids.length-phoneDone,server_queue:serverQueue.length,server_running:serverRunning});
});

async function loadModel(){
  if(modelPromise)return modelPromise;
  modelPromise=(async()=>{
    log('SERVER_AI_LOAD_START',{model:'Xenova/mobileclip_s0'});
    const T=await import('@huggingface/transformers');
    const processor=await T.AutoProcessor.from_pretrained('Xenova/mobileclip_s0');
    const model=await T.CLIPVisionModelWithProjection.from_pretrained('Xenova/mobileclip_s0',{quantized:true,device:'cpu'});
    log('SERVER_AI_READY',{model:'Xenova/mobileclip_s0',dim:DIM});
    return {T,processor,model};
  })().catch(e=>{modelPromise=null;log('SERVER_AI_LOAD_FAIL',{error:S(e&&e.message||e)});throw e;});
  return modelPromise;
}
async function inferUrl(url){
  const A=await loadModel();
  const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'},redirect:'follow'});
  if(!r.ok)throw new Error('image HTTP '+r.status);
  const blob=await r.blob();
  if(!/^image\//i.test(S(blob.type)))throw new Error('non-image '+S(blob.type));
  const raw=await A.T.RawImage.fromBlob(blob);
  const inputs=await A.processor(raw),out=await A.model(inputs),t=out.image_embeds||out.image_embedding||out.pooler_output;
  if(!t||!t.data||t.data.length!==DIM)throw new Error('embedding dimension '+(t&&t.data&&t.data.length||0));
  const v=new Array(DIM);let norm=0;for(let i=0;i<DIM;i++){const n=Number(t.data[i])||0;v[i]=n;norm+=n*n;}norm=Math.sqrt(norm)||1;for(let i=0;i<DIM;i++)v[i]/=norm;
  return v;
}
async function runServerQueue(){
  if(serverRunning)return;serverRunning=true;
  try{
    while(serverQueue.length){
      const job=serverQueue.shift(),started=Date.now();
      try{
        const exists=await pool.query(`SELECT 1 FROM gm_product_image_vector WHERE product_uid=$1 AND ${vectorValidSql('gm_product_image_vector')} LIMIT 1`,[job.item.product_uid]);
        if(!exists.rowCount){
          const vector=await inferUrl(job.item.image_url);
          await pool.query(`INSERT INTO gm_product_image_vector(product_uid,vector_image) VALUES($1,$2::real[]) ON CONFLICT(product_uid) DO UPDATE SET vector_image=EXCLUDED.vector_image`,[job.item.product_uid,vector]);
        }
        log('SERVER_VECTOR_OK',{cycle_id:job.cycle_id,product_uid:job.item.product_uid,mall_code:job.item.mall_code,elapsed_ms:Date.now()-started,queue_left:serverQueue.length});
        serverQueued.delete(job.item.product_uid);
      }catch(e){
        if(job.retry<2){job.retry++;serverQueue.push(job);}else serverQueued.delete(job.item.product_uid);
        log('SERVER_VECTOR_FAIL',{cycle_id:job.cycle_id,product_uid:job.item.product_uid,retry:job.retry,error:S(e&&e.message||e),queue_left:serverQueue.length});
      }
      await new Promise(r=>setTimeout(r,0));
    }
  }finally{serverRunning=false;}
}

process.on('SIGTERM',async()=>{for(const id of [...deviceLeases.keys()])try{await releaseDeviceLease(id,false);}catch(_e){};try{await pool.end();}catch(_e){};process.exit(0);});
app.listen(PORT,()=>log('BOOT',{version:VERSION,port:PORT,admins:[...ADMIN_IDS]}));
