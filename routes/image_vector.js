/* GM_IMAGE_VECTOR_ROUTE_V023_HNSW_MANAGER_SPLIT
 * Existing image-vector storage/missing/proxy behavior stays in this route.
 * Representative/HNSW lifecycle is isolated in services/image_representative_search.js.
 * ACTIVE HNSW is never cleared by a normal product upload.
 */
const express=require('express');
const https=require('https');
const http=require('http');
const router=express.Router();
const representativeSearch=require('../services/image_representative_search');
const DIM=512, BYTE_LEN=1024, VECTOR_VERSION=2, ROUTE_VERSION='GM_IMAGE_VECTOR_ROUTE_V025_MEMORY_MODE_NO_MIGRATION';

let cachedVectorColumnType=null;
async function vectorColumnType(pool){
  if(cachedVectorColumnType)return cachedVectorColumnType;
  const q=await pool.query(`
    SELECT format_type(a.atttypid,a.atttypmod) AS column_type
      FROM pg_attribute a
      JOIN pg_class c ON c.oid=a.attrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE c.relname='gm_product_image_vector'
       AND a.attname='vector_image'
       AND a.attnum>0
       AND NOT a.attisdropped
     ORDER BY CASE WHEN n.nspname=current_schema() THEN 0 ELSE 1 END
     LIMIT 1`);
  const t=C(q.rows&&q.rows[0]&&q.rows[0].column_type).toLowerCase();
  if(!t)throw new Error('gm_product_image_vector.vector_image type not found');
  cachedVectorColumnType=t;
  return t;
}
function isArrayVectorType(t){return /^(real|double precision)\[\]$/.test(C(t).toLowerCase());}
function isPgVectorType(t){return /^vector(?:\(|$)/.test(C(t).toLowerCase());}
function C(v){return String(v==null?'':v).trim();}
function halfToFloat(h){
  const s=(h&0x8000)?-1:1,e=(h>>10)&0x1f,f=h&0x03ff;
  if(e===0)return s*Math.pow(2,-14)*(f/1024);
  if(e===31)return f?NaN:s*Infinity;
  return s*Math.pow(2,e-15)*(1+f/1024);
}
function vectorFromBase64(raw){
  try{
    const b=Buffer.from(C(raw),'base64');if(b.length!==BYTE_LEN)return null;
    const a=new Array(DIM);let norm=0;
    for(let i=0;i<DIM;i++){const v=halfToFloat(b.readUInt16LE(i*2));if(!Number.isFinite(v))return null;a[i]=v;norm+=v*v;}
    if(!(norm>0))return null;return a;
  }catch(_e){return null;}
}
function vectorLiteral(a){return '['+a.map(v=>Number(v).toPrecision(9)).join(',')+']';}
function allowedImageUrl(raw){
  try{
    const u=new URL(C(raw));if(u.protocol!=='https:')return null;
    const h=u.hostname.toLowerCase();
    const ok=(h==='thumbnail.coupangcdn.com'||h.endsWith('.coupangcdn.com')||h==='ae-pic-a1.aliexpress-media.com'||h.endsWith('.aliexpress-media.com')||h.endsWith('.alicdn.com'));
    return ok?u:null;
  }catch(_e){return null;}
}
function fetchImage(u,res,depth){
  if(depth>3)return res.status(502).json({ok:false,error:'too many redirects'});
  const mod=u.protocol==='https:'?https:http;
  const req=mod.get(u,{headers:{'User-Agent':'Mozilla/5.0','Accept':'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'}},r=>{
    if(r.statusCode>=300&&r.statusCode<400&&r.headers.location){r.resume();try{const next=new URL(r.headers.location,u),safe=allowedImageUrl(next.toString());if(!safe)return res.status(403).json({ok:false,error:'redirect host blocked'});return fetchImage(safe,res,depth+1);}catch(_e){return res.status(502).json({ok:false,error:'bad redirect'});}}
    if(r.statusCode!==200){r.resume();return res.status(502).json({ok:false,error:'image upstream '+r.statusCode});}
    const ct=C(r.headers['content-type']);if(!/^image\//i.test(ct)){r.resume();return res.status(415).json({ok:false,error:'upstream is not image'});}
    const len=Number(r.headers['content-length']||0);if(len>5*1024*1024){r.resume();return res.status(413).json({ok:false,error:'image too large'});}
    res.setHeader('Content-Type',ct);res.setHeader('Cache-Control','public, max-age=86400');if(len)res.setHeader('Content-Length',String(len));r.pipe(res);
  });
  req.setTimeout(8000,()=>req.destroy(new Error('timeout')));
  req.on('error',e=>{if(!res.headersSent)res.status(502).json({ok:false,error:C(e&&e.message||e)});else try{res.end();}catch(_e){}});
}

router.get('/api/gm/image-vector/proxy',(req,res)=>{const u=allowedImageUrl(req.query&&req.query.url);if(!u)return res.status(400).json({ok:false,error:'unsupported image url'});fetchImage(u,res,0);});
router.get('/api/gm/image-vector/version',(req,res)=>res.json({ok:true,route_version:ROUTE_VERSION,dimensions:DIM,vector_version:VECTOR_VERSION,representative_hnsw:representativeSearch.status()}));
// Deep-switch records share gm_image_vector_background_config.
// config_id=1: background vector OFF/AUTO/ON; config_id=2: representative HNSW LOADING/UNLOADING.
router.get('/api/gm/image-vector/memory-mode',async(req,res)=>{
  const pool=req.app.locals.pool;if(!pool)return res.status(503).json({ok:false,error:'db unavailable',route_version:ROUTE_VERSION});
  try{const memory_mode=await representativeSearch.getMemoryMode(pool,true);return res.json({ok:true,memory_mode,route_version:ROUTE_VERSION,representative_hnsw:representativeSearch.status()});}
  catch(e){return res.status(500).json({ok:false,error:C(e&&e.message||e),route_version:ROUTE_VERSION});}
});
router.post('/api/gm/image-vector/memory-mode',async(req,res)=>{
  const pool=req.app.locals.pool;if(!pool)return res.status(503).json({ok:false,error:'db unavailable',route_version:ROUTE_VERSION});
  try{const memory_mode=await representativeSearch.setMemoryMode(pool,req.body&&req.body.mode);return res.json({ok:true,memory_mode,route_version:ROUTE_VERSION,representative_hnsw:representativeSearch.status()});}
  catch(e){return res.status(e&&e.message==='INVALID_MEMORY_MODE'?400:500).json({ok:false,error:C(e&&e.message||e),route_version:ROUTE_VERSION});}
});
// Status is read-only. Merely opening/refreshing Builder must never start a representative preload.
router.get('/api/gm/image-vector/index-status',async(req,res)=>{
  const pool=req.app.locals.pool;if(!pool)return res.status(503).json({ok:false,error:'db unavailable',route_version:ROUTE_VERSION});
  try{await representativeSearch.getMemoryMode(pool,false);return res.json({ok:true,route_version:ROUTE_VERSION,representative_hnsw:representativeSearch.status()});}
  catch(e){return res.status(500).json({ok:false,error:C(e&&e.message||e),route_version:ROUTE_VERSION});}
});
// Full preload is Builder-only and is ignored while memory mode is UNLOADING.
router.post('/api/gm/image-vector/index-preload',async(req,res)=>{
  const pool=req.app.locals.pool;if(!pool)return res.status(503).json({ok:false,error:'db unavailable',route_version:ROUTE_VERSION});
  try{
    const memory_mode=await representativeSearch.getMemoryMode(pool,true);
    if(memory_mode!=='LOADING')return res.json({ok:true,started:false,skipped:'MEMORY_UNLOADING',memory_mode,route_version:ROUTE_VERSION,representative_hnsw:representativeSearch.status()});
    const started=representativeSearch.startBuild(pool,'builder_representative_complete',true);
    return res.json({ok:true,started,memory_mode,route_version:ROUTE_VERSION,representative_hnsw:representativeSearch.status()});
  }catch(e){return res.status(500).json({ok:false,error:C(e&&e.message||e),route_version:ROUTE_VERSION});}
});
router.post('/api/gm/image-vector/missing',async(req,res)=>{
  const pool=req.app.locals.pool,raw=Array.isArray(req.body&&req.body.product_uids)?req.body.product_uids:[],ids=[...new Set(raw.map(C).filter(Boolean))].slice(0,200);
  if(!pool)return res.status(503).json({ok:false,error:'db unavailable'});
  if(!ids.length)return res.json({ok:true,missing:[],existing:[],dimensions:DIM,vector_version:VECTOR_VERSION,route_version:ROUTE_VERSION});
  try{
    const columnType=await vectorColumnType(pool);let sql;
    if(isArrayVectorType(columnType))sql='SELECT product_uid FROM gm_product_image_vector WHERE product_uid = ANY($1::text[]) AND vector_image IS NOT NULL AND array_length(vector_image,1) = $2';
    else if(isPgVectorType(columnType))sql='SELECT product_uid FROM gm_product_image_vector WHERE product_uid = ANY($1::text[]) AND vector_image IS NOT NULL AND vector_dims(vector_image) = $2';
    else return res.json({ok:true,existing:[],missing:ids,dimensions:DIM,vector_version:VECTOR_VERSION,column_type:columnType,route_version:ROUTE_VERSION});
    const q=await pool.query(sql,[ids,DIM]),have=new Set(q.rows.map(r=>C(r.product_uid)));
    return res.json({ok:true,existing:ids.filter(x=>have.has(x)),missing:ids.filter(x=>!have.has(x)),dimensions:DIM,vector_version:VECTOR_VERSION,column_type:columnType,route_version:ROUTE_VERSION});
  }catch(e){return res.status(500).json({ok:false,error:C(e&&e.message||e),route_version:ROUTE_VERSION});}
});
router.post('/api/gm/image-vector/upsert',async(req,res)=>{
  const pool=req.app.locals.pool,uid=C(req.body&&req.body.product_uid),imageUrl=C(req.body&&req.body.image_url),v=vectorFromBase64(req.body&&req.body.vector_base64);
  if(!pool)return res.status(503).json({ok:false,error:'db unavailable'});
  if(!uid||!v)return res.status(400).json({ok:false,error:'product_uid/vector_base64(1024-byte Float16) required'});
  try{
    const columnType=await vectorColumnType(pool);
    if(isArrayVectorType(columnType))await pool.query(`INSERT INTO gm_product_image_vector(product_uid,vector_image) VALUES($1,$2::real[]) ON CONFLICT(product_uid) DO UPDATE SET vector_image=EXCLUDED.vector_image`,[uid,v]);
    else if(isPgVectorType(columnType))await pool.query(`INSERT INTO gm_product_image_vector(product_uid,vector_image) VALUES($1,$2::vector) ON CONFLICT(product_uid) DO UPDATE SET vector_image=EXCLUDED.vector_image`,[uid,vectorLiteral(v)]);
    else throw new Error('unsupported vector_image type '+columnType);
    // Foreground/mobile embedding is complete at the vector save boundary.
    // Clear any background-vector pending row so the same image is never embedded again.
    const pending=imageUrl?await pool.query('DELETE FROM gm_image_vector_pending WHERE product_uid=$1 AND image_url=$2',[uid,imageUrl]):{rowCount:0};
    // Vector save is the end of the foreground request path.
    // Emit only a lightweight vector-saved signal; representative work is decided later
    // by the background controller under OFF/AUTO/ON and never blocks this response.
    process.emit('gm:image-vector-saved',{product_uid:uid,source:'foreground_upsert'});
    return res.json({ok:true,product_uid:uid,dimensions:DIM,bytes:BYTE_LEN,vector_version:VECTOR_VERSION,column_type:columnType,pending_deleted:pending.rowCount,representative_assignment:'BACKGROUND_CATEGORY_DEFERRED',route_version:ROUTE_VERSION});
  }catch(e){return res.status(500).json({ok:false,error:C(e&&e.message||e),route_version:ROUTE_VERSION});}
});
router.post('/api/gm/image-vector/search',async(req,res)=>{
  const pool=req.app.locals.pool,v=vectorFromBase64(req.body&&req.body.vector_base64),limit=Math.max(1,Math.min(30,Number(req.body&&req.body.limit||30)||30)),searchMode=C(req.body&&req.body.search_mode).toLowerCase()==='precise'?'precise':'fast',categoryCode=C(req.body&&req.body.category_code).toUpperCase();
  if(!pool)return res.status(503).json({ok:false,error:'db unavailable'});
  if(!v)return res.status(400).json({ok:false,error:'vector_base64(1024-byte Float16) required'});
  const started=Date.now();
  try{
    const columnType=await vectorColumnType(pool);
    if(!isArrayVectorType(columnType))return res.status(409).json({ok:false,error:'representative search requires REAL[] production vectors',column_type:columnType,route_version:ROUTE_VERSION,search_ms:Date.now()-started});
    const out=await representativeSearch.search(pool,v,limit,searchMode,categoryCode),searchMs=Date.now()-started;
    const metaReady=out.matches.filter(m=>C(m.keyword||m.category_keyword||m.product_name)).length;
    console.log('[GM_IMAGE_VECTOR_REP_SEARCH]',JSON.stringify({mode:out.search_mode,engine:out.search_engine,category_code:categoryCode,memory_mode:out.memory_mode,run_no:out.run_no,representative_count:out.representative_count,rep_groups:out.representative_candidates.length,member_candidates:out.member_candidate_count,run0_candidates:out.run0_candidate_count,count:out.matches.length,best_score:out.matches[0]?Number(Number(out.matches[0].score||0).toFixed(6)):null,search_ms:searchMs,timings:out.timings,hnsw:out.hnsw_status,route_version:ROUTE_VERSION}));
    return res.json({ok:true,count:out.matches.length,matches:out.matches,metadata_ready:metaReady,vector_version:VECTOR_VERSION,column_type:columnType,route_version:ROUTE_VERSION,category_code:categoryCode,search_mode:out.search_mode,search_mode_label:out.search_mode==='fast'?'신속검색':'정밀검색',search_engine:out.search_engine,memory_mode:out.memory_mode,run_no:out.run_no,representative_count:out.representative_count,representative_group_limit:representativeSearch.REP_GROUP_LIMIT,representative_candidates:out.representative_candidates,representative_scanned:out.search_mode==='precise'?out.representative_count:null,candidate_count:out.member_candidate_count,run0_candidate_count:out.run0_candidate_count,hnsw_status:out.hnsw_status,search_ms:searchMs,timings:out.timings});
  }catch(e){
    return res.status(500).json({ok:false,error:C(e&&e.message||e),route_version:ROUTE_VERSION,search_ms:Date.now()-started});
  }
});
module.exports=router;
