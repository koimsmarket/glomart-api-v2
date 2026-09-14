'use strict';

// GM_IMAGE_REPRESENTATIVE_SEARCH_V001_ACTIVE_NEXT
// HNSW lifecycle is isolated from routes/image_vector.js.
// ACTIVE always remains searchable while NEXT is built. New representatives are
// added incrementally; representative replacement/removal schedules a debounced
// NEXT rebuild and never clears ACTIVE first.

const {RepresentativeHnsw}=require('./image_representative_hnsw');

const DIM=512;
const REP_GROUP_LIMIT=Math.max(3,Math.min(100,Number(process.env.GM_IMAGE_REP_GROUP_LIMIT||20)||20));
const REBUILD_DEBOUNCE_MS=Math.max(5000,Number(process.env.GM_IMAGE_HNSW_REBUILD_DEBOUNCE_MS||30000)||30000);

function C(v){return String(v==null?'':v).trim();}
function N(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
function normalizedFloat32(raw){
  if(!Array.isArray(raw)||raw.length!==DIM)return null;
  const a=new Float32Array(DIM);let norm=0;
  for(let i=0;i<DIM;i++){const x=Number(raw[i]);if(!Number.isFinite(x))return null;a[i]=x;norm+=x*x;}
  if(!(norm>0))return null;
  const inv=1/Math.sqrt(norm);for(let i=0;i<DIM;i++)a[i]*=inv;return a;
}
function exactCosine(queryNorm,raw){
  const v=normalizedFloat32(raw);if(!v)return -Infinity;
  let dot=0;for(let i=0;i<DIM;i++)dot+=queryNorm[i]*v[i];return dot;
}
function pidFromVectorUid(raw){const s=C(raw);if(!s)return '';const m=s.match(/^(?:CPKR_|ALKR_)?(\d+)(?:_|$)/i);return m?C(m[1]):s;}
function mallHintFromVectorUid(raw){const s=C(raw);if(/^CPKR_/i.test(s))return 'CPKR';if(/^ALKR_/i.test(s))return 'ALKR';if(/^\d+_\d+_\d+$/.test(s))return 'CPKR';return '';}
function metaFromRow(r){return {product_uid:C(r.product_uid),product_id:C(r.product_id),product_name:C(r.product_name),product_url:C(r.product_url),image_url:C(r.thumb_origin_url),mall_code:C(r.mall_code),keyword:C(r.keyword),category_keyword:C(r.category_keyword)};}

async function runtimeConfig(pool,key,def){
  const q=await pool.query('SELECT config_value FROM gm_runtime_config WHERE config_key=$1',[key]);
  return q.rows&&q.rows.length?C(q.rows[0].config_value):C(def);
}
async function currentRepresentativeRun(pool){return Math.max(1,Math.trunc(Number(await runtimeConfig(pool,'image_vector_representative_run','1'))||1));}
async function representativeMeta(pool){
  const runNo=await currentRepresentativeRun(pool);
  const q=await pool.query(`SELECT COUNT(*)::int AS n,COALESCE(MAX(updated_at)::text,'') AS stamp
      FROM gm_image_vector_representative_map
     WHERE run_no=$1 AND representative_puid IS NOT NULL AND puid=representative_puid`,[runNo]);
  return {run_no:runNo,count:N(q.rows&&q.rows[0]&&q.rows[0].n),stamp:C(q.rows&&q.rows[0]&&q.rows[0].stamp)};
}
async function loadRepresentativeRows(pool,meta,progress){
  const q=await pool.query(`SELECT m.representative_no,m.representative_puid,v.vector_image
      FROM gm_image_vector_representative_map m
      JOIN gm_product_image_vector v ON v.product_uid=m.representative_puid
     WHERE m.run_no=$1
       AND m.representative_puid IS NOT NULL
       AND m.puid=m.representative_puid
       AND v.vector_image IS NOT NULL
       AND array_length(v.vector_image,1)=$2
     ORDER BY m.representative_no`,[meta.run_no,DIM]);
  const src=q.rows||[],rows=[];
  for(let i=0;i<src.length;i++){
    const r=src[i],v=normalizedFloat32(r.vector_image);
    if(v)rows.push({representative_no:Number(r.representative_no||0),representative_puid:C(r.representative_puid),vector:v});
    // Release the large PostgreSQL REAL[] row as soon as it has been copied.
    r.vector_image=null;
    if(progress&&(i===src.length-1||(i+1)%250===0))progress(rows.length,src.length);
    if(i&&i%250===0)await new Promise(resolve=>setImmediate(resolve));
  }
  src.length=0;
  return rows;
}
function topRepresentativeMatches(queryNorm,rows,limit){
  const out=[];
  for(const r of rows||[]){
    let dot=0;for(let i=0;i<DIM;i++)dot+=queryNorm[i]*r.vector[i];
    if(out.length<limit){out.push({representative_no:r.representative_no,representative_puid:r.representative_puid,score:dot});out.sort((a,b)=>b.score-a.score);continue;}
    if(dot<=out[out.length-1].score)continue;
    out[out.length-1]={representative_no:r.representative_no,representative_puid:r.representative_puid,score:dot};out.sort((a,b)=>b.score-a.score);
  }
  return out;
}
async function fetchProductMetadata(pool,productUids){
  const wanted=[],seen=new Set();
  for(const raw of productUids||[]){const vectorUid=C(raw);if(!vectorUid||seen.has(vectorUid))continue;seen.add(vectorUid);wanted.push({vector_uid:vectorUid,product_id:pidFromVectorUid(vectorUid),mall_code:mallHintFromVectorUid(vectorUid)});}
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
         ORDER BY CASE WHEN COALESCE(p.sale_status,'active')='active' AND COALESCE(p.soldout_yn,'N')<>'Y' THEN 0 ELSE 1 END,
                  COALESCE(p.updated_at,p.last_seen_at) DESC NULLS LAST,p.product_uid ASC
         LIMIT 1
      ) p ON TRUE
     ORDER BY w.ord`,[vectorUids,pids,malls]);
  const byUid=new Map();
  for(const r of q.rows||[]){if(C(r.product_uid)){const m=metaFromRow(r);m.lookup_pid=C(r.wanted_product_id);byUid.set(C(r.wanted_product_uid),m);}}
  return {byUid,rows:q.rows||[]};
}

let active={run_no:0,count:0,stamp:'',rows:[],row_ids:new Set(),index:null,built_at:0,build_ms:0};
let nextBuildPromise=null;
let rebuildTimer=null;
let dirtyReasons=new Set();
let dirtySerial=0;
let pendingAdds=new Map();
let lastPool=null;
let lifecycle={state:'IDLE',phase:'IDLE',reason:'',run_no:0,total:0,loaded:0,built:0,percent:0,started_at:0,finished_at:0,load_ms:0,build_ms:0,error:'',generation:0};

function publicStatus(){
  const idx=active.index?active.index.status():null;
  return Object.assign({},lifecycle,{
    ready:!!active.index,
    active_run_no:active.run_no,
    active_representatives:active.rows.length,
    active_hnsw:idx,
    next_building:!!nextBuildPromise,
    dirty_count:dirtyReasons.size,
    dirty_reasons:[...dirtyReasons].slice(0,20),
    rebuild_debounce_ms:REBUILD_DEBOUNCE_MS
  });
}
function scheduleRebuild(pool,reason){
  lastPool=pool||lastPool;
  if(reason){dirtyReasons.add(C(reason));dirtySerial++;}
  console.log('[GM_HNSW_DIAG REBUILD_REQUEST]',JSON.stringify({reason:C(reason),active_ready:!!active.index,active_run_no:active.run_no,next_building:!!nextBuildPromise,rebuild_timer:!!rebuildTimer,dirty_count:dirtyReasons.size}));
  if(rebuildTimer||nextBuildPromise||!lastPool)return;
  rebuildTimer=setTimeout(()=>{
    rebuildTimer=null;
    startBuild(lastPool,'dirty_rebuild',true);
  },REBUILD_DEBOUNCE_MS);
  if(rebuildTimer&&typeof rebuildTimer.unref==='function')rebuildTimer.unref();
}
function startBuild(pool,reason,force){
  if(!pool)return false;
  lastPool=pool;
  if(nextBuildPromise)return false;
  if(!force&&active.index)return false;
  nextBuildPromise=(async()=>{
    const started=Date.now(),generation=Number(lifecycle.generation||0)+1,buildDirtySerial=dirtySerial;
    try{
      lifecycle={state:'LOADING',phase:'META',reason:C(reason||'preload'),run_no:0,total:0,loaded:0,built:0,percent:0,started_at:started,finished_at:0,load_ms:0,build_ms:0,error:'',generation};
      console.log('[GM_HNSW_DIAG NEXT_BUILD_START]',JSON.stringify({reason:C(reason),force:!!force,generation,active_ready:!!active.index,active_run_no:active.run_no,dirty_count:dirtyReasons.size}));
      const meta=await representativeMeta(pool);
      console.log('[GM_HNSW_DIAG NEXT_META_DONE]',JSON.stringify({run_no:meta.run_no,count:meta.count,meta_ms:Date.now()-started,generation}));
      lifecycle.run_no=meta.run_no;lifecycle.total=meta.count;
      if(meta.count<1)throw new Error('representative map is empty; build representative data first');
      const loadStarted=Date.now();lifecycle.phase='CACHE_QUERY';
      const rows=await loadRepresentativeRows(pool,meta,(loaded,total)=>{lifecycle.phase='CACHE_NORMALIZE';lifecycle.loaded=loaded;lifecycle.total=total;lifecycle.percent=total?Math.min(49.9,loaded/total*50):0;});
      lifecycle.load_ms=Date.now()-loadStarted;
      console.log('[GM_HNSW_DIAG NEXT_LOAD_DONE]',JSON.stringify({run_no:meta.run_no,rows:rows.length,load_ms:lifecycle.load_ms,generation}));lifecycle.loaded=rows.length;lifecycle.total=rows.length;
      lifecycle.state='BUILDING';lifecycle.phase='HNSW_BUILD';lifecycle.percent=50;
      const buildStarted=Date.now(),index=new RepresentativeHnsw();
      await index.buildAsync(rows,{yieldEvery:25,progressEvery:100,onProgress:p=>{lifecycle.built=p.built;lifecycle.percent=50+(Number(p.percent||0)*0.5);}});
      const next={run_no:meta.run_no,count:rows.length,stamp:meta.stamp,rows,row_ids:new Set(rows.map(x=>x.representative_puid)),index,built_at:Date.now(),build_ms:Date.now()-buildStarted};
      // Merge representatives created while NEXT was being built so the atomic swap never loses them.
      for(const [uid,row] of pendingAdds){if(row.run_no===next.run_no&&!next.row_ids.has(uid)){next.index.add(row);next.rows.push(row);next.row_ids.add(uid);}}
      next.count=next.rows.length;pendingAdds.clear();
      // Atomic publication: the old ACTIVE object remains valid until this single assignment.
      active=next;
      if(dirtySerial===buildDirtySerial)dirtyReasons.clear();
      lifecycle={state:'READY',phase:'READY',reason:C(reason||'preload'),run_no:next.run_no,total:rows.length,loaded:rows.length,built:rows.length,percent:100,started_at:started,finished_at:Date.now(),load_ms:lifecycle.load_ms,build_ms:next.build_ms,error:'',generation};
      console.log('[GM_IMAGE_REP_HNSW_SWAP_READY]',JSON.stringify({run_no:next.run_no,count:next.rows.length,load_ms:lifecycle.load_ms,build_ms:next.build_ms,total_ms:Date.now()-started,reason:C(reason),generation,status:next.index.status()}));
      if(dirtySerial!==buildDirtySerial)dirtyReasons.add('dirty_during_next_build');
    }catch(e){
      // Never discard a working ACTIVE index because NEXT failed.
      lifecycle.state=active.index?'READY':'ERROR';lifecycle.phase=active.index?'ACTIVE_KEPT_AFTER_BUILD_ERROR':'ERROR';lifecycle.error=C(e&&e.message||e);lifecycle.finished_at=Date.now();
      console.error('[GM_IMAGE_REP_HNSW_BUILD_ERROR]',JSON.stringify({error:lifecycle.error,active_kept:!!active.index,reason:C(reason),generation}));
    }finally{
      nextBuildPromise=null;
      if(dirtyReasons.size&&lastPool&&!rebuildTimer)scheduleRebuild(lastPool,'dirty_after_build');
    }
  })();
  nextBuildPromise.catch(()=>{});
  return true;
}

function onAssignment(pool,assignment,vector){
  if(!assignment)return;
  lastPool=pool||lastPool;
  const action=C(assignment.action);
  console.log('[GM_HNSW_DIAG ASSIGN_EVENT]',JSON.stringify({action,run_no:N(assignment.run_no),representative_puid:C(assignment.representative_puid),active_ready:!!active.index,active_run_no:active.run_no,next_building:!!nextBuildPromise}));
  if(action==='linked')return;
  if(action==='new_representative'){
    const runNo=N(assignment.run_no),uid=C(assignment.representative_puid),repNo=N(assignment.representative_no),vn=normalizedFloat32(vector);
    const row={run_no:runNo,representative_no:repNo,representative_puid:uid,vector:vn};
    if(nextBuildPromise&&uid&&vn)pendingAdds.set(uid,row);
    if(active.index&&active.run_no===runNo&&uid&&vn&&!active.row_ids.has(uid)){
      active.index.add(row);active.rows.push(row);active.row_ids.add(uid);active.count=active.rows.length;active.built_at=Date.now();
      lifecycle.state='READY';lifecycle.phase='READY';lifecycle.run_no=runNo;lifecycle.total=active.rows.length;lifecycle.loaded=active.rows.length;lifecycle.built=active.rows.length;lifecycle.percent=100;lifecycle.finished_at=Date.now();
      console.log('[GM_IMAGE_REP_HNSW_INCREMENTAL_ADD]',JSON.stringify({run_no:runNo,representative_no:repNo,representative_puid:uid,active_count:active.rows.length}));
      return;
    }
    // No ACTIVE yet or run changed: build NEXT once, without clearing anything.
    scheduleRebuild(pool,'new_representative_without_matching_active');
    return;
  }
  // Existing representative changed, was removed, or members were re-parented.
  // HNSW has no in-place delete/update here, so mark dirty and rebuild NEXT later.
  // ACTIVE stays searchable during the entire rebuild.
  scheduleRebuild(pool,action||'representative_changed');
}

async function search(pool,queryVector,limit,searchMode){
  lastPool=pool||lastPool;
  const liveRun=await currentRepresentativeRun(pool);
  if(!active.index||active.run_no!==liveRun){
    startBuild(pool,'search_initial_preload',false);
    const err=new Error('INDEX_NOT_READY');err.code='INDEX_NOT_READY';err.status=publicStatus();throw err;
  }
  const qn=normalizedFloat32(queryVector);if(!qn)throw new Error('invalid query vector');
  const timings={representative_scan_ms:0,representative_search_ms:0,map_fetch_ms:0,vector_fetch_ms:0,exact_rerank_ms:0,product_fetch_ms:0};
  let t=Date.now(),repTop;
  if(searchMode==='precise')repTop=topRepresentativeMatches(qn,active.rows,REP_GROUP_LIMIT);
  else repTop=active.index.search(qn,REP_GROUP_LIMIT);
  timings.representative_search_ms=Date.now()-t;if(searchMode==='precise')timings.representative_scan_ms=timings.representative_search_ms;
  const repIds=repTop.map(x=>x.representative_puid);
  t=Date.now();
  const mq=repIds.length?await pool.query(`SELECT puid,representative_no,representative_puid,run_no
      FROM gm_image_vector_representative_map
     WHERE (run_no=$1 AND representative_puid=ANY($2::text[])) OR run_no=0`,[active.run_no,repIds]):{rows:[]};
  timings.map_fetch_ms=Date.now()-t;
  const candidateIds=[...new Set((mq.rows||[]).map(r=>C(r.puid)).filter(Boolean))],run0Count=(mq.rows||[]).filter(r=>N(r.run_no)===0).length;
  if(!candidateIds.length)return {search_mode:searchMode,run_no:active.run_no,representative_count:active.rows.length,representative_candidates:repTop,member_candidate_count:0,run0_candidate_count:run0Count,matches:[],timings,hnsw_status:active.index.status()};
  t=Date.now();const vq=await pool.query(`SELECT product_uid,vector_image FROM gm_product_image_vector WHERE product_uid=ANY($1::text[]) AND vector_image IS NOT NULL AND array_length(vector_image,1)=$2`,[candidateIds,DIM]);timings.vector_fetch_ms=Date.now()-t;
  t=Date.now();const exact=[];for(const r of vq.rows||[]){const score=exactCosine(qn,r.vector_image);if(Number.isFinite(score))exact.push({product_uid:C(r.product_uid),score});r.vector_image=null;}exact.sort((a,b)=>b.score-a.score);const ranked=exact.slice(0,Math.max(1,limit));timings.exact_rerank_ms=Date.now()-t;
  t=Date.now();const productLookup=await fetchProductMetadata(pool,ranked.map(x=>x.product_uid));timings.product_fetch_ms=Date.now()-t;
  const matches=ranked.map((x,idx)=>{const m=Object.assign({},productLookup.byUid.get(x.product_uid)||{product_uid:x.product_uid,product_name:'',product_url:'',image_url:'',mall_code:'',keyword:'',category_keyword:''},{product_uid:x.product_uid,score:x.score});const aliases=C(m.keyword).split('|').map(C).filter(Boolean);m.search_keyword=C(aliases[0]||m.category_keyword||m.product_name);m.level_best=idx===0;return m;});
  return {search_mode:searchMode,run_no:active.run_no,representative_count:active.rows.length,representative_candidates:repTop,member_candidate_count:candidateIds.length,run0_candidate_count:run0Count,matches,timings,hnsw_status:active.index.status()};
}

module.exports={
  status:publicStatus,
  startBuild,
  onAssignment,
  search,
  currentRepresentativeRun,
  REP_GROUP_LIMIT
};
