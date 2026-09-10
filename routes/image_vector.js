/* GM_IMAGE_VECTOR_ROUTE_V018_HNSW_TRANSITION
 * 2026-09-11
 * Permanent retirement of the old Tree/Leaf image-search path.
 * Preserved: 512D REAL[] source vectors, candidate_vector generation/storage,
 *            proxy, missing-check, and vector upsert APIs.
 * Search is intentionally blocked until representative-vector HNSW is populated.
 */
'use strict';
const express=require('express');
const https=require('https');
const http=require('http');
const router=express.Router();
const {encodeCandidateVector,BYTE_LEN:CANDIDATE_BYTES}=require('../services/image_candidate_vector');

const DIM=512;
const BYTE_LEN=1024;
const VECTOR_VERSION=2;
const ROUTE_VERSION='GM_IMAGE_VECTOR_ROUTE_V018_HNSW_TRANSITION';

let cachedVectorColumnType=null;
function C(v){return String(v==null?'':v).trim();}
function isArrayVectorType(t){return /^(real|double precision)\[\]$/.test(C(t).toLowerCase());}
function isPgVectorType(t){return /^vector(?:\(|$)/.test(C(t).toLowerCase());}

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

function halfToFloat(h){
  const s=(h&0x8000)?-1:1,e=(h>>10)&0x1f,f=h&0x03ff;
  if(e===0)return s*Math.pow(2,-14)*(f/1024);
  if(e===31)return f?NaN:s*Infinity;
  return s*Math.pow(2,e-15)*(1+f/1024);
}
function vectorFromBase64(raw){
  try{
    const b=Buffer.from(C(raw),'base64');
    if(b.length!==BYTE_LEN)return null;
    const a=new Array(DIM);let norm=0;
    for(let i=0;i<DIM;i++){
      const v=halfToFloat(b.readUInt16LE(i*2));
      if(!Number.isFinite(v))return null;
      a[i]=v;norm+=v*v;
    }
    return norm>0?a:null;
  }catch(_e){return null;}
}
function vectorLiteral(a){return '['+a.map(v=>Number(v).toPrecision(9)).join(',')+']';}

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
      try{
        const next=new URL(r.headers.location,u),safe=allowedImageUrl(next.toString());
        if(!safe)return res.status(403).json({ok:false,error:'redirect host blocked'});
        return fetchImage(safe,res,depth+1);
      }catch(_e){return res.status(502).json({ok:false,error:'bad redirect'});}
    }
    if(r.statusCode!==200){r.resume();return res.status(502).json({ok:false,error:'image upstream '+r.statusCode});}
    const ct=C(r.headers['content-type']);
    if(!/^image\//i.test(ct)){r.resume();return res.status(415).json({ok:false,error:'upstream is not image'});}
    const len=Number(r.headers['content-length']||0);
    if(len>5*1024*1024){r.resume();return res.status(413).json({ok:false,error:'image too large'});}
    res.setHeader('Content-Type',ct);
    res.setHeader('Cache-Control','public, max-age=86400');
    if(len)res.setHeader('Content-Length',String(len));
    r.pipe(res);
  });
  req.setTimeout(8000,()=>req.destroy(new Error('timeout')));
  req.on('error',e=>{
    if(!res.headersSent)res.status(502).json({ok:false,error:C(e&&e.message||e)});
    else try{res.end();}catch(_e){}
  });
}

router.get('/api/gm/image-vector/proxy',(req,res)=>{
  const u=allowedImageUrl(req.query&&req.query.url);
  if(!u)return res.status(400).json({ok:false,error:'unsupported image url'});
  fetchImage(u,res,0);
});

router.get('/api/gm/image-vector/version',async(req,res)=>{
  const pool=req.app.locals.pool;
  if(!pool)return res.status(503).json({ok:false,error:'db unavailable',route_version:ROUTE_VERSION});
  try{
    const q=await pool.query(`
      SELECT
        EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector') AS vector_extension,
        EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='gm_product_image_vector' AND column_name='search_vector_no') AS representative_column,
        EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='gm_product_image_vector' AND column_name='search_vector') AS vector_column,
        EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname=current_schema() AND tablename='gm_product_image_vector' AND indexname='idx_gm_product_image_vector_search_hnsw') AS hnsw_index`);
    const st=q.rows[0]||{};
    return res.json({
      ok:true,route_version:ROUTE_VERSION,dimensions:DIM,vector_version:VECTOR_VERSION,
      source_storage:'REAL[]',search_mode:'HNSW_TRANSITION',...st,
      search_ready:Boolean(st.vector_extension&&st.vector_column&&st.hnsw_index)
    });
  }catch(e){return res.status(500).json({ok:false,error:C(e&&e.message||e),route_version:ROUTE_VERSION});}
});

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
  const pool=req.app.locals.pool;
  const uid=C(req.body&&req.body.product_uid);
  const v=vectorFromBase64(req.body&&req.body.vector_base64);
  if(!pool)return res.status(503).json({ok:false,error:'db unavailable'});
  if(!uid||!v)return res.status(400).json({ok:false,error:'product_uid/vector_base64(1024-byte Float16) required'});
  try{
    const columnType=await vectorColumnType(pool);
    const candidate=encodeCandidateVector(v);
    if(!candidate)throw new Error('candidate vector encode failed');
    if(isArrayVectorType(columnType)){
      await pool.query(`INSERT INTO gm_product_image_vector(product_uid,vector_image,candidate_vector) VALUES($1,$2::real[],$3::bytea) ON CONFLICT(product_uid) DO UPDATE SET vector_image=EXCLUDED.vector_image,candidate_vector=EXCLUDED.candidate_vector`,[uid,v,candidate]);
    }else if(isPgVectorType(columnType)){
      await pool.query(`INSERT INTO gm_product_image_vector(product_uid,vector_image,candidate_vector) VALUES($1,$2::vector,$3::bytea) ON CONFLICT(product_uid) DO UPDATE SET vector_image=EXCLUDED.vector_image,candidate_vector=EXCLUDED.candidate_vector`,[uid,vectorLiteral(v),candidate]);
    }else{
      throw new Error('unsupported vector_image type '+columnType);
    }
    return res.json({ok:true,product_uid:uid,dimensions:DIM,bytes:BYTE_LEN,candidate_bytes:CANDIDATE_BYTES,candidate_format:'INT8_V1',vector_version:VECTOR_VERSION,column_type:columnType,route_version:ROUTE_VERSION});
  }catch(e){return res.status(500).json({ok:false,error:C(e&&e.message||e),route_version:ROUTE_VERSION});}
});

router.post('/api/gm/image-vector/search',(req,res)=>{
  return res.status(409).json({
    ok:false,
    error:'HNSW_NOT_READY',
    detail:'Tree/Leaf search is retired. Representative-vector HNSW must be built before search is enabled.',
    route_version:ROUTE_VERSION,
    search_mode:'HNSW_TRANSITION'
  });
});

module.exports=router;
