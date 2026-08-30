/* GM_IMAGE_VECTOR_ROUTE_V006
 * V342: supports the production legacy REAL[] column before migration as well as pgvector `vector`.
 *       /missing checks 512 dimensions with the correct function for the actual column type.
 *       /upsert/search also work during the REAL[] -> vector migration window.
 * V336: 512-d MobileCLIP image embeddings using pgvector `vector` (not halfvec).
 * Existing non-512 vectors are treated as stale by /missing and are lazily rebuilt.
 * Client sends Float16 binary as base64 (exactly 1024 decoded bytes).
 * Legacy rows/product_uid are preserved; only a searched stale vector is replaced on upsert.
 */
const express=require('express');
const https=require('https');
const http=require('http');
const router=express.Router();
const DIM=512, BYTE_LEN=1024, VECTOR_VERSION=2;

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
router.post('/api/gm/image-vector/missing',async(req,res)=>{
 const pool=req.app.locals.pool;
 const raw=Array.isArray(req.body&&req.body.product_uids)?req.body.product_uids:[];
 const ids=[...new Set(raw.map(C).filter(Boolean))].slice(0,200);
 if(!pool)return res.status(503).json({ok:false,error:'db unavailable'});
 if(!ids.length)return res.json({ok:true,missing:[],existing:[],vector_version:VECTOR_VERSION});
 try{
  const columnType=await vectorColumnType(pool);
  let sql;
  if(isArrayVectorType(columnType)){
    sql='SELECT product_uid FROM gm_product_image_vector WHERE product_uid = ANY($1::text[]) AND vector_image IS NOT NULL AND array_length(vector_image,1) = $2';
  }else if(isPgVectorType(columnType)){
    sql='SELECT product_uid FROM gm_product_image_vector WHERE product_uid = ANY($1::text[]) AND vector_image IS NOT NULL AND vector_dims(vector_image) = $2';
  }else{
    return res.json({ok:true,existing:[],missing:ids,dimensions:DIM,vector_version:VECTOR_VERSION,column_type:columnType});
  }
  const q=await pool.query(sql,[ids,DIM]);
  const have=new Set(q.rows.map(r=>C(r.product_uid)));
  return res.json({ok:true,existing:ids.filter(x=>have.has(x)),missing:ids.filter(x=>!have.has(x)),dimensions:DIM,vector_version:VECTOR_VERSION,column_type:columnType});
 }catch(e){return res.status(500).json({ok:false,error:C(e&&e.message||e)});}
});
router.post('/api/gm/image-vector/upsert',async(req,res)=>{
 const pool=req.app.locals.pool,uid=C(req.body&&req.body.product_uid),v=vectorFromBase64(req.body&&req.body.vector_base64);
 if(!pool)return res.status(503).json({ok:false,error:'db unavailable'});
 if(!uid||!v)return res.status(400).json({ok:false,error:'product_uid/vector_base64(1024-byte Float16) required'});
 try{
  const columnType=await vectorColumnType(pool);
  if(isArrayVectorType(columnType)){
    await pool.query(`INSERT INTO gm_product_image_vector(product_uid,vector_image) VALUES($1,$2::real[]) ON CONFLICT(product_uid) DO UPDATE SET vector_image=EXCLUDED.vector_image`,[uid,v]);
  }else if(isPgVectorType(columnType)){
    await pool.query(`INSERT INTO gm_product_image_vector(product_uid,vector_image) VALUES($1,$2::vector) ON CONFLICT(product_uid) DO UPDATE SET vector_image=EXCLUDED.vector_image`,[uid,vectorLiteral(v)]);
  }else{
    throw new Error('unsupported vector_image type '+columnType);
  }
  return res.json({ok:true,product_uid:uid,dimensions:DIM,bytes:BYTE_LEN,vector_version:VECTOR_VERSION,column_type:columnType});
 }catch(e){return res.status(500).json({ok:false,error:C(e&&e.message||e)});}
});
router.post('/api/gm/image-vector/search',async(req,res)=>{
 const pool=req.app.locals.pool,v=vectorFromBase64(req.body&&req.body.vector_base64),limit=Math.max(1,Math.min(20,Number(req.body&&req.body.limit||8)||8));
 if(!pool)return res.status(503).json({ok:false,error:'db unavailable'});
 if(!v)return res.status(400).json({ok:false,error:'vector_base64(1024-byte Float16) required'});
 try{
  const columnType=await vectorColumnType(pool);
  let sql;
  if(isArrayVectorType(columnType)){
    // Transitional REAL[] path. Convert only valid 512-d rows to pgvector for comparison.
    // This is indexless but keeps image search functional until migration 109 is executed.
    sql=`
      SELECT v.product_uid,
             1 - ((('[' || array_to_string(v.vector_image, ',') || ']')::vector(512)) <=> $1::vector(512)) AS score,
             p.product_name,p.product_url,p.thumb_origin_url,p.mall_code
        FROM gm_product_image_vector v
        LEFT JOIN gm_product p ON p.product_uid=v.product_uid
       WHERE v.vector_image IS NOT NULL
         AND array_length(v.vector_image,1)=512
       ORDER BY (('[' || array_to_string(v.vector_image, ',') || ']')::vector(512)) <=> $1::vector(512)
       LIMIT $2`;
  }else if(isPgVectorType(columnType)){
    sql=`
      SELECT v.product_uid,
             1 - (v.vector_image::vector(512) <=> $1::vector(512)) AS score,
             p.product_name,p.product_url,p.thumb_origin_url,p.mall_code
        FROM gm_product_image_vector v
        LEFT JOIN gm_product p ON p.product_uid=v.product_uid
       WHERE v.vector_image IS NOT NULL
         AND vector_dims(v.vector_image)=512
       ORDER BY v.vector_image::vector(512) <=> $1::vector(512)
       LIMIT $2`;
  }else{
    throw new Error('unsupported vector_image type '+columnType);
  }
  const q=await pool.query(sql,[vectorLiteral(v),limit]);
  const matches=q.rows.map(r=>({product_uid:C(r.product_uid),score:Number(r.score||0),product_name:C(r.product_name),product_url:C(r.product_url),image_url:C(r.thumb_origin_url),mall_code:C(r.mall_code)}));
  return res.json({ok:true,count:matches.length,matches,vector_version:VECTOR_VERSION,column_type:columnType});
 }catch(e){return res.status(500).json({ok:false,error:C(e&&e.message||e)});}
});
module.exports=router;
