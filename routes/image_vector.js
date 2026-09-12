/* GM_IMAGE_VECTOR_ROUTE_V029_ALI_OPTION_IDENTITY
 * Representative-net image search only.
 * FAST: HNSW over current-run representatives -> member vectors -> exact cosine rerank.
 * PRECISE: exact cosine over all current-run representatives -> member vectors -> exact cosine rerank.
 * Legacy candidate ANN / classification Tree-Leaf / upper-level search paths are removed.
 * gm_product_image_vector.vector_image remains the authoritative 512D source.
 */
const express=require('express');
const https=require('https');
const http=require('http');
const router=express.Router();
const {RepresentativeHnsw}=require('../services/image_representative_hnsw');
const {upsertImageVector}=require('../services/image_vector_write');
const DIM=512, BYTE_LEN=1024, VECTOR_VERSION=2, ROUTE_VERSION='GM_IMAGE_VECTOR_ROUTE_V029_ALI_OPTION_IDENTITY';

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


function normalizedFloat32(raw){
  if(!Array.isArray(raw)||raw.length!==DIM)return null;
  const a=new Float32Array(DIM); let norm=0;
  for(let i=0;i<DIM;i++){const x=Number(raw[i]);if(!Number.isFinite(x))return null;a[i]=x;norm+=x*x;}
  if(!(norm>0))return null;
  const inv=1/Math.sqrt(norm);for(let i=0;i<DIM;i++)a[i]*=inv;return a;
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
function preciseOptionIdentity(raw){
  const s=C(raw);
  if(/^(?:CPKR_|ALKR_)\d+_\d+(?:_\d+)?$/i.test(s))return s.replace(/^(?:CPKR_|ALKR_)/i,'');
  if(/^\d+_\d+_\d+$/.test(s))return s;
  return '';
}
async function fetchProductMetadata(pool,productUids){
  // Final 512-d image matches are vector-table identities. Resolve CURRENT product text
  // from gm_product by PID(product_id), not by gm_product.product_uid.
  // Example: 9591328187_28631524894_95574594581 -> PID 9591328187 -> CPKR_9591328187.
  const wanted=[];const seen=new Set();
  for(const raw of productUids||[]){
    const vectorUid=C(raw);if(!vectorUid||seen.has(vectorUid))continue;seen.add(vectorUid);
    wanted.push({vector_uid:vectorUid,product_id:pidFromVectorUid(vectorUid),mall_code:mallHintFromVectorUid(vectorUid),pi_ii_vi:preciseOptionIdentity(vectorUid)});
  }
  if(!wanted.length)return {byUid:new Map(),rows:[]};
  const vectorUids=wanted.map(x=>x.vector_uid),pids=wanted.map(x=>x.product_id),malls=wanted.map(x=>x.mall_code),pis=wanted.map(x=>x.pi_ii_vi);
  const q=await pool.query(`
    WITH wanted AS (
      SELECT vector_uid, product_id, mall_code, pi_ii_vi, ord
        FROM unnest($1::text[],$2::text[],$3::text[],$4::text[]) WITH ORDINALITY AS x(vector_uid,product_id,mall_code,pi_ii_vi,ord)
    )
    SELECT w.ord,w.vector_uid AS wanted_product_uid,w.product_id AS wanted_product_id,
           p.product_uid,p.product_id,p.product_name,p.product_url,p.thumb_origin_url,p.mall_code,p.keyword,p.category_keyword
      FROM wanted w
      LEFT JOIN LATERAL (
        SELECT p.product_uid,p.product_id,p.product_name,p.product_url,p.thumb_origin_url,p.mall_code,p.keyword,p.category_keyword,
               p.updated_at,p.last_seen_at
          FROM gm_product p
         WHERE p.product_uid=w.vector_uid
            OR (w.pi_ii_vi<>'' AND p.pi_ii_vi=w.pi_ii_vi AND (w.mall_code='' OR p.mall_code=w.mall_code))
            OR (w.pi_ii_vi='' AND p.product_id=w.product_id AND (w.mall_code='' OR p.mall_code=w.mall_code))
         ORDER BY
           CASE WHEN p.product_uid=w.vector_uid THEN 0 WHEN w.pi_ii_vi<>'' AND p.pi_ii_vi=w.pi_ii_vi THEN 1 ELSE 2 END,
           CASE WHEN COALESCE(p.sale_status,'active')='active' AND COALESCE(p.soldout_yn,'N')<>'Y' THEN 0 ELSE 1 END,
           COALESCE(p.updated_at,p.last_seen_at) DESC NULLS LAST,
           p.product_uid ASC
         LIMIT 1
      ) p ON TRUE
     ORDER BY w.ord`,[vectorUids,pids,malls,pis]);
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
// Legacy candidate ANN and classification Tree/Leaf search removed.

// Representative-net search cache.
// IMPORTANT: FAST searches never rebuild a whole HNSW inside the request path.
// A stale snapshot remains serviceable while a replacement snapshot is built asynchronously.
// On process cold-start (no usable snapshot yet), FAST returns INDEX_WARMING instead of turning
// that user request into an unbounded full-network rebuild. PRECISE may wait for representative
// rows because an exact representative scan is the explicit purpose of that mode.
const REP_GROUP_LIMIT=Math.max(3,Math.min(100,Number(process.env.GM_IMAGE_REP_GROUP_LIMIT||20)||20));
const RUN0_LIMIT=Math.max(3,Math.min(100,Number(process.env.GM_IMAGE_RUN0_LIMIT||20)||20));
let representativeCache={run_no:0,epoch:0,count:0,stamp:'',rows:[],loaded_at:0};
let representativeHnswCache={run_no:0,epoch:0,count:0,stamp:'',index:null,built_at:0,build_ms:0};
let run0Cache={epoch:0,count:0,stamp:'',rows:[],loaded_at:0};
let run0HnswCache={epoch:0,count:0,stamp:'',index:null,built_at:0,build_ms:0};
let representativeRefreshPromise=null,run0RefreshPromise=null;
let lastIndexError='';
async function runtimeConfig(pool,key,def){
  const q=await pool.query('SELECT config_value FROM gm_runtime_config WHERE config_key=$1',[key]);
  return q.rows&&q.rows.length?C(q.rows[0].config_value):C(def);
}
async function currentRepresentativeRun(pool){const target=await runtimeConfig(pool,'image_vector_representative_run','1');return Math.max(1,Math.trunc(Number(await runtimeConfig(pool,'image_vector_representative_live_run',target))||1));}
async function liveEpoch(pool){return Math.max(0,Math.trunc(Number(await runtimeConfig(pool,'image_vector_representative_live_epoch','0'))||0));}
// Capture LIVE RUN + topology epoch + map metadata in ONE PostgreSQL statement/snapshot.
// Separate config queries can straddle an atomic Builder publish and manufacture a mixed generation.
async function representativeMeta(pool){
  const q=await pool.query(`WITH cfg AS (
      SELECT COALESCE(MAX(config_value) FILTER (WHERE config_key='image_vector_representative_live_run'),
                      MAX(config_value) FILTER (WHERE config_key='image_vector_representative_run'),'1') AS run_value,
             COALESCE(MAX(config_value) FILTER (WHERE config_key='image_vector_representative_live_epoch'),'0') AS epoch_value
        FROM gm_runtime_config
    ), live AS (
      SELECT GREATEST(1,COALESCE(NULLIF(run_value,'')::int,1)) AS run_no,
             GREATEST(0,COALESCE(NULLIF(epoch_value,'')::bigint,0)) AS epoch
        FROM cfg
    )
    SELECT live.run_no,live.epoch,COUNT(m.*)::int AS n,COALESCE(MAX(m.updated_at)::text,'') AS stamp
      FROM live
      LEFT JOIN gm_image_vector_representative_map m
        ON m.run_no=live.run_no AND m.representative_puid IS NOT NULL AND m.puid=m.representative_puid
      LEFT JOIN gm_product_image_vector v
        ON v.product_uid=m.representative_puid AND v.vector_image IS NOT NULL AND array_length(v.vector_image,1)=${DIM}
     WHERE m.puid IS NULL OR v.product_uid IS NOT NULL
     GROUP BY live.run_no,live.epoch`);
  const r=q.rows&&q.rows[0]||{};
  return {run_no:Math.max(1,Math.trunc(Number(r.run_no)||1)),epoch:Math.max(0,Math.trunc(Number(r.epoch)||0)),count:Number(r.n||0),stamp:C(r.stamp)};
}
async function run0Meta(pool){
  const q=await pool.query(`WITH cfg AS (
      SELECT COALESCE(MAX(config_value) FILTER (WHERE config_key='image_vector_representative_run0_epoch'),'0') AS epoch_value
        FROM gm_runtime_config
    ), live AS (
      SELECT GREATEST(0,COALESCE(NULLIF(epoch_value,'')::bigint,0)) AS epoch FROM cfg
    )
    SELECT live.epoch,COUNT(v.product_uid)::int AS n,COALESCE(MAX(m.updated_at) FILTER (WHERE v.product_uid IS NOT NULL)::text,'') AS stamp
      FROM live
      LEFT JOIN gm_image_vector_representative_map m ON m.run_no=0
      LEFT JOIN gm_product_image_vector v ON v.product_uid=m.puid AND v.vector_image IS NOT NULL AND array_length(v.vector_image,1)=${DIM}
     GROUP BY live.epoch`);
  const r=q.rows&&q.rows[0]||{};
  return {epoch:Math.max(0,Math.trunc(Number(r.epoch)||0)),count:Number(r.n||0),stamp:C(r.stamp)};
}
async function assertSearchGeneration(pool,expected){
  const now=await representativeMeta(pool);
  if(now.run_no!==expected.run_no||now.epoch!==expected.epoch){
    const e=warmingError('representative');
    e.expected_generation={run_no:expected.run_no,epoch:expected.epoch};
    e.current_generation={run_no:now.run_no,epoch:now.epoch};
    throw e;
  }
  return now;
}
async function assertRun0Generation(pool,expected){
  const now=await run0Meta(pool);
  if(now.epoch!==expected.epoch||now.count!==expected.count||now.stamp!==expected.stamp){
    const e=warmingError('run0');
    e.expected_generation={epoch:expected.epoch,count:expected.count,stamp:expected.stamp};
    e.current_generation={epoch:now.epoch,count:now.count,stamp:now.stamp};
    throw e;
  }
  return now;
}
function sameRepSnapshot(meta){return representativeCache.run_no===meta.run_no&&representativeCache.epoch===meta.epoch&&representativeCache.count===meta.count&&representativeCache.stamp===meta.stamp&&representativeCache.rows.length===meta.count&&representativeHnswCache.index&&representativeHnswCache.run_no===meta.run_no&&representativeHnswCache.epoch===meta.epoch&&representativeHnswCache.count===meta.count&&representativeHnswCache.stamp===meta.stamp;}
function sameRun0Snapshot(meta){return run0Cache.epoch===meta.epoch&&run0Cache.count===meta.count&&run0Cache.stamp===meta.stamp&&run0Cache.rows.length===meta.count&&((meta.count===0)||!!run0HnswCache.index)&&run0HnswCache.epoch===meta.epoch&&run0HnswCache.count===meta.count&&run0HnswCache.stamp===meta.stamp;}
async function rebuildRepresentativeSnapshot(pool,meta){
  const started=Date.now();
  const q=await pool.query(`SELECT m.representative_no,m.representative_puid,v.vector_image
      FROM gm_image_vector_representative_map m
      JOIN gm_product_image_vector v ON v.product_uid=m.representative_puid
     WHERE m.run_no=$1 AND m.representative_puid IS NOT NULL AND m.puid=m.representative_puid
       AND v.vector_image IS NOT NULL AND array_length(v.vector_image,1)=$2
     ORDER BY m.representative_no`,[meta.run_no,DIM]);
  const rows=[];
  for(const r of q.rows||[]){const v=normalizedFloat32(r.vector_image);if(v)rows.push({representative_no:Number(r.representative_no||0),representative_puid:C(r.representative_puid),vector:v});}
  const index=new RepresentativeHnsw();if(rows.length)await index.buildAsync(rows,Math.max(1,Number(process.env.GM_IMAGE_HNSW_BUILD_YIELD_EVERY||20)||20));
  // Recheck metadata. Never publish a snapshot that became stale while it was being built.
  const after=await representativeMeta(pool);
  if(after.run_no!==meta.run_no||after.epoch!==meta.epoch){console.log('[GM_IMAGE_VECTOR_REP_HNSW_DISCARD_RUN_SWITCH]',JSON.stringify({requested:meta,after,route_version:ROUTE_VERSION}));return false;}
  // Count/stamp may advance continuously while vectors arrive. Publish this coherent snapshot
  // instead of starving FAST search; the next metadata check immediately schedules the next snapshot.
  representativeCache={run_no:meta.run_no,epoch:meta.epoch,count:rows.length,stamp:meta.stamp,rows,loaded_at:Date.now()};
  representativeHnswCache={run_no:meta.run_no,epoch:meta.epoch,count:rows.length,stamp:meta.stamp,index:rows.length?index:null,built_at:Date.now(),build_ms:Date.now()-started};
  console.log('[GM_IMAGE_VECTOR_REP_HNSW_BACKGROUND_BUILD]',JSON.stringify({run_no:meta.run_no,count:rows.length,build_ms:representativeHnswCache.build_ms,status:index.status(),route_version:ROUTE_VERSION}));
  return true;
}
async function rebuildRun0Snapshot(pool,meta){
  const started=Date.now();
  const q=await pool.query(`SELECT m.puid,v.vector_image FROM gm_image_vector_representative_map m JOIN gm_product_image_vector v ON v.product_uid=m.puid
    WHERE m.run_no=0 AND v.vector_image IS NOT NULL AND array_length(v.vector_image,1)=$1 ORDER BY m.puid`,[DIM]);
  const rows=[];let no=0;for(const r of q.rows||[]){const v=normalizedFloat32(r.vector_image);if(v)rows.push({representative_no:--no,representative_puid:C(r.puid),vector:v});}
  const index=new RepresentativeHnsw();if(rows.length)await index.buildAsync(rows,Math.max(1,Number(process.env.GM_IMAGE_HNSW_BUILD_YIELD_EVERY||20)||20));
  const after=await run0Meta(pool);
  // RUN0 membership can change without changing the representative topology epoch. Never publish
  // a snapshot whose count/stamp changed while it was being built, otherwise a search can silently
  // omit a product that just entered RUN0 (or query a stale RUN0 generation).
  if(after.epoch!==meta.epoch||after.count!==meta.count||after.stamp!==meta.stamp){
    console.log('[GM_IMAGE_VECTOR_RUN0_HNSW_DISCARD_STALE]',JSON.stringify({requested:meta,after,route_version:ROUTE_VERSION}));
    return false;
  }
  run0Cache={epoch:meta.epoch,count:rows.length,stamp:meta.stamp,rows,loaded_at:Date.now()};
  run0HnswCache={epoch:meta.epoch,count:rows.length,stamp:meta.stamp,index:rows.length?index:null,built_at:Date.now(),build_ms:Date.now()-started};
  console.log('[GM_IMAGE_VECTOR_RUN0_HNSW_BACKGROUND_BUILD]',JSON.stringify({count:rows.length,build_ms:run0HnswCache.build_ms,status:index.status(),route_version:ROUTE_VERSION}));
  return true;
}
function scheduleRepresentativeRefresh(pool,meta){
  if(representativeRefreshPromise)return representativeRefreshPromise;
  representativeRefreshPromise=(async()=>{try{lastIndexError='';await rebuildRepresentativeSnapshot(pool,meta);}catch(e){lastIndexError=C(e&&e.message||e);console.error('[GM_IMAGE_VECTOR_REP_HNSW_BACKGROUND_FAIL]',lastIndexError);}finally{representativeRefreshPromise=null;}})();
  return representativeRefreshPromise;
}
function scheduleRun0Refresh(pool,meta){
  if(run0RefreshPromise)return run0RefreshPromise;
  run0RefreshPromise=(async()=>{try{lastIndexError='';await rebuildRun0Snapshot(pool,meta);}catch(e){lastIndexError=C(e&&e.message||e);console.error('[GM_IMAGE_VECTOR_RUN0_HNSW_BACKGROUND_FAIL]',lastIndexError);}finally{run0RefreshPromise=null;}})();
  return run0RefreshPromise;
}
async function ensureSearchSnapshots(pool,{precise=false}={}){
  const repMeta=await representativeMeta(pool),r0Meta=await run0Meta(pool);
  if(!sameRepSnapshot(repMeta)){
    const p=scheduleRepresentativeRefresh(pool,repMeta);
    // PRECISE explicitly requests an all-representative exact scan, so on cold start it can
    // wait for representative rows. FAST never waits for this whole-index build.
    if(precise)await p;
  }
  if(!sameRun0Snapshot(r0Meta))scheduleRun0Refresh(pool,r0Meta);
  return {repMeta,r0Meta};
}
function topRepresentativeMatches(queryNorm,rows,limit){
  const out=[];for(const r of rows||[]){let dot=0;for(let i=0;i<DIM;i++)dot+=queryNorm[i]*r.vector[i];if(!Number.isFinite(dot))continue;if(out.length<limit){out.push({representative_no:r.representative_no,representative_puid:r.representative_puid,score:dot});out.sort((a,b)=>b.score-a.score);continue;}if(dot<=out[out.length-1].score)continue;out[out.length-1]={representative_no:r.representative_no,representative_puid:r.representative_puid,score:dot};out.sort((a,b)=>b.score-a.score);}return out;
}
function warmingError(kind){const e=new Error(kind+' index warming');e.code='INDEX_WARMING';e.index_kind=kind;return e;}

async function representativeNetSearch(pool,queryVector,limit,searchMode){
  searchMode=searchMode==='precise'?'precise':'fast';
  const timings={representative_cache_ms:0,hnsw_build_ms:0,representative_scan_ms:0,representative_search_ms:0,run0_cache_ms:0,run0_hnsw_ms:0,run0_search_ms:0,map_fetch_ms:0,vector_fetch_ms:0,exact_rerank_ms:0,product_fetch_ms:0};
  const qn=normalizedFloat32(queryVector);if(!qn)throw new Error('invalid query vector');
  let t=Date.now();const metas=await ensureSearchSnapshots(pool,{precise:searchMode==='precise'});timings.representative_cache_ms=Date.now()-t;
  const snap=representativeCache;
  // Full Builder publish may replace the whole map while reusing the same RUN.
  // An old-generation HNSW must never select representative IDs against the new map.
  if(snap.epoch!==metas.repMeta.epoch||representativeHnswCache.epoch!==metas.repMeta.epoch)throw warmingError('representative');
  if(!snap.rows.length||snap.run_no!==metas.repMeta.run_no){if(metas.repMeta.count===0)throw new Error('representative map is empty; build representative data first');throw warmingError('representative');}
  let repTop=[];
  if(searchMode==='precise'){
    t=Date.now();repTop=topRepresentativeMatches(qn,snap.rows,REP_GROUP_LIMIT);timings.representative_scan_ms=Date.now()-t;timings.representative_search_ms=timings.representative_scan_ms;
  }else{
    const hc=representativeHnswCache;if(!hc.index||hc.run_no!==snap.run_no)throw warmingError('representative');
    t=Date.now();repTop=hc.index.search(qn,REP_GROUP_LIMIT);timings.representative_search_ms=Date.now()-t;
  }
  const repIds=repTop.map(x=>x.representative_puid);
  const r0snap=run0Cache;let run0Top=[];
  if(metas.r0Meta.count>0){
    // Unlike representative topology, RUN0 membership may change without bumping live_epoch.
    // Require count/stamp freshness too; otherwise a newly-excluded vector can be missing until
    // a later request happens to finish the asynchronous RUN0 rebuild.
    if(!sameRun0Snapshot(metas.r0Meta))throw warmingError('run0');
    if(!run0HnswCache.index){if(!r0snap.rows.length)throw warmingError('run0');}
    else{t=Date.now();run0Top=run0HnswCache.index.search(qn,RUN0_LIMIT);timings.run0_search_ms=Date.now()-t;}
  }
  const run0Ids=run0Top.map(x=>x.representative_puid);
  t=Date.now();
  const mq=await pool.query(`SELECT puid,representative_no,representative_puid,run_no
      FROM gm_image_vector_representative_map
     WHERE (run_no=$1 AND representative_puid=ANY($2::text[]))
        OR (run_no=0 AND puid=ANY($3::text[]))`,[snap.run_no,repIds,run0Ids]);
  timings.map_fetch_ms=Date.now()-t;
  const candidateIds=[],seen=new Set();let run0Count=0;
  for(const r of mq.rows||[]){const id=C(r.puid);if(!id||seen.has(id))continue;seen.add(id);candidateIds.push(id);if(Number(r.run_no||0)===0)run0Count++;}
  t=Date.now();
  const vq=candidateIds.length?await pool.query(`SELECT product_uid,vector_image FROM gm_product_image_vector
      WHERE product_uid=ANY($1::text[]) AND vector_image IS NOT NULL AND array_length(vector_image,1)=$2`,[candidateIds,DIM]):{rows:[]};
  timings.vector_fetch_ms=Date.now()-t;
  t=Date.now();const exact=[];
  for(const r of vq.rows||[]){const score=exactCosine(qn,r.vector_image);if(Number.isFinite(score))exact.push({product_uid:C(r.product_uid),score});}
  exact.sort((a,b)=>b.score-a.score);const ranked=exact.slice(0,Math.max(1,limit));timings.exact_rerank_ms=Date.now()-t;
  t=Date.now();const productLookup=await fetchProductMetadata(pool,ranked.map(x=>x.product_uid));timings.product_fetch_ms=Date.now()-t;
  // A representative mutation/full publish can commit after the initial epoch check while this
  // request is fetching members/vectors. Recheck after all DB reads so an old HNSW generation
  // is never returned together with a newer representative map.
  await assertSearchGeneration(pool,metas.repMeta);
  // RUN0 has its own count/stamp generation because ordinary member -> RUN0 transitions do not
  // necessarily alter representative topology epoch. Reject a result if RUN0 changed mid-search.
  await assertRun0Generation(pool,metas.r0Meta);
  const matches=ranked.map((x,idx)=>{const m=Object.assign({},productLookup.byUid.get(x.product_uid)||{product_uid:x.product_uid,product_name:'',product_url:'',image_url:'',mall_code:'',keyword:'',category_keyword:''},{product_uid:x.product_uid,score:x.score});const aliases=C(m.keyword).split('|').map(C).filter(Boolean);m.search_keyword=C(aliases[0]||m.category_keyword||m.product_name);m.level_best=idx===0;return m;});
  return {search_mode:searchMode,run_no:snap.run_no,representative_count:snap.rows.length,representative_candidates:repTop,run0_total:metas.r0Meta.count,run0_candidates:run0Top,member_candidate_count:candidateIds.length,run0_candidate_count:run0Count,matches,timings,hnsw_status:searchMode==='fast'&&representativeHnswCache.index?representativeHnswCache.index.status():null,run0_hnsw_status:run0HnswCache.index?run0HnswCache.index.status():null};
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
router.get('/api/gm/image-vector/version',async(req,res)=>{const pool=req.app.locals.pool;if(pool)ensureSearchSnapshots(pool).catch(()=>{});res.json({ok:true,route_version:ROUTE_VERSION,dimensions:DIM,vector_version:VECTOR_VERSION,representative_hnsw:representativeHnswCache.index?representativeHnswCache.index.status():{count:0},run0_hnsw:run0HnswCache.index?run0HnswCache.index.status():{count:0},refreshing:{representative:!!representativeRefreshPromise,run0:!!run0RefreshPromise},last_index_error:lastIndexError});});
router.get('/api/gm/image-vector/index-status',async(req,res)=>{const pool=req.app.locals.pool;if(pool)ensureSearchSnapshots(pool).catch(()=>{});res.json({ok:true,route_version:ROUTE_VERSION,representative_hnsw:representativeHnswCache.index?representativeHnswCache.index.status():{count:0},run0_hnsw:run0HnswCache.index?run0HnswCache.index.status():{count:0},refreshing:{representative:!!representativeRefreshPromise,run0:!!run0RefreshPromise},last_index_error:lastIndexError});});
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
  // One DB transaction owns vector persistence + representative-map follow-up.
  const write=await upsertImageVector(pool,{product_uid:uid,vector_image:v});
  const columnType=write.column_type,representative=write.representative_assignment;
  if(!representative||representative.cache_action!=='keep')ensureSearchSnapshots(pool).catch(e=>{lastIndexError=C(e&&e.message||e);});
  console.log('[GM_IMAGE_VECTOR_REP_ASSIGN]',JSON.stringify({product_uid:uid,assignment:representative,route_version:ROUTE_VERSION}));
  return res.json({ok:true,product_uid:uid,dimensions:DIM,bytes:BYTE_LEN,vector_version:VECTOR_VERSION,column_type:columnType,representative_assignment:representative,route_version:ROUTE_VERSION});
 }catch(e){return res.status(500).json({ok:false,error:C(e&&e.message||e),route_version:ROUTE_VERSION});}
});
router.post('/api/gm/image-vector/search',async(req,res)=>{
 const pool=req.app.locals.pool,v=vectorFromBase64(req.body&&req.body.vector_base64),limit=Math.max(1,Math.min(30,Number(req.body&&req.body.limit||30)||30)),searchMode=C(req.body&&req.body.search_mode).toLowerCase()==='precise'?'precise':'fast';
 if(!pool)return res.status(503).json({ok:false,error:'db unavailable'});
 if(!v)return res.status(400).json({ok:false,error:'vector_base64(1024-byte Float16) required'});
 const started=Date.now();
 try{
  const columnType=await vectorColumnType(pool);
  if(!isArrayVectorType(columnType))return res.status(409).json({ok:false,error:'representative search requires REAL[] production vectors',column_type:columnType,route_version:ROUTE_VERSION,search_ms:Date.now()-started});
  const out=await representativeNetSearch(pool,v,limit,searchMode),searchMs=Date.now()-started;
  const metaReady=out.matches.filter(m=>C(m.keyword||m.category_keyword||m.product_name)).length;
  console.log('[GM_IMAGE_VECTOR_REP_SEARCH]',JSON.stringify({mode:out.search_mode,run_no:out.run_no,representative_count:out.representative_count,rep_groups:out.representative_candidates.length,member_candidates:out.member_candidate_count,run0_candidates:out.run0_candidate_count,count:out.matches.length,best_score:out.matches[0]?Number(Number(out.matches[0].score||0).toFixed(6)):null,search_ms:searchMs,timings:out.timings,hnsw:out.hnsw_status,route_version:ROUTE_VERSION}));
  return res.json({ok:true,count:out.matches.length,matches:out.matches,metadata_ready:metaReady,vector_version:VECTOR_VERSION,column_type:columnType,route_version:ROUTE_VERSION,search_mode:out.search_mode,search_mode_label:out.search_mode==='fast'?'신속검색':'정밀검색',run_no:out.run_no,representative_count:out.representative_count,representative_group_limit:REP_GROUP_LIMIT,representative_candidates:out.representative_candidates,representative_scanned:out.search_mode==='precise'?out.representative_count:null,candidate_count:out.member_candidate_count,run0_candidate_count:out.run0_candidate_count,run0_total:out.run0_total,run0_candidate_limit:RUN0_LIMIT,run0_candidates:out.run0_candidates,hnsw_status:out.hnsw_status,run0_hnsw_status:out.run0_hnsw_status,search_ms:searchMs,timings:out.timings});
 }catch(e){if(e&&e.code==='INDEX_WARMING')return res.status(503).json({ok:false,error:'INDEX_WARMING',index_kind:e.index_kind||'',retryable:true,route_version:ROUTE_VERSION,search_ms:Date.now()-started});return res.status(500).json({ok:false,error:C(e&&e.message||e),route_version:ROUTE_VERSION,search_ms:Date.now()-started});}
});

module.exports=router;
