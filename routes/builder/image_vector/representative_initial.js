'use strict';
// GM_BUILDER_IMAGE_VECTOR_REPRESENTATIVE_INITIAL_V030_NO_MIGRATION_QUEUE
// Initial/full representative-map builder.
// V010: reference-backed category resolver, category-at-a-time vector loading,
//       atomic group commits, resume/skip for completed groups, batched DB writes.
// gm_category / gm_category_dynamic / gm_product / source vectors are READ ONLY.

const express=require('express');
const router=express.Router();
const {dbFrom,ok,fail}=require('../core');
const {assignIncrementalOnClient,invalidate:invalidateRepresentativeAssign}=require('../../../services/image_representative_assign');
const DIM=512;
const MUTATION_LOCK_KEY=20911001;
const BUILDER_LOCK_KEY=20911002;
let job=freshJob();
let preview={running:false,completed:false,started_at:null,finished_at:null,total_vector:0,candidate_vector:0,category_resolved:0,category_unresolved:0,categories_total:0,reason_counts:{},error:null};
function freshJob(){return {running:false,phase:'IDLE',started_at:null,finished_at:null,run_no:null,threshold:null,total_vector:0,candidate_vector:0,category_resolved:0,category_unresolved:0,excluded_run0:0,processed:0,skipped:0,categories_total:0,categories_done:0,categories_skipped:0,representatives:0,last_category:null,current_category_keyword:null,current_category_count:0,current_category_processed:0,current_category_index:0,current_category_representatives:0,last_representative_no:0,error:null};}
function previewLog(stage,data){
  try{console.log(`[GM_IMAGE_VECTOR_REPRESENTATIVE_PREVIEW_V014] ${stage} ${JSON.stringify(data||{})}`);}catch(_){console.log(`[GM_IMAGE_VECTOR_REPRESENTATIVE_PREVIEW_V014] ${stage}`);}
}
function initialLog(stage,data){
  try{console.log(`[GM_BUILDER_IMAGE_VECTOR_REPRESENTATIVE_INITIAL_V029_ALI_OPTION_IDENTITY] ${stage} ${JSON.stringify(data||{})}`);}catch(_){console.log(`[GM_BUILDER_IMAGE_VECTOR_REPRESENTATIVE_INITIAL_V029_ALI_OPTION_IDENTITY] ${stage}`);}
}
const yieldEventLoop=()=>new Promise(resolve=>setImmediate(resolve));
function S(v){return String(v==null?'':v).trim();}
function N(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
function norm(v){return S(v).replace(/\s+/g,' ').trim();}
function cosine(a,b){let dot=0,aa=0,bb=0;for(let i=0;i<DIM;i++){const x=Number(a[i])||0,y=Number(b[i])||0;dot+=x*y;aa+=x*x;bb+=y*y;}return aa>0&&bb>0?dot/Math.sqrt(aa*bb):-1;}
async function config(db,key,def){const r=await db.query('SELECT config_value FROM gm_runtime_config WHERE config_key=$1',[key]);return r.rows.length?r.rows[0].config_value:def;}
async function settings(db){const runNo=Math.max(1,Math.trunc(N(await config(db,'image_vector_representative_run','1'),1)));const threshold=N(await config(db,'image_vector_representative_similarity','0.95'),0.95);if(!(threshold>0&&threshold<=1))throw new Error('대표이미지 유사율은 0 초과 1 이하여야 합니다.');return {run_no:runNo,threshold};}
async function liveSettings(db){
  const target=await settings(db);
  const runNo=Math.max(1,Math.trunc(N(await config(db,'image_vector_representative_live_run',target.run_no),target.run_no)));
  const threshold=N(await config(db,'image_vector_representative_live_similarity',target.threshold),target.threshold);
  const epoch=Math.max(0,Math.trunc(N(await config(db,'image_vector_representative_live_epoch','0'),0)));
  return {run_no:runNo,threshold,epoch};
}
async function saveSettings(db,runNo,threshold){
  runNo=Math.trunc(Number(runNo));threshold=Number(threshold);
  if(!(runNo>=1))throw new Error('RUN은 1 이상의 정수여야 합니다.');
  if(!(threshold>0&&threshold<=1))throw new Error('대표이미지 유사율은 0 초과 1 이하여야 합니다.');
  const c=await db.connect();
  try{
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock($1)',[MUTATION_LOCK_KEY]);
    const building=await c.query(`SELECT config_value FROM gm_runtime_config WHERE config_key='image_vector_representative_building'`);
    const activeBuild=S(building.rows&&building.rows[0]&&building.rows[0].config_value);
    if(activeBuild){const e=new Error('대표망 전체 재생성 중에는 RUN 또는 유사율을 변경할 수 없습니다.');e.code='REPRESENTATIVE_REBUILD_RUNNING';e.build_id=activeBuild;throw e;}
    await c.query(`INSERT INTO gm_runtime_config(config_key,config_value,value_type,category,mode,enabled,description,updated_at)
      VALUES('image_vector_representative_run',$1,'NUMBER','IMAGE_VECTOR','FIXED',TRUE,'대표이미지 현재 실행 RUN. 0은 카테고리 없음 예약값',now())
      ON CONFLICT(config_key) DO UPDATE SET config_value=EXCLUDED.config_value,value_type='NUMBER',category='IMAGE_VECTOR',enabled=TRUE,updated_at=now()`,[String(runNo)]);
    await c.query(`INSERT INTO gm_runtime_config(config_key,config_value,value_type,category,mode,enabled,description,updated_at)
      VALUES('image_vector_representative_similarity',$1,'NUMBER','IMAGE_VECTOR','FIXED',TRUE,'대표이미지 기본 유사율 기준(0~1)',now())
      ON CONFLICT(config_key) DO UPDATE SET config_value=EXCLUDED.config_value,value_type='NUMBER',category='IMAGE_VECTOR',enabled=TRUE,updated_at=now()`,[threshold.toFixed(4)]);
    await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  return {run_no:runNo,threshold:Number(threshold.toFixed(4))};
}


function splitComma(v){return S(v).split(/\s*,\s*/).map(norm).filter(Boolean);}
function splitSlash(v){return S(v).split(/\s*[\/／]\s*/).map(norm).filter(Boolean);}
function catCode(r){return S(r&&r.cp_code)||S(r&&r.gm_code);}
function catKey(r){const cp=S(r&&r.cp_code),gm=S(r&&r.gm_code);return cp?`CP:${cp}`:(gm?`GM:${gm}`:`PATH:${S(r&&r.gm_parent_code)}|${S(r&&r.cp_parent_code)}|${norm(r&&r.name_ko)}|${N(r&&r.depth,0)}`);}
function dedupe(rows){const out=[],idx=new Map();for(const r of rows||[]){const k=catKey(r),prev=idx.get(k);if(!prev){idx.set(k,r);out.push(r);continue;}const ps=(S(prev.src)==='base'?20:0)+(S(prev.cp_code)?10:0)+(S(prev.gm_code)?2:0),rs=(S(r.src)==='base'?20:0)+(S(r.cp_code)?10:0)+(S(r.gm_code)?2:0);if(rs>ps){const i=out.indexOf(prev);if(i>=0)out[i]=r;idx.set(k,r);}}return out;}
function addIndex(map,key,row){key=norm(key);if(!key)return;if(!map.has(key))map.set(key,[]);map.get(key).push(row);}

async function loadCategoryReference(db){
  const r=await db.query(`
    SELECT 'base' AS src,cp_code,gm_code,gm_parent_code,cp_parent_code,parent_name_ko,depth,leaf_yn,name_ko,keyword,keyword_seed
      FROM gm_category
    UNION ALL
    SELECT 'dynamic' AS src,cp_code,gm_code,gm_parent_code,cp_parent_code,parent_name_ko,depth,leaf_yn,name_ko,keyword,keyword AS keyword_seed
      FROM gm_category_dynamic WHERE active_yn='Y'`);
  const ref={byCode:new Map(),exact:new Map(),keyword:new Map(),seed:new Map(),list:new Map(),slash:new Map()};
  for(const row of r.rows||[]){
    const cp=S(row.cp_code),gm=S(row.gm_code);if(cp)ref.byCode.set(cp,row);if(gm&&!ref.byCode.has(gm))ref.byCode.set(gm,row);
    addIndex(ref.exact,row.name_ko,row);addIndex(ref.keyword,row.keyword,row);addIndex(ref.seed,row.keyword_seed,row);
    for(const x of splitComma(`${S(row.keyword)},${S(row.keyword_seed)}`))addIndex(ref.list,x,row);
    const name=norm(row.name_ko),parts=splitSlash(name);if(parts.length>1)for(const x of parts)addIndex(ref.slash,x,row);
  }
  return ref;
}

function selectStage(rows,stage){
  const cand=dedupe(rows||[]);
  const valid=cand.filter(r=>{const slashGroup=/[\/／]/.test(S(r.name_ko));return !(slashGroup&&N(r.depth,0)<5) && !!catCode(r);});
  if(valid.length===1)return {code:catCode(valid[0]),reason:stage};
  if(valid.length>1){
    const confirmed=valid.filter(r=>S(r.cp_code));
    if(confirmed.length===1){const c=confirmed[0],cn=norm(c.name_ko),pg=S(c.gm_parent_code),pc=S(c.cp_parent_code);const same=valid.every(r=>r===c||(norm(r.name_ko)===cn&&S(r.gm_parent_code)===pg&&S(r.cp_parent_code)===pc));if(same)return {code:catCode(c),reason:stage+'_CONFIRMED_SAME_PATH'};}
    return {code:'',reason:stage+'_AMBIGUOUS',ambiguous:true};
  }
  return null;
}
function resolveKeyword(ref,keyword){
  const kw=norm(keyword);if(!kw)return {code:'',group:'',reason:'NO_KEYWORD'};
  const stages=[['EXACT',ref.exact.get(kw)],['KEYWORD',ref.keyword.get(kw)],['KEYWORD_SEED',ref.seed.get(kw)],['KEYWORD_LIST',ref.list.get(kw)]];
  for(const [name,rows] of stages){if(!rows||!rows.length)continue;const x=selectStage(rows,name);if(x&&x.code)return {code:x.code,group:`CAT:${x.code}`,reason:x.reason};if(x&&x.ambiguous)return {code:'',group:`KW:${kw}`,reason:x.reason+'_REFERENCE_FAMILY'};}
  const slash=dedupe(ref.slash.get(kw)||[]).filter(r=>!!catCode(r));
  if(slash.length===1)return {code:'',group:`KW:${kw}`,reason:'SLASH_REFERENCE_FAMILY'};
  if(slash.length>1)return {code:'',group:`KW:${kw}`,reason:'SLASH_AMBIGUOUS_REFERENCE_FAMILY'};
  return {code:'',group:'',reason:'NO_CATEGORY_REFERENCE'};
}
function resolveProductCategory(ref,p){
  const fix=S(p.cp_fix_code);if(fix&&ref.byCode.has(fix)){const code=catCode(ref.byCode.get(fix));return {code,group:`CAT:${code}`,reason:'CP_FIX'};}
  const selected=S(p.cp_selected_code);if(selected&&ref.byCode.has(selected)){const code=catCode(ref.byCode.get(selected));return {code,group:`CAT:${code}`,reason:'CP_SELECTED'};}
  return resolveKeyword(ref,S(p.category_keyword)||S(p.keyword));
}

async function loadMetadata(db,ref){
  const r=await db.query(`WITH vv AS (
      SELECT v.product_uid AS puid,
             CASE WHEN v.product_uid ~* '^(CPKR_|ALKR_)?[0-9]+' THEN (regexp_match(v.product_uid,'^(?:CPKR_|ALKR_)?([0-9]+)','i'))[1] ELSE v.product_uid END AS pid,
             CASE WHEN v.product_uid ~* '^CPKR_' OR v.product_uid ~ '^[0-9]+_[0-9]+_[0-9]+$' THEN 'CPKR'
                  WHEN v.product_uid ~* '^ALKR_' THEN 'ALKR' ELSE '' END AS mall,
             CASE WHEN v.product_uid ~* '^(CPKR_|ALKR_)[0-9]+_[0-9]+(_[0-9]+)?$' THEN regexp_replace(v.product_uid,'^(CPKR_|ALKR_)','','i')
                  WHEN v.product_uid ~ '^[0-9]+_[0-9]+_[0-9]+$' THEN v.product_uid ELSE '' END AS pi
        FROM gm_product_image_vector v
       WHERE v.vector_image IS NOT NULL AND array_length(v.vector_image,1)=$1
    )
    SELECT vv.puid,p.cp_fix_code,p.cp_selected_code,p.category_keyword,p.keyword
      FROM vv
      LEFT JOIN LATERAL (
        SELECT p.cp_fix_code,p.cp_selected_code,p.category_keyword,p.keyword,p.product_uid,p.product_id,p.mall_code,p.updated_at,p.last_seen_at
          FROM gm_product p
         WHERE p.product_uid=vv.puid
            OR (vv.pi<>'' AND p.pi_ii_vi=vv.pi AND (vv.mall='' OR p.mall_code=vv.mall))
            OR (vv.pi='' AND p.product_id=vv.pid AND (vv.mall='' OR p.mall_code=vv.mall))
         ORDER BY CASE WHEN p.product_uid=vv.puid THEN 0 WHEN vv.pi<>'' AND p.pi_ii_vi=vv.pi THEN 1 ELSE 2 END,
                  CASE WHEN COALESCE(p.sale_status,'active')='active' AND COALESCE(p.soldout_yn,'N')<>'Y' THEN 0 ELSE 1 END,
                  COALESCE(p.updated_at,p.last_seen_at) DESC NULLS LAST
         LIMIT 1
      ) p ON TRUE
     ORDER BY vv.puid`,[DIM]);
  const groups=new Map(),unresolved=[];let candidate=0,resolved=0;const reasonCounts={};
  let n=0;
  for(const row of r.rows||[]){
    const puid=S(row.puid);if(!puid)continue;
    if(S(row.category_keyword)||S(row.keyword))candidate++;
    const x=resolveProductCategory(ref,row);reasonCounts[x.reason||'UNKNOWN']=(reasonCounts[x.reason||'UNKNOWN']||0)+1;
    if(!x.group){unresolved.push(puid);}
    else{resolved++;if(!groups.has(x.group))groups.set(x.group,{key:x.group,reason:x.reason,keyword:S(row.category_keyword)||S(row.keyword)||x.code||x.group,puids:[]});groups.get(x.group).puids.push(puid);}
    if((++n%2000)===0)await yieldEventLoop();
  }
  return {total:r.rows.length,candidate,resolved,unresolved,groups,reason_counts:reasonCounts};
}
async function loadVectorsForGroup(db,puids){
  if(!puids.length)return [];
  const r=await db.query(`SELECT product_uid AS puid,vector_image FROM gm_product_image_vector
    WHERE product_uid=ANY($1::text[]) AND vector_image IS NOT NULL AND array_length(vector_image,1)=$2 ORDER BY product_uid`,[puids,DIM]);
  return r.rows||[];
}


async function acquireBuilderLock(db){
  const c=await db.connect();
  try{
    const q=await c.query('SELECT pg_try_advisory_lock($1) AS locked',[BUILDER_LOCK_KEY]);
    if(!(q.rows&&q.rows[0]&&q.rows[0].locked)){c.release();return null;}
    return c;
  }catch(e){c.release();throw e;}
}
async function releaseBuilderLock(c){
  if(!c)return;
  try{await c.query('SELECT pg_advisory_unlock($1)',[BUILDER_LOCK_KEY]);}catch(_e){}
  try{c.release();}catch(_e){}
}

async function beginBuildMarker(db,buildId){
  const c=await db.connect();
  try{
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock($1)',[MUTATION_LOCK_KEY]);
    await c.query(`INSERT INTO gm_runtime_config(config_key,config_value,value_type,category,mode,enabled,description,updated_at)
      VALUES('image_vector_representative_building',$1,'TEXT','IMAGE_VECTOR','FIXED',TRUE,'대표망 전체 재생성 중 build id. 빈 값이면 미실행',now())
      ON CONFLICT(config_key) DO UPDATE SET config_value=EXCLUDED.config_value,enabled=TRUE,updated_at=now()`,[buildId]);
    // Preserve pre-existing metadata/vector refresh rows. A successful publish replays and clears
    // them atomically; a failed build must leave them for the background refresher.
    await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
async function clearBuildMarker(db,buildId){
  const c=await db.connect();
  try{
    await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock($1)',[MUTATION_LOCK_KEY]);
    await c.query(`UPDATE gm_runtime_config SET config_value='',updated_at=now()
      WHERE config_key='image_vector_representative_building' AND config_value=$1`,[buildId]);
    // No DB refresh queue exists. On failure/cancel, keep the old LIVE net untouched.
    await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');}finally{c.release();}
}
async function prepareStage(client){
  await client.query(`CREATE TEMP TABLE IF NOT EXISTS gm_iv_rep_map_stage (
    puid TEXT PRIMARY KEY,representative_no BIGINT,representative_puid TEXT,similarity REAL,run_no INTEGER NOT NULL,updated_at TIMESTAMPTZ NOT NULL
  ) ON COMMIT PRESERVE ROWS`);
  await client.query(`CREATE TEMP TABLE IF NOT EXISTS gm_iv_rep_stat_stage (
    representative_no BIGINT,representative_puid TEXT NOT NULL,run_no INTEGER NOT NULL,member_count INTEGER NOT NULL,avg_similarity REAL,min_similarity REAL,max_similarity REAL,updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY(representative_puid,run_no)
  ) ON COMMIT PRESERVE ROWS`);
  await client.query('TRUNCATE gm_iv_rep_map_stage,gm_iv_rep_stat_stage');
}
async function markRun0Stage(client,puids){
  if(!puids.length)return 0;let done=0;
  await client.query('BEGIN');
  try{
    for(let i=0;i<puids.length;i+=1000){const a=puids.slice(i,i+1000);await client.query(`INSERT INTO gm_iv_rep_map_stage(puid,representative_no,representative_puid,similarity,run_no,updated_at)
      SELECT x,NULL,NULL,NULL,0,now() FROM unnest($1::text[]) x ON CONFLICT(puid) DO UPDATE SET representative_no=NULL,representative_puid=NULL,similarity=NULL,run_no=0,updated_at=now()`,[a]);done+=a.length;}
    await client.query('COMMIT');return done;
  }catch(e){await client.query('ROLLBACK');throw e;}
}
async function processCategoryStage(client,rows,runNo,threshold,nextNo,onProgress){
  const reps=[],mapped=[];let rowNo=0;
  for(const row of rows){const puid=S(row.puid),v=row.vector_image;if(!puid||!Array.isArray(v)||v.length!==DIM)continue;let best=null,bestScore=-2;for(const rep of reps){const score=cosine(v,rep.vector);if(score>bestScore){bestScore=score;best=rep;}}if(!best||bestScore<threshold){const rep={puid,vector:v,no:nextNo++};reps.push(rep);mapped.push({puid,rep,similarity:1});}else mapped.push({puid,rep:best,similarity:bestScore});rowNo++;if(onProgress&&(rowNo===1||(rowNo%20)===0||rowNo===rows.length))onProgress({processed:rowNo,representatives:reps.length,total:rows.length});if((rowNo%20)===0)await yieldEventLoop();}
  await client.query('BEGIN');
  try{
    if(mapped.length)await client.query(`INSERT INTO gm_iv_rep_map_stage(puid,representative_no,representative_puid,similarity,run_no,updated_at)
      SELECT * FROM unnest($1::text[],$2::bigint[],$3::text[],$4::real[],$5::int[],$6::timestamptz[])
      ON CONFLICT(puid) DO UPDATE SET representative_no=EXCLUDED.representative_no,representative_puid=EXCLUDED.representative_puid,similarity=EXCLUDED.similarity,run_no=EXCLUDED.run_no,updated_at=EXCLUDED.updated_at`,
      [mapped.map(m=>m.puid),mapped.map(m=>m.rep.no),mapped.map(m=>m.rep.puid),mapped.map(m=>m.similarity),mapped.map(()=>runNo),mapped.map(()=>new Date())]);
    if(reps.length){const stat=[];for(const rep of reps){const ms=mapped.filter(m=>m.rep===rep&&m.puid!==rep.puid).map(m=>m.similarity);stat.push({rep,count:ms.length,avg:ms.length?ms.reduce((a,b)=>a+b,0)/ms.length:null,min:ms.length?Math.min(...ms):null,max:ms.length?Math.max(...ms):null});}
      await client.query(`INSERT INTO gm_iv_rep_stat_stage(representative_no,representative_puid,run_no,member_count,avg_similarity,min_similarity,max_similarity,updated_at)
        SELECT * FROM unnest($1::bigint[],$2::text[],$3::int[],$4::int[],$5::real[],$6::real[],$7::real[],$8::timestamptz[])
        ON CONFLICT(representative_puid,run_no) DO UPDATE SET representative_no=EXCLUDED.representative_no,member_count=EXCLUDED.member_count,avg_similarity=EXCLUDED.avg_similarity,min_similarity=EXCLUDED.min_similarity,max_similarity=EXCLUDED.max_similarity,updated_at=EXCLUDED.updated_at`,
        [stat.map(x=>x.rep.no),stat.map(x=>x.rep.puid),stat.map(()=>runNo),stat.map(x=>x.count),stat.map(x=>x.avg),stat.map(x=>x.min),stat.map(x=>x.max),stat.map(()=>new Date())]);}
    await client.query('COMMIT');return {members:mapped.length,reps:reps.length,last_no:reps.length?reps[reps.length-1].no:nextNo-1,next_no:nextNo};
  }catch(e){await client.query('ROLLBACK');throw e;}
}
async function publishStage(client,runNo,threshold,buildId,buildStartedAt){
  await client.query('BEGIN');
  try{
    await client.query('SELECT pg_advisory_xact_lock($1)',[MUTATION_LOCK_KEY]);
    const stage=await client.query(`SELECT COUNT(*)::int AS map_rows,(SELECT COUNT(*)::int FROM gm_iv_rep_stat_stage) AS stat_rows FROM gm_iv_rep_map_stage`);
    // Capture best-effort concurrent VECTOR changes from the OLD live map BEFORE replacing it.
    // Do not use gm_product timestamps here: PostgreSQL now()/updated_at reflects transaction-start
    // time, not commit order. Rare cross-transaction metadata races are repaired by the bounded
    // rolling reconciliation in background/image-vector without a migration/trigger/queue table.
    const deltaBeforeSwap=await client.query(`SELECT DISTINCT puid FROM (
      SELECT m.puid FROM gm_image_vector_representative_map m WHERE m.updated_at >= $1::timestamptz
      UNION
      SELECT v.product_uid AS puid
        FROM gm_product_image_vector v
        LEFT JOIN gm_iv_rep_map_stage st ON st.puid=v.product_uid
       WHERE v.vector_image IS NOT NULL AND array_length(v.vector_image,1)=$2 AND st.puid IS NULL
    ) x WHERE puid IS NOT NULL ORDER BY puid`,[buildStartedAt,DIM]);
    const oldMap=await client.query('DELETE FROM gm_image_vector_representative_map');
    const oldStat=await client.query('DELETE FROM gm_image_vector_representative_stat');
    const map=await client.query(`INSERT INTO gm_image_vector_representative_map(puid,representative_no,representative_puid,similarity,run_no,updated_at)
      SELECT puid,representative_no,representative_puid,similarity,run_no,updated_at FROM gm_iv_rep_map_stage`);
    const stat=await client.query(`INSERT INTO gm_image_vector_representative_stat(representative_no,representative_puid,run_no,member_count,avg_similarity,min_similarity,max_similarity,updated_at)
      SELECT representative_no,representative_puid,run_no,member_count,avg_similarity,min_similarity,max_similarity,updated_at FROM gm_iv_rep_stat_stage`);
    // Switch the LIVE search/incremental settings only inside the same publish transaction.
    // Target RUN/threshold may have been edited before the build, but old live settings remain
    // authoritative until this atomic publish succeeds.
    await client.query(`INSERT INTO gm_runtime_config(config_key,config_value,value_type,category,mode,enabled,description,updated_at)
      VALUES('image_vector_representative_live_run',$1,'NUMBER','IMAGE_VECTOR','FIXED',TRUE,'현재 검색/실시간 배정에 사용 중인 대표망 RUN',now())
      ON CONFLICT(config_key) DO UPDATE SET config_value=EXCLUDED.config_value,enabled=TRUE,updated_at=now()`,[String(runNo)]);
    await client.query(`INSERT INTO gm_runtime_config(config_key,config_value,value_type,category,mode,enabled,description,updated_at)
      VALUES('image_vector_representative_live_similarity',$1,'NUMBER','IMAGE_VECTOR','FIXED',TRUE,'현재 검색/실시간 배정 대표망 유사율',now())
      ON CONFLICT(config_key) DO UPDATE SET config_value=EXCLUDED.config_value,enabled=TRUE,updated_at=now()`,[Number(threshold).toFixed(4)]);
    // Full-publish generation token. FAST/RUN0 caches from a previous full map
    // must not be queried against the newly swapped map when the RUN number is reused.
    await client.query(`INSERT INTO gm_runtime_config(config_key,config_value,value_type,category,mode,enabled,description,updated_at)
      VALUES('image_vector_representative_live_epoch','1','NUMBER','IMAGE_VECTOR','FIXED',TRUE,'현재 LIVE 대표망 topology 세대. 대표 집합/대표 벡터 변경 또는 전체 publish 시 증가',now())
      ON CONFLICT(config_key) DO UPDATE
         SET config_value=(COALESCE(NULLIF(gm_runtime_config.config_value,''),'0')::bigint+1)::text,
             enabled=TRUE,updated_at=now()`);
    await client.query(`INSERT INTO gm_runtime_config(config_key,config_value,value_type,category,mode,enabled,description,updated_at)
      VALUES('image_vector_representative_run0_epoch','1','NUMBER','IMAGE_VECTOR','FIXED',TRUE,'RUN0 searchable membership generation. RUN0 진입/이탈/전체 publish 시 증가',now())
      ON CONFLICT(config_key) DO UPDATE
         SET config_value=(COALESCE(NULLIF(gm_runtime_config.config_value,''),'0')::bigint+1)::text,
             enabled=TRUE,updated_at=now()`);
    invalidateRepresentativeAssign();
    // Replay only the best-effort vector delta captured from the OLD live map. The previous
    // implementation queried m.updated_at AFTER copying staging rows into live; because staging
    // rows were created during this build, that condition matched nearly the entire map and could
    // turn atomic publish into an O(all vectors) replay. Metadata consistency is instead guaranteed
    // by the bounded rolling reconciliation, which is immune to transaction-start timestamp races.
    const replayIds=(deltaBeforeSwap.rows||[]).map(r=>S(r.puid)).filter(Boolean);
    let replayed=0;
    for(const uid of replayIds){
      const vq=await client.query('SELECT vector_image FROM gm_product_image_vector WHERE product_uid=$1 AND vector_image IS NOT NULL AND array_length(vector_image,1)=$2',[uid,DIM]);
      const vector=vq.rows&&vq.rows[0]&&vq.rows[0].vector_image;if(!Array.isArray(vector)||vector.length!==DIM)continue;
      await assignIncrementalOnClient(client,uid,vector);replayed++;
    }
    await client.query(`UPDATE gm_runtime_config SET config_value='',updated_at=now()
      WHERE config_key='image_vector_representative_building' AND config_value=$1`,[buildId]);
    const ep=await client.query(`SELECT config_value FROM gm_runtime_config WHERE config_key='image_vector_representative_live_epoch'`);
    const liveEpoch=Math.max(0,Math.trunc(N(ep.rows&&ep.rows[0]&&ep.rows[0].config_value,0)));
    await client.query('COMMIT');
    invalidateRepresentativeAssign();
    return {run_no:runNo,live_epoch:liveEpoch,old_map_rows:Number(oldMap.rowCount||0),old_stat_rows:Number(oldStat.rowCount||0),map_rows:Number(map.rowCount||0),stat_rows:Number(stat.rowCount||0),stage_map_rows:Number(stage.rows[0]&&stage.rows[0].map_rows||0),stage_stat_rows:Number(stage.rows[0]&&stage.rows[0].stat_rows||0),concurrent_delta_replayed:replayed};
  }catch(e){await client.query('ROLLBACK');throw e;}
}

async function runPreview(db){
  // POST /preview reserves the job by setting preview.running=true before setImmediate().
  // Do NOT return when running is already true here; that flag means this worker owns the reservation.
  const startedAt=preview.started_at||new Date().toISOString();
  preview={running:true,completed:false,started_at:startedAt,finished_at:null,total_vector:0,candidate_vector:0,category_resolved:0,category_unresolved:0,categories_total:0,reason_counts:{},error:null};
  previewLog('PREVIEW_START',{started_at:startedAt});
  try{
    const ref=await loadCategoryReference(db);
    previewLog('PREVIEW_REFERENCE_READY',{by_code:ref.byCode.size,exact:ref.exact.size,keyword:ref.keyword.size,seed:ref.seed.size,list:ref.list.size,slash:ref.slash.size});
    await yieldEventLoop();
    const meta=await loadMetadata(db,ref);
    previewLog('PREVIEW_METADATA_DONE',{total_vector:meta.total,candidate_vector:meta.candidate,category_resolved:meta.resolved,category_unresolved:meta.unresolved.length,categories_total:meta.groups.size});
    preview={running:false,completed:true,started_at:preview.started_at,finished_at:new Date().toISOString(),total_vector:meta.total,candidate_vector:meta.candidate,category_resolved:meta.resolved,category_unresolved:meta.unresolved.length,categories_total:meta.groups.size,reason_counts:meta.reason_counts,error:null};
    previewLog('PREVIEW_DONE',{started_at:preview.started_at,finished_at:preview.finished_at,total_vector:preview.total_vector,candidate_vector:preview.candidate_vector,category_resolved:preview.category_resolved,category_unresolved:preview.category_unresolved,categories_total:preview.categories_total});
  }catch(e){
    preview.running=false;preview.completed=false;preview.finished_at=new Date().toISOString();preview.error=S(e&&e.message||e);
    previewLog('PREVIEW_ERROR',{started_at:preview.started_at,finished_at:preview.finished_at,error:preview.error});
  }
}

async function runInitial(db,startSettings,builderLockClient,buildId,buildStartedAt){
  const s=startSettings||await settings(db);
  let client=null,markerStarted=true;
  job=Object.assign(job,{running:true,phase:'REFERENCE',started_at:job.started_at||new Date().toISOString(),run_no:s.run_no,threshold:s.threshold,error:null});
  initialLog('INITIAL_START',{started_at:job.started_at,run_no:s.run_no,threshold:s.threshold,build_id:buildId,policy:'STAGE_THEN_ATOMIC_PUBLISH'});
  try{
    client=await db.connect();
    await prepareStage(client);
    const ref=await loadCategoryReference(client);
    initialLog('INITIAL_REFERENCE_READY',{by_code:ref.byCode.size,exact:ref.exact.size,keyword:ref.keyword.size,seed:ref.seed.size,list:ref.list.size,slash:ref.slash.size});
    job.phase='RESOLVE';
    const meta=await loadMetadata(client,ref);
    job.total_vector=meta.total;job.candidate_vector=meta.candidate;job.category_resolved=meta.resolved;job.category_unresolved=meta.unresolved.length;job.excluded_run0=meta.unresolved.length;job.categories_total=meta.groups.size;
    initialLog('INITIAL_METADATA_DONE',{total_vector:meta.total,candidate_vector:meta.candidate,category_resolved:meta.resolved,category_unresolved:meta.unresolved.length,categories_total:meta.groups.size});
    job.phase='RUN0';await markRun0Stage(client,meta.unresolved);initialLog('INITIAL_RUN0_STAGED',{excluded_run0:meta.unresolved.length});
    job.phase='PROCESS';job.last_representative_no=0;let nextNo=1,categoryIndex=0;
    initialLog('INITIAL_PROCESS_START',{categories_total:meta.groups.size,live_snapshot_preserved:true});
    for(const g of meta.groups.values()){
      categoryIndex++;job.last_category=g.key;job.current_category_keyword=g.keyword||g.key;job.current_category_count=g.puids.length;job.current_category_processed=0;job.current_category_index=categoryIndex;job.current_category_representatives=0;
      const rows=await loadVectorsForGroup(client,g.puids);
      const r=await processCategoryStage(client,rows,s.run_no,s.threshold,nextNo,(p)=>{job.current_category_processed=p.processed;job.current_category_representatives=p.representatives;});
      nextNo=r.next_no;job.processed+=r.members;job.representatives+=r.reps;job.current_category_processed=r.members;job.current_category_representatives=r.reps;job.last_representative_no=Math.max(job.last_representative_no,r.last_no||0);job.categories_done++;
      if(categoryIndex===1||(categoryIndex%25)===0||categoryIndex===meta.groups.size)initialLog('INITIAL_PROGRESS',{category_index:categoryIndex,categories_total:meta.groups.size,keyword:job.current_category_keyword,category_count:g.puids.length,processed:job.processed,representatives:job.representatives,last_representative_no:job.last_representative_no,live_snapshot_preserved:true});
      await yieldEventLoop();
    }
    job.phase='PUBLISH';const pub=await publishStage(client,s.run_no,s.threshold,buildId,buildStartedAt);initialLog('INITIAL_ATOMIC_PUBLISH',pub);
    job.running=false;job.phase='DONE';job.finished_at=new Date().toISOString();job.current_category_processed=job.current_category_count;
    initialLog('INITIAL_DONE',{started_at:job.started_at,finished_at:job.finished_at,total_vector:job.total_vector,category_resolved:job.category_resolved,excluded_run0:job.excluded_run0,processed:job.processed,categories_done:job.categories_done,categories_total:job.categories_total,representatives:job.representatives,last_representative_no:job.last_representative_no,atomic_publish:true});
  }catch(e){job.running=false;job.phase='ERROR';job.finished_at=new Date().toISOString();job.error=S(e&&e.message||e);initialLog('INITIAL_ERROR',{started_at:job.started_at,finished_at:job.finished_at,phase:job.phase,keyword:job.current_category_keyword,error:job.error,live_snapshot_preserved:job.phase!=='PUBLISH'});if(markerStarted)await clearBuildMarker(db,buildId);
  }finally{if(client)client.release();await releaseBuilderLock(builderLockClient);}
}

function csvCell(v){
  if(v==null)return '';
  const x=String(v);
  return /[",\r\n]/.test(x)?'"'+x.replace(/"/g,'""')+'"':x;
}
function compactTs(d){
  const z=d instanceof Date?d:new Date(d||Date.now());
  const pad=n=>String(n).padStart(2,'0');
  return `${z.getFullYear()}${pad(z.getMonth()+1)}${pad(z.getDate())}_${pad(z.getHours())}${pad(z.getMinutes())}${pad(z.getSeconds())}`;
}

// Download the currently LIVE representative RUN, not a target RUN waiting for rebuild.
// Includes run_no=0 exclusions so the exported file covers the whole vector set.
router.get('/api/gm/builder/image-vector/representative/initial/export',async(req,res)=>{
  const db=dbFrom(req);
  try{
    const st=await liveSettings(db);
    const q=await db.query(`
      SELECT m.puid,m.representative_no,m.representative_puid,m.similarity,m.run_no,m.updated_at,
             CASE WHEN m.representative_puid IS NOT NULL AND m.puid=m.representative_puid THEN 'Y' ELSE 'N' END AS is_representative,
             p.category_keyword,p.cp_fix_code,p.cp_selected_code
        FROM gm_image_vector_representative_map m
        LEFT JOIN LATERAL (
          SELECT p.category_keyword,p.cp_fix_code,p.cp_selected_code
            FROM gm_product p
           WHERE p.product_uid=m.puid
              OR (
                   (CASE WHEN m.puid ~* '^(CPKR_|ALKR_)[0-9]+_[0-9]+(_[0-9]+)?$' THEN regexp_replace(m.puid,'^(CPKR_|ALKR_)','','i') WHEN m.puid ~ '^[0-9]+_[0-9]+_[0-9]+$' THEN m.puid ELSE '' END)<>''
                   AND p.pi_ii_vi=(CASE WHEN m.puid ~* '^(CPKR_|ALKR_)[0-9]+_[0-9]+(_[0-9]+)?$' THEN regexp_replace(m.puid,'^(CPKR_|ALKR_)','','i') WHEN m.puid ~ '^[0-9]+_[0-9]+_[0-9]+$' THEN m.puid ELSE '' END)
                   AND p.mall_code=(CASE WHEN m.puid ~* '^ALKR_' THEN 'ALKR' ELSE 'CPKR' END)
                 )
              OR (
                   (CASE WHEN m.puid ~* '^(CPKR_|ALKR_)[0-9]+_[0-9]+(_[0-9]+)?$' OR m.puid ~ '^[0-9]+_[0-9]+_[0-9]+$' THEN '' ELSE (CASE WHEN m.puid ~* '^(CPKR_|ALKR_)?[0-9]+' THEN (regexp_match(m.puid,'^(?:CPKR_|ALKR_)?([0-9]+)','i'))[1] ELSE m.puid END) END)<>''
                   AND p.product_id=(CASE WHEN m.puid ~* '^(CPKR_|ALKR_)?[0-9]+' THEN (regexp_match(m.puid,'^(?:CPKR_|ALKR_)?([0-9]+)','i'))[1] ELSE m.puid END)
                   AND ((CASE WHEN m.puid ~* '^CPKR_' THEN 'CPKR' WHEN m.puid ~* '^ALKR_' THEN 'ALKR' ELSE '' END)='' OR p.mall_code=(CASE WHEN m.puid ~* '^CPKR_' THEN 'CPKR' WHEN m.puid ~* '^ALKR_' THEN 'ALKR' ELSE '' END))
                 )
           ORDER BY CASE WHEN p.product_uid=m.puid THEN 0
                         WHEN p.pi_ii_vi=(CASE WHEN m.puid ~* '^(CPKR_|ALKR_)[0-9]+_[0-9]+(_[0-9]+)?$' THEN regexp_replace(m.puid,'^(CPKR_|ALKR_)','','i') WHEN m.puid ~ '^[0-9]+_[0-9]+_[0-9]+$' THEN m.puid ELSE '' END) THEN 1 ELSE 2 END,
                    COALESCE(p.updated_at,p.last_seen_at) DESC NULLS LAST
           LIMIT 1
        ) p ON TRUE
       WHERE m.run_no=$1 OR m.run_no=0
       ORDER BY CASE WHEN m.run_no=$1 THEN 0 ELSE 1 END,m.representative_no NULLS LAST,m.puid`,[st.run_no]);
    const filename=`gm_image_vector_representative_run_${st.run_no}_${compactTs(new Date())}.csv`;
    res.status(200);
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
    res.write('\uFEFF');
    res.write(['puid','representative_no','representative_puid','similarity','is_representative','run_no','category_keyword','cp_fix_code','cp_selected_code','updated_at'].join(',')+'\r\n');
    for(const r of q.rows||[]){
      res.write([
        r.puid,r.representative_no,r.representative_puid,
        r.similarity==null?'':Number(r.similarity).toFixed(6),r.is_representative,r.run_no,
        r.category_keyword,r.cp_fix_code,r.cp_selected_code,
        r.updated_at instanceof Date?r.updated_at.toISOString():r.updated_at
      ].map(csvCell).join(',')+'\r\n');
    }
    res.end();
    initialLog('INITIAL_EXPORT',{run_no:st.run_no,rows:(q.rows||[]).length,filename});
  }catch(e){
    if(!res.headersSent)return fail(res,500,'representative export failed',{detail:S(e&&e.message||e)});
    try{res.end();}catch(_){}
  }
});

router.get('/api/gm/builder/image-vector/representative/initial/status',(req,res)=>ok(res,{job,preview}));
router.post('/api/gm/builder/image-vector/representative/initial/preview',async(req,res)=>{const db=dbFrom(req);if(job.running)return fail(res,409,'representative initial job running');if(preview.running)return fail(res,409,'representative preview already running');preview={...preview,running:true,completed:false,started_at:new Date().toISOString(),finished_at:null,error:null};setImmediate(()=>void runPreview(db));ok(res,{started:true});});
router.post('/api/gm/builder/image-vector/representative/initial/settings',async(req,res)=>{
  const db=dbFrom(req);
  if(job.running||preview.running)return fail(res,409,'대표선정/사전점검 실행 중에는 RUN 또는 유사율을 변경할 수 없습니다.');
  try{const x=await saveSettings(db,req.body&&req.body.run_no,req.body&&req.body.threshold);initialLog('INITIAL_SETTINGS_SAVE',x);ok(res,x);}
  catch(e){if(e&&e.code==='REPRESENTATIVE_REBUILD_RUNNING')return fail(res,409,'REPRESENTATIVE_REBUILD_RUNNING',{build_id:e.build_id||'',detail:S(e.message)});fail(res,400,'representative settings save failed',{detail:S(e&&e.message||e)});}
});


router.post('/api/gm/builder/image-vector/representative/initial/run',async(req,res)=>{
  const db=dbFrom(req);
  if(job.running)return fail(res,409,'representative initial job already running');
  if(preview.running)return fail(res,409,'representative preview running');
  let builderLockClient=null,buildId='';
  try{
    // Session-level DB lock survives for the whole build and therefore protects against
    // duplicate Builder jobs across multiple Node/Cloudtype instances.
    builderLockClient=await acquireBuilderLock(db);
    if(!builderLockClient)return fail(res,409,'REPRESENTATIVE_REBUILD_RUNNING',{detail:'다른 서버 프로세스에서 대표망 전체 재생성이 실행 중입니다.'});
    buildId='REPBUILD_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
    const bt=await db.query('SELECT clock_timestamp() AS ts');
    const buildStartedAt=bt.rows&&bt.rows[0]&&bt.rows[0].ts||new Date();
    // Set the marker before reading target settings. From this point, settings mutation is
    // globally blocked and the build uses one immutable target RUN/threshold snapshot.
    await beginBuildMarker(db,buildId);
    const st=await settings(db);
    job=Object.assign(freshJob(),{running:true,phase:'QUEUED',started_at:new Date().toISOString(),run_no:st.run_no,threshold:st.threshold});
    initialLog('INITIAL_STAGE_QUEUED',{run_no:st.run_no,threshold:st.threshold,build_id:buildId,live_snapshot_preserved:true,global_builder_lock:true});
    const held=builderLockClient;builderLockClient=null;
    setImmediate(()=>void runInitial(db,st,held,buildId,buildStartedAt));
    ok(res,{started:true,staged:true,atomic_publish:true,live_snapshot_preserved:true,global_builder_lock:true,build_id:buildId,...st});
  }catch(e){
    if(buildId)await clearBuildMarker(db,buildId);
    if(builderLockClient)await releaseBuilderLock(builderLockClient);
    job.running=false;job.phase='ERROR';job.finished_at=new Date().toISOString();job.error=S(e&&e.message||e);
    initialLog('INITIAL_START_ERROR',{run_no:job.run_no,error:job.error});
    fail(res,500,'representative initial start failed',{detail:job.error});
  }
});
module.exports=router;
