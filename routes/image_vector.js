/* GM_IMAGE_VECTOR_ROUTE_V017
 * V017: classification-tree Leaf search and explicit parent-ring expansion. Root/full vector search is blocked.
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
const {encodeCandidateVector,HEADER_BYTES:CANDIDATE_HEADER_BYTES,BYTE_LEN:CANDIDATE_BYTES}=require('../services/image_candidate_vector');
const imageAnn=require('../services/image_ann_index');
const DIM=512, BYTE_LEN=1024, VECTOR_VERSION=2, ROUTE_VERSION='GM_IMAGE_VECTOR_ROUTE_V017_CLASS_TREE';

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

// REAL[] production search path.
// candidate_vector is searched through the compact ANN index first. Only the
// shortlisted rows are read back from PostgreSQL, then candidate cosine and
// exact REAL[] cosine reranking are applied in two stages.
const ANN_SIGNATURE_LIMIT=Math.max(100,Math.min(2000,Number(process.env.GM_IMAGE_ANN_SIGNATURE_LIMIT||400)||400));
const ANN_EXACT_LIMIT=Math.max(20,Math.min(2000,Number(process.env.GM_IMAGE_ANN_EXACT_LIMIT||400)||400));
const KEYWORD_SCAN_LIMIT=Math.max(8,Math.min(100,Number(process.env.GM_IMAGE_KEYWORD_SCAN_LIMIT||30)||30));

function normalizedFloat32(raw){
  if(!Array.isArray(raw)||raw.length!==DIM)return null;
  const a=new Float32Array(DIM); let norm=0;
  for(let i=0;i<DIM;i++){const x=Number(raw[i]);if(!Number.isFinite(x))return null;a[i]=x;norm+=x*x;}
  if(!(norm>0))return null;
  const inv=1/Math.sqrt(norm);for(let i=0;i<DIM;i++)a[i]*=inv;return a;
}
function candidateCosine(a,b){
  if(!Buffer.isBuffer(a))a=Buffer.from(a||[]);if(!Buffer.isBuffer(b))b=Buffer.from(b||[]);
  if(a.length!==CANDIDATE_BYTES||b.length!==CANDIDATE_BYTES)return -Infinity;
  let dot=0,na=0,nb=0;
  for(let i=0;i<DIM;i++){
    const x=a.readInt8(CANDIDATE_HEADER_BYTES+i),y=b.readInt8(CANDIDATE_HEADER_BYTES+i);
    dot+=x*y;na+=x*x;nb+=y*y;
  }
  return na>0&&nb>0?dot/Math.sqrt(na*nb):-Infinity;
}
function exactCosine(queryNorm,raw){
  const v=normalizedFloat32(raw);if(!v)return -Infinity;
  let dot=0;for(let i=0;i<DIM;i++)dot+=queryNorm[i]*v[i];return dot;
}
function metaFromRow(r){
  return {product_uid:C(r.product_uid),product_id:C(r.product_id),product_name:C(r.product_name),product_url:C(r.product_url),image_url:C(r.thumb_origin_url),mall_code:C(r.mall_code),keyword:C(r.keyword),category_keyword:C(r.category_keyword)};
}
function pidFromVectorUid(raw){
  // Existing image-vector rows may contain the option identity PID_IID_VID.
  // gm_product is keyed separately and the stable PID is stored in product_id.
  // Never persist keyword/product metadata in the vector table; resolve it fresh by PID.
  const s=C(raw);if(!s)return '';
  let m=s.match(/^(?:CPKR_|ALKR_)?(\d+)(?:_|$)/i);
  if(m)return C(m[1]);
  return s;
}
function mallHintFromVectorUid(raw){
  const s=C(raw);
  if(/^CPKR_/i.test(s))return 'CPKR';
  if(/^ALKR_/i.test(s))return 'ALKR';
  if(/^\d+_\d+_\d+$/.test(s))return 'CPKR';
  return '';
}
async function fetchProductMetadata(pool,productUids){
  // Final 512-d image matches are vector-table identities. Resolve CURRENT product text
  // from gm_product by PID(product_id), not by gm_product.product_uid.
  // Example: 9591328187_28631524894_95574594581 -> PID 9591328187 -> CPKR_9591328187.
  const wanted=[];const seen=new Set();
  for(const raw of productUids||[]){
    const vectorUid=C(raw);if(!vectorUid||seen.has(vectorUid))continue;seen.add(vectorUid);
    wanted.push({vector_uid:vectorUid,product_id:pidFromVectorUid(vectorUid),mall_code:mallHintFromVectorUid(vectorUid)});
  }
  if(!wanted.length)return {byUid:new Map(),rows:[]};
  const vectorUids=wanted.map(x=>x.vector_uid),pids=wanted.map(x=>x.product_id),malls=wanted.map(x=>x.mall_code);
  const q=await pool.query(`
    WITH wanted AS (
      SELECT vector_uid, product_id, mall_code, ord
        FROM unnest($1::text[],$2::text[],$3::text[]) WITH ORDINALITY AS x(vector_uid,product_id,mall_code,ord)
    )
    SELECT w.ord,w.vector_uid AS wanted_product_uid,w.product_id AS wanted_product_id,
           p.product_uid,p.product_id,p.product_name,p.product_url,p.thumb_origin_url,p.mall_code,p.keyword,p.category_keyword
      FROM wanted w
      LEFT JOIN LATERAL (
        SELECT p.product_uid,p.product_id,p.product_name,p.product_url,p.thumb_origin_url,p.mall_code,p.keyword,p.category_keyword,
               p.updated_at,p.last_seen_at
          FROM gm_product p
         WHERE p.product_id=w.product_id
           AND (w.mall_code='' OR p.mall_code=w.mall_code)
         ORDER BY
           CASE WHEN COALESCE(p.sale_status,'active')='active' AND COALESCE(p.soldout_yn,'N')<>'Y' THEN 0 ELSE 1 END,
           COALESCE(p.updated_at,p.last_seen_at) DESC NULLS LAST,
           p.product_uid ASC
         LIMIT 1
      ) p ON TRUE
     ORDER BY w.ord`,[vectorUids,pids,malls]);
  const byUid=new Map();
  for(const r of q.rows||[]){
    if(C(r.product_uid)){
      const m=metaFromRow(r);
      m.lookup_pid=C(r.wanted_product_id);
      byUid.set(C(r.wanted_product_uid),m);
    }
  }
  return {byUid,rows:q.rows||[]};
}
async function searchCandidateAnn(pool,queryVector,limit){
  const timings={ann_build_ms:0,ann_ms:0,candidate_fetch_ms:0,candidate_rerank_ms:0,exact_fetch_ms:0,exact_rerank_ms:0,product_fetch_ms:0};
  const queryCandidate=encodeCandidateVector(queryVector);if(!queryCandidate)throw new Error('candidate vector encode failed');
  let t=Date.now();await imageAnn.build(pool,false);timings.ann_build_ms=Date.now()-t;
  t=Date.now();const ann=imageAnn.search(queryCandidate,ANN_SIGNATURE_LIMIT);timings.ann_ms=Date.now()-t;
  if(!ann.length)return {matches:[],timings,ann_count:imageAnn.status().count,signature_candidates:0,exact_candidates:0,product_rows:0};
  const signatureDistance=new Map(ann.map(x=>[C(x.product_uid),Number(x.signature_distance||0)]));
  const ids=ann.map(x=>C(x.product_uid)).filter(Boolean);
  t=Date.now();
  const cq=await pool.query(`SELECT product_uid,candidate_vector FROM gm_product_image_vector WHERE product_uid=ANY($1::text[]) AND candidate_vector IS NOT NULL`,[ids]);
  timings.candidate_fetch_ms=Date.now()-t;
  t=Date.now();
  const approx=[];
  for(const r of cq.rows||[]){
    const score=candidateCosine(queryCandidate,r.candidate_vector);if(!Number.isFinite(score))continue;
    approx.push({product_uid:C(r.product_uid),score,signature_distance:signatureDistance.get(C(r.product_uid))??64});
  }
  approx.sort((a,b)=>b.score-a.score||a.signature_distance-b.signature_distance);
  // V352: the 512-d authoritative vectors must decide the order across the whole ANN shortlist.
  // Do not throw away lower candidate-vector ranks before exact comparison.
  const exactIds=approx.slice(0,Math.max(limit,ANN_EXACT_LIMIT)).map(x=>x.product_uid);
  timings.candidate_rerank_ms=Date.now()-t;
  if(!exactIds.length)return {matches:[],timings,ann_count:imageAnn.status().count,signature_candidates:ids.length,exact_candidates:0,product_rows:0};

  // Stage 3: exact similarity uses only the authoritative 512-d REAL[] vectors.
  // Product metadata is intentionally NOT joined here because keyword/category_keyword
  // can change independently from the image vector table.
  t=Date.now();
  const eq=await pool.query(`
    SELECT product_uid,vector_image
      FROM gm_product_image_vector
     WHERE product_uid=ANY($1::text[])
       AND vector_image IS NOT NULL
       AND array_length(vector_image,1)=$2`,[exactIds,DIM]);
  timings.exact_fetch_ms=Date.now()-t;
  t=Date.now();
  const qn=normalizedFloat32(queryVector);if(!qn)throw new Error('invalid query vector');
  const exact=[];
  for(const r of eq.rows||[]){
    const score=exactCosine(qn,r.vector_image);if(Number.isFinite(score))exact.push({product_uid:C(r.product_uid),score});
  }
  exact.sort((a,b)=>b.score-a.score);
  // Keep scanning exact-ranked products until the client can form five DISTINCT keywords.
  // 8 is no longer a hard product cutoff; it is only a diagnostic display size.
  const top=exact.slice(0,Math.max(limit,KEYWORD_SCAN_LIMIT));
  timings.exact_rerank_ms=Date.now()-t;

  // Stage 4: after the final 512-d top PIDs are fixed, resolve CURRENT product data
  // from gm_product by product_uid. Nothing is copied into gm_product_image_vector.
  t=Date.now();
  const productLookup=await fetchProductMetadata(pool,top.map(x=>x.product_uid));
  timings.product_fetch_ms=Date.now()-t;
  const meta=productLookup.byUid;
  const matches=top.map(x=>{
    const m=Object.assign({},meta.get(x.product_uid)||{product_uid:x.product_uid,product_name:'',product_url:'',image_url:'',mall_code:'',keyword:'',category_keyword:''},{product_uid:x.product_uid,score:x.score});
    // Convenience field only in the RESPONSE. It is never persisted in the vector table.
    // Current gm_product keyword wins, then category_keyword, then current product_name.
    const aliases=C(m.keyword).split('|').map(C).filter(Boolean);
    m.search_keyword=C(aliases[0]||m.category_keyword||m.product_name);
    return m;
  });
  return {matches,timings,ann_count:imageAnn.status().count,signature_candidates:ids.length,exact_candidates:exactIds.length,product_rows:meta.size,product_lookup_rows:productLookup.rows.length};
}


// V017 classification-tree search.
// Important operating rule: product vectors are NEVER searched globally.
// Initial search is the selected Leaf only. Further expansion is explicit,
// one parent level at a time. The production root is blocked because its
// subtree is the whole classified population.
async function classificationPath(pool,queryVector){
  const qn=normalizedFloat32(queryVector);if(!qn)throw new Error('invalid query vector');
  const path=[];let parentId=null;
  for(let guard=0;guard<64;guard++){
    const q=parentId==null
      ? await pool.query(`SELECT id,parent_id,child_no,vector_center,is_leaf,product_count FROM gm_vector_category WHERE parent_id IS NULL ORDER BY child_no,id`)
      : await pool.query(`SELECT id,parent_id,child_no,vector_center,is_leaf,product_count FROM gm_vector_category WHERE parent_id=$1 ORDER BY child_no,id`,[parentId]);
    const rows=q.rows||[];if(!rows.length)break;
    let best=null,bestScore=-Infinity;
    for(const r of rows){const sc=exactCosine(qn,r.vector_center);if(sc>bestScore){bestScore=sc;best=r;}}
    if(!best)break;
    path.push({id:Number(best.id),parent_id:best.parent_id==null?null:Number(best.parent_id),child_no:Number(best.child_no||0),is_leaf:!!best.is_leaf,product_count:Number(best.product_count||0),center_score:Number(bestScore)});
    if(best.is_leaf)return {path,query_norm:qn};
    parentId=Number(best.id);
  }
  throw new Error(path.length?'classification path ended before leaf':'gm_vector_category is empty');
}
async function classificationLevelSearch(pool,queryVector,level,limit){
  const traversed=await classificationPath(pool,queryVector),path=traversed.path,qn=traversed.query_norm;
  const ascent=Math.max(0,Math.floor(Number(level)||0));
  const targetIndex=path.length-1-ascent;
  if(targetIndex<0)return {root_blocked:true,reason:'ABOVE_ROOT',path,search_level:ascent,matches:[]};
  const target=path[targetIndex];
  // Never scan the root subtree. That is equivalent to a full product-vector search.
  if(target.parent_id==null){
    return {root_blocked:true,reason:'ROOT_FULL_SEARCH_BLOCKED',path,search_level:ascent,target,candidate_count:Number(target.product_count||0),matches:[]};
  }
  const t0=Date.now();
  // LEVEL 0 searches the selected Leaf. Upper levels search only the newly
  // exposed sibling area, excluding the child subtree already searched below.
  // This prevents duplicate work and makes each level's best candidate meaningful.
  const excludedChild=ascent>0?path[targetIndex+1]:null;
  const q=excludedChild
    ? await pool.query(`
        WITH RECURSIVE target_subtree AS (
          SELECT id,is_leaf FROM gm_vector_category WHERE id=$1
          UNION ALL
          SELECT c.id,c.is_leaf FROM gm_vector_category c JOIN target_subtree s ON c.parent_id=s.id
        ), excluded_subtree AS (
          SELECT id,is_leaf FROM gm_vector_category WHERE id=$2
          UNION ALL
          SELECT c.id,c.is_leaf FROM gm_vector_category c JOIN excluded_subtree s ON c.parent_id=s.id
        ), leaf_ids AS (
          SELECT id FROM target_subtree WHERE is_leaf=true
          EXCEPT
          SELECT id FROM excluded_subtree WHERE is_leaf=true
        )
        SELECT v.product_uid,v.vector_image
          FROM gm_product_image_vector v
          JOIN leaf_ids l ON l.id=v.class_id
         WHERE v.vector_image IS NOT NULL
           AND array_length(v.vector_image,1)=$3`,[target.id,excludedChild.id,DIM])
    : await pool.query(`
        SELECT v.product_uid,v.vector_image
          FROM gm_product_image_vector v
         WHERE v.class_id=$1
           AND v.vector_image IS NOT NULL
           AND array_length(v.vector_image,1)=$2`,[target.id,DIM]);
  const fetchMs=Date.now()-t0,t1=Date.now(),exact=[];
  for(const r of q.rows||[]){const score=exactCosine(qn,r.vector_image);if(Number.isFinite(score))exact.push({product_uid:C(r.product_uid),score});}
  exact.sort((a,b)=>b.score-a.score);
  const ranked=exact.slice(0,Math.max(1,limit));
  const rerankMs=Date.now()-t1,t2=Date.now();
  const productLookup=await fetchProductMetadata(pool,ranked.map(x=>x.product_uid));
  const meta=productLookup.byUid;
  const matches=ranked.map((x,idx)=>{
    const m=Object.assign({},meta.get(x.product_uid)||{product_uid:x.product_uid,product_name:'',product_url:'',image_url:'',mall_code:'',keyword:'',category_keyword:''},{product_uid:x.product_uid,score:x.score});
    const aliases=C(m.keyword).split('|').map(C).filter(Boolean);
    m.search_keyword=C(aliases[0]||m.category_keyword||m.product_name);
    m.level_best=idx===0;
    return m;
  });
  const productMs=Date.now()-t2;
  const nextIndex=targetIndex-1;
  const nextTarget=nextIndex>=0?path[nextIndex]:null;
  const canSearchUpper=!!(nextTarget&&nextTarget.parent_id!=null);
  return {
    path,search_level:ascent,target,target_depth:targetIndex,excluded_child_class_id:excludedChild?excludedChild.id:null,
    candidate_count:exact.length,matches,
    can_search_upper:canSearchUpper,
    next_is_root:!!(nextTarget&&nextTarget.parent_id==null),
    root_blocked:false,
    timings:{tree_ms:0,vector_fetch_ms:fetchMs,exact_rerank_ms:rerankMs,product_fetch_ms:productMs}
  };
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
router.get('/api/gm/image-vector/version',(req,res)=>res.json({ok:true,route_version:ROUTE_VERSION,dimensions:DIM,vector_version:VECTOR_VERSION,ann:imageAnn.status()}));
router.get('/api/gm/image-vector/index-status',(req,res)=>res.json({ok:true,route_version:ROUTE_VERSION,ann:imageAnn.status()}));
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
 const pool=req.app.locals.pool,uid=C(req.body&&req.body.product_uid),v=vectorFromBase64(req.body&&req.body.vector_base64);
 if(!pool)return res.status(503).json({ok:false,error:'db unavailable'});
 if(!uid||!v)return res.status(400).json({ok:false,error:'product_uid/vector_base64(1024-byte Float16) required'});
 try{
  const columnType=await vectorColumnType(pool);
  if(isArrayVectorType(columnType)){
    const candidate=encodeCandidateVector(v);
    if(!candidate)throw new Error('candidate vector encode failed');
    await pool.query(`INSERT INTO gm_product_image_vector(product_uid,vector_image,candidate_vector) VALUES($1,$2::real[],$3::bytea) ON CONFLICT(product_uid) DO UPDATE SET vector_image=EXCLUDED.vector_image,candidate_vector=EXCLUDED.candidate_vector`,[uid,v,candidate]);
    imageAnn.markDirty();
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
 const pool=req.app.locals.pool,v=vectorFromBase64(req.body&&req.body.vector_base64),limit=Math.max(1,Math.min(30,Number(req.body&&req.body.limit||30)||30)),searchLevel=Math.max(0,Math.min(63,Number(req.body&&req.body.search_level||0)||0));
 if(!pool)return res.status(503).json({ok:false,error:'db unavailable'});
 if(!v)return res.status(400).json({ok:false,error:'vector_base64(1024-byte Float16) required'});
 const started=Date.now();
 try{
  const columnType=await vectorColumnType(pool);
  if(!isArrayVectorType(columnType)){
    // Do not fall back to pgvector ORDER BY over the whole table. Full vector search is forbidden.
    return res.status(409).json({ok:false,error:'classification search requires REAL[] production vectors; full-vector fallback is disabled',column_type:columnType,route_version:ROUTE_VERSION,search_ms:Date.now()-started});
  }
  const out=await classificationLevelSearch(pool,v,searchLevel,limit);
  const searchMs=Date.now()-started;
  if(out.root_blocked){
    console.log('[GM_IMAGE_VECTOR_CLASS_ROOT_BLOCK]',JSON.stringify({search_level:searchLevel,reason:out.reason,candidate_count:out.candidate_count||0,search_ms:searchMs,route_version:ROUTE_VERSION}));
    return res.json({ok:true,count:0,matches:[],vector_version:VECTOR_VERSION,column_type:columnType,route_version:ROUTE_VERSION,search_mode:'classification_tree_manual_parent',search_level:searchLevel,root_blocked:true,root_block_reason:out.reason,candidate_count:out.candidate_count||0,can_search_upper:false,path:out.path,search_ms:searchMs});
  }
  const metaReady=out.matches.filter(m=>C(m.keyword||m.category_keyword||m.product_name)).length;
  console.log('[GM_IMAGE_VECTOR_CLASS_SEARCH]',JSON.stringify({search_level:out.search_level,target_class_id:out.target&&out.target.id,target_depth:out.target_depth,candidate_count:out.candidate_count,count:out.matches.length,best_score:out.matches[0]?Number(Number(out.matches[0].score||0).toFixed(6)):null,can_search_upper:out.can_search_upper,next_is_root:out.next_is_root,search_ms:searchMs,timings:out.timings,route_version:ROUTE_VERSION}));
  return res.json({ok:true,count:out.matches.length,matches:out.matches,metadata_ready:metaReady,vector_version:VECTOR_VERSION,column_type:columnType,route_version:ROUTE_VERSION,search_mode:'classification_tree_manual_parent',search_level:out.search_level,target_class_id:out.target&&out.target.id,target_depth:out.target_depth,excluded_child_class_id:out.excluded_child_class_id,candidate_count:out.candidate_count,can_search_upper:out.can_search_upper,next_is_root:out.next_is_root,root_blocked:false,path:out.path,search_ms:searchMs,timings:out.timings});
 }catch(e){return res.status(500).json({ok:false,error:C(e&&e.message||e),route_version:ROUTE_VERSION,search_ms:Date.now()-started});}
});

module.exports=router;
