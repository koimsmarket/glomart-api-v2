/* GM_IMAGE_VECTOR_ROUTE_V010
 * V345: REAL[] exact search uses a process-memory vector index/cache instead of SQL unnest cosine.
 *       The cache is warmed opportunistically by /missing, refreshed after writes, and searched in Node.
 *       No DB schema/migration changes. Existing REAL[] vectors remain the source of truth.
 * V344: REAL[] search no longer depends on pgvector. Cosine similarity is calculated directly from REAL[] values.
 *       No DB schema/migration changes.
 * V343: deployment-verification build. No DB schema/migration changes.
 *       Production REAL[] is handled directly with array_length(); no vector_dims(real[]) call.
 *       Responses expose route_version so deployed code can be verified from device logs.
 * V336: 512-d MobileCLIP image embeddings using pgvector `vector` (not halfvec).
 * Existing non-512 vectors are treated as stale by /missing and are lazily rebuilt.
 * Client sends Float16 binary as base64 (exactly 1024 decoded bytes).
 * Legacy rows/product_uid are preserved; only a searched stale vector is replaced on upsert.
 */
const express=require('express');
const https=require('https');
const http=require('http');
const router=express.Router();
const {encodeCandidateVector,BYTE_LEN:CANDIDATE_BYTES}=require('../services/image_candidate_vector');
const DIM=512, BYTE_LEN=1024, VECTOR_VERSION=2, ROUTE_VERSION='GM_IMAGE_VECTOR_ROUTE_V010_V346';

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
  const s=(h&0x8000)?-1:1, e=(h>>10)&0x1f, f=h&0x03ff;
  if(e===0) return s*Math.pow(2,-14)*(f/1024);
  if(e===31) return f?NaN:s*Infinity;
  return s*Math.pow(2,e-15)*(1+f/1024);
}
function vectorFromBase64(raw){
  try{
    const b=Buffer.from(C(raw),'base64');
    if(b.length!==BYTE_LEN)return null;
    const a=new Array(DIM); let norm=0;
    for(let i=0;i<DIM;i++){
      const v=halfToFloat(b.readUInt16LE(i*2));
      if(!Number.isFinite(v))return null;
      a[i]=v; norm+=v*v;
    }
    if(!(norm>0))return null;
    return a;
  }catch(_e){return null;}
}
function vectorLiteral(a){return '['+a.map(v=>Number(v).toPrecision(9)).join(',')+']';}

// REAL[] production search index. This is an exact in-memory cosine index, not an
// approximate HNSW index: DB rows remain authoritative and no schema/extension is required.
// Keeping normalized Float32 vectors in process memory avoids PostgreSQL unnest(512) work
// on every search. /missing is hit frequently by the image worker, so it also warms this cache.
const REAL_INDEX_REFRESH_MS=Math.max(60_000,Number(process.env.GM_IMAGE_VECTOR_INDEX_REFRESH_MS||300_000)||300_000);
const realIndex={items:new Map(),ready:false,loadedAt:0,loading:null,lastError:'',loadMs:0};

function normalizedFloat32(raw){
  if(!Array.isArray(raw)||raw.length!==DIM)return null;
  const a=new Float32Array(DIM); let norm=0;
  for(let i=0;i<DIM;i++){const x=Number(raw[i]);if(!Number.isFinite(x))return null;a[i]=x;norm+=x*x;}
  if(!(norm>0))return null;
  const inv=1/Math.sqrt(norm);
  for(let i=0;i<DIM;i++)a[i]*=inv;
  return a;
}
function metaFromRow(r){
  return {
    product_uid:C(r.product_uid),
    product_name:C(r.product_name),
    product_url:C(r.product_url),
    image_url:C(r.thumb_origin_url),
    mall_code:C(r.mall_code),
    keyword:C(r.keyword),
    category_keyword:C(r.category_keyword)
  };
}
async function loadRealIndex(pool,force){
  const now=Date.now();
  if(!force&&realIndex.ready&&(now-realIndex.loadedAt)<REAL_INDEX_REFRESH_MS)return realIndex;
  if(realIndex.loading)return realIndex.loading;
  realIndex.loading=(async()=>{
    const started=Date.now();
    try{
      const q=await pool.query(`
        SELECT v.product_uid,v.vector_image,
               p.product_name,p.product_url,p.thumb_origin_url,p.mall_code,p.keyword,p.category_keyword
          FROM gm_product_image_vector v
          LEFT JOIN gm_product p ON p.product_uid=v.product_uid
         WHERE v.vector_image IS NOT NULL
           AND array_length(v.vector_image,1)=$1`,[DIM]);
      const next=new Map();
      for(const r of q.rows||[]){
        const vec=normalizedFloat32(r.vector_image);
        const uid=C(r.product_uid);
        if(uid&&vec)next.set(uid,{...metaFromRow(r),vec});
      }
      realIndex.items=next; realIndex.ready=true; realIndex.loadedAt=Date.now();
      realIndex.loadMs=realIndex.loadedAt-started; realIndex.lastError='';
      console.log('[GM_IMAGE_VECTOR_INDEX_READY]',JSON.stringify({count:next.size,load_ms:realIndex.loadMs,route_version:ROUTE_VERSION}));
      return realIndex;
    }catch(e){
      realIndex.lastError=C(e&&e.message||e);
      console.error('[GM_IMAGE_VECTOR_INDEX_FAIL]',realIndex.lastError);
      throw e;
    }finally{realIndex.loading=null;}
  })();
  return realIndex.loading;
}
function warmRealIndex(pool){
  if(!pool)return;
  loadRealIndex(pool,false).catch(()=>{});
}
async function upsertRealIndexItem(pool,uid,vector){
  if(!realIndex.ready)return;
  const vec=normalizedFloat32(vector); if(!vec)return;
  try{
    const q=await pool.query(`SELECT product_uid,product_name,product_url,thumb_origin_url,mall_code,keyword,category_keyword FROM gm_product WHERE product_uid=$1 LIMIT 1`,[uid]);
    const r=(q.rows&&q.rows[0])||{product_uid:uid};
    realIndex.items.set(uid,{...metaFromRow(r),product_uid:uid,vec});
  }catch(_e){
    realIndex.items.set(uid,{product_uid:uid,product_name:'',product_url:'',image_url:'',mall_code:'',keyword:'',category_keyword:'',vec});
  }
}
function searchRealIndex(queryVector,limit){
  const q=normalizedFloat32(queryVector); if(!q)return [];
  const best=[];
  for(const item of realIndex.items.values()){
    const v=item.vec; let score=0;
    for(let i=0;i<DIM;i++)score+=q[i]*v[i];
    if(best.length<limit){
      best.push({item,score});
      best.sort((a,b)=>a.score-b.score);
    }else if(score>best[0].score){
      best[0]={item,score};
      best.sort((a,b)=>a.score-b.score);
    }
  }
  best.sort((a,b)=>b.score-a.score);
  return best.map(x=>({...x.item,score:x.score}));
}

function allowedImageUrl(raw){
 try{
  const u=new URL(C(raw));
  if(u.protocol!=='https:')return null;
  const h=u.hostname.toLowerCase();
  const ok=(h==='thumbnail.coupangcdn.com'||h.endsWith('.coupangcdn.com')||h==='ae-pic-a1.aliexpress-media.com'||h.endsWith('.aliexpress-media.com')||h.endsWith('.alicdn.com'));
  return ok?u:null;
 }catch(_e){return null;}
}
function fetchImage(u,res,depth){
 if(depth>3)return res.status(502).json({ok:false,error:'too many redirects'});
 const mod=u.protocol==='https:'?https:http;
 const req=mod.get(u,{headers:{'User-Agent':'Mozilla/5.0','Accept':'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'}},r=>{
  if(r.statusCode>=300&&r.statusCode<400&&r.headers.location){
   r.resume();
   try{const next=new URL(r.headers.location,u);const safe=allowedImageUrl(next.toString());if(!safe)return res.status(403).json({ok:false,error:'redirect host blocked'});return fetchImage(safe,res,depth+1);}catch(_e){return res.status(502).json({ok:false,error:'bad redirect'});}
  }
  if(r.statusCode!==200){r.resume();return res.status(502).json({ok:false,error:'image upstream '+r.statusCode});}
  const ct=C(r.headers['content-type']);
  if(!/^image\//i.test(ct)){r.resume();return res.status(415).json({ok:false,error:'upstream is not image'});}
  const len=Number(r.headers['content-length']||0);
  if(len>5*1024*1024){r.resume();return res.status(413).json({ok:false,error:'image too large'});}
  res.setHeader('Content-Type',ct);res.setHeader('Cache-Control','public, max-age=86400');if(len)res.setHeader('Content-Length',String(len));r.pipe(res);
 });
 req.setTimeout(8000,()=>req.destroy(new Error('timeout')));
 req.on('error',e=>{if(!res.headersSent)res.status(502).json({ok:false,error:C(e&&e.message||e)});else try{res.end();}catch(_e){}});
}
router.get('/api/gm/image-vector/proxy',(req,res)=>{
 const u=allowedImageUrl(req.query&&req.query.url);
 if(!u)return res.status(400).json({ok:false,error:'unsupported image url'});
 fetchImage(u,res,0);
});
router.get('/api/gm/image-vector/version',(req,res)=>res.json({ok:true,route_version:ROUTE_VERSION,dimensions:DIM,vector_version:VECTOR_VERSION}));
router.post('/api/gm/image-vector/missing',async(req,res)=>{
 const pool=req.app.locals.pool;
 const raw=Array.isArray(req.body&&req.body.product_uids)?req.body.product_uids:[];
 const ids=[...new Set(raw.map(C).filter(Boolean))].slice(0,200);
 if(!pool)return res.status(503).json({ok:false,error:'db unavailable'});
 if(!ids.length)return res.json({ok:true,missing:[],existing:[],dimensions:DIM,vector_version:VECTOR_VERSION,route_version:ROUTE_VERSION});
 try{
  const columnType=await vectorColumnType(pool);
  let sql;
  if(isArrayVectorType(columnType)){
    warmRealIndex(pool);
    sql='SELECT product_uid FROM gm_product_image_vector WHERE product_uid = ANY($1::text[]) AND vector_image IS NOT NULL AND array_length(vector_image,1) = $2';
  }else if(isPgVectorType(columnType)){
    sql='SELECT product_uid FROM gm_product_image_vector WHERE product_uid = ANY($1::text[]) AND vector_image IS NOT NULL AND vector_dims(vector_image) = $2';
  }else{
    return res.json({ok:true,existing:[],missing:ids,dimensions:DIM,vector_version:VECTOR_VERSION,column_type:columnType,route_version:ROUTE_VERSION});
  }
  const q=await pool.query(sql,[ids,DIM]);
  const have=new Set(q.rows.map(r=>C(r.product_uid)));
  return res.json({ok:true,existing:ids.filter(x=>have.has(x)),missing:ids.filter(x=>!have.has(x)),dimensions:DIM,vector_version:VECTOR_VERSION,column_type:columnType,route_version:ROUTE_VERSION});
 }catch(e){return res.status(500).json({ok:false,error:C(e&&e.message||e),route_version:ROUTE_VERSION});}
});
router.post('/api/gm/image-vector/upsert',async(req,res)=>{
 const pool=req.app.locals.pool,uid=C(req.body&&req.body.product_uid),v=vectorFromBase64(req.body&&req.body.vector_base64);
 if(!pool)return res.status(503).json({ok:false,error:'db unavailable'});
 if(!uid||!v)return res.status(400).json({ok:false,error:'product_uid/vector_base64(1024-byte Float16) required'});
 try{
  const columnType=await vectorColumnType(pool);
  if(isArrayVectorType(columnType)){
    const candidate=encodeCandidateVector(v);
    if(!candidate)throw new Error('candidate vector encode failed');
    await pool.query(`INSERT INTO gm_product_image_vector(product_uid,vector_image,candidate_vector) VALUES($1,$2::real[],$3::bytea) ON CONFLICT(product_uid) DO UPDATE SET vector_image=EXCLUDED.vector_image,candidate_vector=EXCLUDED.candidate_vector`,[uid,v,candidate]);
    await upsertRealIndexItem(pool,uid,v);
  }else if(isPgVectorType(columnType)){
    const candidate=encodeCandidateVector(v);
    if(!candidate)throw new Error('candidate vector encode failed');
    await pool.query(`INSERT INTO gm_product_image_vector(product_uid,vector_image,candidate_vector) VALUES($1,$2::vector,$3::bytea) ON CONFLICT(product_uid) DO UPDATE SET vector_image=EXCLUDED.vector_image,candidate_vector=EXCLUDED.candidate_vector`,[uid,vectorLiteral(v),candidate]);
  }else{
    throw new Error('unsupported vector_image type '+columnType);
  }
  return res.json({ok:true,product_uid:uid,dimensions:DIM,bytes:BYTE_LEN,candidate_bytes:CANDIDATE_BYTES,candidate_format:'INT8_V1',vector_version:VECTOR_VERSION,column_type:columnType,route_version:ROUTE_VERSION});
 }catch(e){return res.status(500).json({ok:false,error:C(e&&e.message||e),route_version:ROUTE_VERSION});}
});
router.post('/api/gm/image-vector/search',async(req,res)=>{
 const pool=req.app.locals.pool,v=vectorFromBase64(req.body&&req.body.vector_base64),limit=Math.max(1,Math.min(20,Number(req.body&&req.body.limit||8)||8));
 if(!pool)return res.status(503).json({ok:false,error:'db unavailable'});
 if(!v)return res.status(400).json({ok:false,error:'vector_base64(1024-byte Float16) required'});
 const started=Date.now();
 try{
  const columnType=await vectorColumnType(pool);
  if(isArrayVectorType(columnType)){
    await loadRealIndex(pool,false);
    const matches=searchRealIndex(v,limit).map(r=>({
      product_uid:C(r.product_uid),score:Number(r.score||0),product_name:C(r.product_name),
      product_url:C(r.product_url),image_url:C(r.image_url),mall_code:C(r.mall_code),
      keyword:C(r.keyword),category_keyword:C(r.category_keyword)
    }));
    const searchMs=Date.now()-started;
    console.log('[GM_IMAGE_VECTOR_SEARCH_FAST]',JSON.stringify({count:matches.length,index_count:realIndex.items.size,search_ms:searchMs,index_load_ms:realIndex.loadMs,route_version:ROUTE_VERSION}));
    return res.json({ok:true,count:matches.length,matches,vector_version:VECTOR_VERSION,column_type:columnType,route_version:ROUTE_VERSION,search_mode:'real_array_memory_exact',search_ms:searchMs,index_count:realIndex.items.size,index_loaded_at:realIndex.loadedAt,index_load_ms:realIndex.loadMs});
  }
  if(isPgVectorType(columnType)){
    const sql=`
      SELECT v.product_uid,
             1 - (v.vector_image::vector(512) <=> $1::vector(512)) AS score,
             p.product_name,p.product_url,p.thumb_origin_url,p.mall_code,p.keyword,p.category_keyword
        FROM gm_product_image_vector v
        LEFT JOIN gm_product p ON p.product_uid=v.product_uid
       WHERE v.vector_image IS NOT NULL
         AND vector_dims(v.vector_image)=512
       ORDER BY v.vector_image::vector(512) <=> $1::vector(512)
       LIMIT $2`;
    const q=await pool.query(sql,[vectorLiteral(v),limit]);
    const matches=q.rows.map(r=>({product_uid:C(r.product_uid),score:Number(r.score||0),product_name:C(r.product_name),product_url:C(r.product_url),image_url:C(r.thumb_origin_url),mall_code:C(r.mall_code),keyword:C(r.keyword),category_keyword:C(r.category_keyword)}));
    return res.json({ok:true,count:matches.length,matches,vector_version:VECTOR_VERSION,column_type:columnType,route_version:ROUTE_VERSION,search_mode:'pgvector',search_ms:Date.now()-started});
  }
  throw new Error('unsupported vector_image type '+columnType);
 }catch(e){return res.status(500).json({ok:false,error:C(e&&e.message||e),route_version:ROUTE_VERSION,search_ms:Date.now()-started});}
});
module.exports=router;
