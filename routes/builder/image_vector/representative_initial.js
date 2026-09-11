'use strict';
// GM_BUILDER_IMAGE_VECTOR_REPRESENTATIVE_INITIAL_V015_PROGRESS_TRACE
// Initial/full representative-map builder.
// V010: reference-backed category resolver, category-at-a-time vector loading,
//       atomic group commits, resume/skip for completed groups, batched DB writes.
// gm_category / gm_category_dynamic / gm_product / source vectors are READ ONLY.

const express=require('express');
const router=express.Router();
const {dbFrom,ok,fail}=require('../core');
const DIM=512;
let job=freshJob();
let preview={running:false,completed:false,started_at:null,finished_at:null,total_vector:0,candidate_vector:0,category_resolved:0,category_unresolved:0,categories_total:0,reason_counts:{},error:null};
function freshJob(){return {running:false,phase:'IDLE',started_at:null,finished_at:null,run_no:null,threshold:null,total_vector:0,candidate_vector:0,category_resolved:0,category_unresolved:0,excluded_run0:0,processed:0,skipped:0,categories_total:0,categories_done:0,categories_skipped:0,representatives:0,last_category:null,current_category_keyword:null,current_category_count:0,current_category_processed:0,current_category_index:0,current_category_representatives:0,last_representative_no:0,error:null};}
function previewLog(stage,data){
  try{console.log(`[GM_IMAGE_VECTOR_REPRESENTATIVE_PREVIEW_V014] ${stage} ${JSON.stringify(data||{})}`);}catch(_){console.log(`[GM_IMAGE_VECTOR_REPRESENTATIVE_PREVIEW_V014] ${stage}`);}
}
function initialLog(stage,data){
  try{console.log(`[GM_IMAGE_VECTOR_REPRESENTATIVE_INITIAL_V015] ${stage} ${JSON.stringify(data||{})}`);}catch(_){console.log(`[GM_IMAGE_VECTOR_REPRESENTATIVE_INITIAL_V015] ${stage}`);}
}
const yieldEventLoop=()=>new Promise(resolve=>setImmediate(resolve));
function S(v){return String(v==null?'':v).trim();}
function N(v,d=0){const n=Number(v);return Number.isFinite(n)?n:d;}
function norm(v){return S(v).replace(/\s+/g,' ').trim();}
function cosine(a,b){let dot=0,aa=0,bb=0;for(let i=0;i<DIM;i++){const x=Number(a[i])||0,y=Number(b[i])||0;dot+=x*y;aa+=x*x;bb+=y*y;}return aa>0&&bb>0?dot/Math.sqrt(aa*bb):-1;}
async function config(db,key,def){const r=await db.query('SELECT config_value FROM gm_runtime_config WHERE config_key=$1',[key]);return r.rows.length?r.rows[0].config_value:def;}
async function settings(db){const runNo=Math.max(1,Math.trunc(N(await config(db,'image_vector_representative_run','1'),1)));const threshold=N(await config(db,'image_vector_representative_similarity','0.95'),0.95);if(!(threshold>0&&threshold<=1))throw new Error('대표이미지 유사율은 0 초과 1 이하여야 합니다.');return {run_no:runNo,threshold};}

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
  const r=await db.query(`SELECT v.product_uid AS puid,p.cp_fix_code,p.cp_selected_code,p.category_keyword,p.keyword
    FROM gm_product_image_vector v LEFT JOIN gm_product p ON p.product_uid=v.product_uid
    WHERE v.vector_image IS NOT NULL AND array_length(v.vector_image,1)=$1 ORDER BY v.product_uid`,[DIM]);
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
async function currentRunSet(db,runNo){const r=await db.query('SELECT puid FROM gm_image_vector_representative_map WHERE run_no=$1',[runNo]);return new Set((r.rows||[]).map(x=>S(x.puid)).filter(Boolean));}
async function maxRepresentativeNo(db){const r=await db.query('SELECT COALESCE(MAX(representative_no),0)::bigint AS n FROM gm_image_vector_representative_map');return Number(r.rows[0]&&r.rows[0].n||0);}
async function allocateRepresentativeNos(client,count){if(count<=0)return[];await client.query('SELECT pg_advisory_xact_lock($1)',[20911001]);const q=await client.query('SELECT COALESCE(MAX(representative_no),0)::bigint AS max_no FROM gm_image_vector_representative_map');const start=Number(q.rows[0].max_no||0)+1;return Array.from({length:count},(_,i)=>start+i);}

async function markRun0(db,puids){
  if(!puids.length)return 0;
  const chunk=1000;let done=0;
  for(let i=0;i<puids.length;i+=chunk){const a=puids.slice(i,i+chunk);await db.query(`INSERT INTO gm_image_vector_representative_map(puid,representative_no,representative_puid,similarity,run_no,updated_at)
    SELECT x,NULL,NULL,NULL,0,now() FROM unnest($1::text[]) x
    ON CONFLICT(puid) DO UPDATE SET representative_no=NULL,representative_puid=NULL,similarity=NULL,run_no=0,updated_at=now()`,[a]);done+=a.length;}
  return done;
}

async function processCategory(db,groupKey,rows,runNo,threshold,onProgress){
  const reps=[],mapped=[];
  let rowNo=0;for(const row of rows){const puid=S(row.puid),v=row.vector_image;if(!puid||!Array.isArray(v)||v.length!==DIM)continue;let best=null,bestScore=-2;for(const rep of reps){const score=cosine(v,rep.vector);if(score>bestScore){bestScore=score;best=rep;}}if(!best||bestScore<threshold){const rep={puid,vector:v,no:null};reps.push(rep);mapped.push({puid,rep,similarity:1});}else mapped.push({puid,rep:best,similarity:bestScore});rowNo++;if(onProgress&&(rowNo===1||(rowNo%20)===0||rowNo===rows.length))onProgress({processed:rowNo,representatives:reps.length,total:rows.length});if((rowNo%20)===0)await yieldEventLoop();}
  const client=await db.connect();
  try{
    await client.query('BEGIN');
    const nos=await allocateRepresentativeNos(client,reps.length);reps.forEach((r,i)=>{r.no=nos[i];});
    if(mapped.length){
      await client.query(`INSERT INTO gm_image_vector_representative_map(puid,representative_no,representative_puid,similarity,run_no,updated_at)
        SELECT * FROM unnest($1::text[],$2::bigint[],$3::text[],$4::real[],$5::int[],$6::timestamptz[])
        ON CONFLICT(puid) DO UPDATE SET representative_no=EXCLUDED.representative_no,representative_puid=EXCLUDED.representative_puid,similarity=EXCLUDED.similarity,run_no=EXCLUDED.run_no,updated_at=EXCLUDED.updated_at`,
        [mapped.map(m=>m.puid),mapped.map(m=>m.rep.no),mapped.map(m=>m.rep.puid),mapped.map(m=>m.similarity),mapped.map(()=>runNo),mapped.map(()=>new Date())]);
    }
    if(reps.length){
      await client.query('DELETE FROM gm_image_vector_representative_stat WHERE run_no=$1 AND representative_puid = ANY($2::text[])',[runNo,rows.map(r=>S(r.puid)).filter(Boolean)]);
      const stat=[];for(const rep of reps){const ms=mapped.filter(m=>m.rep===rep&&m.puid!==rep.puid).map(m=>m.similarity);stat.push({rep,count:ms.length,avg:ms.length?ms.reduce((a,b)=>a+b,0)/ms.length:null,min:ms.length?Math.min(...ms):null,max:ms.length?Math.max(...ms):null});}
      await client.query(`INSERT INTO gm_image_vector_representative_stat(representative_no,representative_puid,run_no,member_count,avg_similarity,min_similarity,max_similarity,updated_at)
        SELECT * FROM unnest($1::bigint[],$2::text[],$3::int[],$4::int[],$5::real[],$6::real[],$7::real[],$8::timestamptz[])
        ON CONFLICT(representative_puid,run_no) DO UPDATE SET representative_no=EXCLUDED.representative_no,member_count=EXCLUDED.member_count,avg_similarity=EXCLUDED.avg_similarity,min_similarity=EXCLUDED.min_similarity,max_similarity=EXCLUDED.max_similarity,updated_at=EXCLUDED.updated_at`,
        [stat.map(x=>x.rep.no),stat.map(x=>x.rep.puid),stat.map(()=>runNo),stat.map(x=>x.count),stat.map(x=>x.avg),stat.map(x=>x.min),stat.map(x=>x.max),stat.map(()=>new Date())]);
    }
    await client.query('COMMIT');
    return {members:mapped.length,reps:reps.length,last_no:nos.length?nos[nos.length-1]:0};
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
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

async function runInitial(db,startSettings){
  const s=startSettings||await settings(db);
  job=Object.assign(job,{running:true,phase:'REFERENCE',started_at:job.started_at||new Date().toISOString(),run_no:s.run_no,threshold:s.threshold,error:null});
  initialLog('INITIAL_START',{started_at:job.started_at,run_no:s.run_no,threshold:s.threshold});
  try{
    const ref=await loadCategoryReference(db);
    initialLog('INITIAL_REFERENCE_READY',{by_code:ref.byCode.size,exact:ref.exact.size,keyword:ref.keyword.size,seed:ref.seed.size,list:ref.list.size,slash:ref.slash.size});
    job.phase='RESOLVE';
    const meta=await loadMetadata(db,ref);
    job.total_vector=meta.total;job.candidate_vector=meta.candidate;job.category_resolved=meta.resolved;job.category_unresolved=meta.unresolved.length;job.excluded_run0=meta.unresolved.length;job.categories_total=meta.groups.size;
    initialLog('INITIAL_METADATA_DONE',{total_vector:meta.total,candidate_vector:meta.candidate,category_resolved:meta.resolved,category_unresolved:meta.unresolved.length,categories_total:meta.groups.size});
    // run_no=0 only for vectors for which no valid category reference can be resolved.
    job.phase='RUN0';
    await markRun0(db,meta.unresolved);
    initialLog('INITIAL_RUN0_DONE',{excluded_run0:meta.unresolved.length});
    const doneSet=await currentRunSet(db,s.run_no);job.last_representative_no=await maxRepresentativeNo(db);
    job.phase='PROCESS';
    initialLog('INITIAL_PROCESS_START',{categories_total:meta.groups.size,current_run_existing:doneSet.size,last_representative_no:job.last_representative_no});
    let categoryIndex=0;
    for(const g of meta.groups.values()){
      categoryIndex++;
      job.last_category=g.key;
      job.current_category_keyword=g.keyword||g.key;
      job.current_category_count=g.puids.length;
      job.current_category_processed=0;
      job.current_category_index=categoryIndex;
      job.current_category_representatives=0;
      // Each group is committed atomically. If every member is already current, resume skips it.
      if(g.puids.length&&g.puids.every(x=>doneSet.has(x))){
        job.skipped+=g.puids.length;job.current_category_processed=g.puids.length;job.categories_skipped++;job.categories_done++;
        if(categoryIndex===1||(categoryIndex%25)===0||categoryIndex===meta.groups.size)initialLog('INITIAL_PROGRESS',{category_index:categoryIndex,categories_total:meta.groups.size,keyword:job.current_category_keyword,category_count:g.puids.length,processed:job.processed,skipped:job.skipped,representatives:job.representatives,last_representative_no:job.last_representative_no});
        continue;
      }
      const rows=await loadVectorsForGroup(db,g.puids);
      const r=await processCategory(db,g.key,rows,s.run_no,s.threshold,(p)=>{job.current_category_processed=p.processed;job.current_category_representatives=p.representatives;});
      job.processed+=r.members;job.representatives+=r.reps;job.current_category_processed=r.members;job.current_category_representatives=r.reps;job.last_representative_no=Math.max(job.last_representative_no,r.last_no||0);job.categories_done++;for(const x of g.puids)doneSet.add(x);
      if(categoryIndex===1||(categoryIndex%25)===0||categoryIndex===meta.groups.size)initialLog('INITIAL_PROGRESS',{category_index:categoryIndex,categories_total:meta.groups.size,keyword:job.current_category_keyword,category_count:g.puids.length,processed:job.processed,skipped:job.skipped,representatives:job.representatives,last_representative_no:job.last_representative_no});
      await yieldEventLoop();
    }
    job.running=false;job.phase='DONE';job.finished_at=new Date().toISOString();job.current_category_processed=job.current_category_count;
    initialLog('INITIAL_DONE',{started_at:job.started_at,finished_at:job.finished_at,total_vector:job.total_vector,category_resolved:job.category_resolved,excluded_run0:job.excluded_run0,processed:job.processed,skipped:job.skipped,categories_done:job.categories_done,categories_total:job.categories_total,representatives:job.representatives,last_representative_no:job.last_representative_no});
  }catch(e){
    job.running=false;job.phase='ERROR';job.finished_at=new Date().toISOString();job.error=S(e&&e.message||e);
    initialLog('INITIAL_ERROR',{started_at:job.started_at,finished_at:job.finished_at,phase:job.phase,keyword:job.current_category_keyword,error:job.error});
  }
}
router.get('/api/gm/builder/image-vector/representative/initial/status',(req,res)=>ok(res,{job,preview}));
router.post('/api/gm/builder/image-vector/representative/initial/preview',async(req,res)=>{const db=dbFrom(req);if(job.running)return fail(res,409,'representative initial job running');if(preview.running)return fail(res,409,'representative preview already running');preview={...preview,running:true,completed:false,started_at:new Date().toISOString(),finished_at:null,error:null};setImmediate(()=>void runPreview(db));ok(res,{started:true});});
router.post('/api/gm/builder/image-vector/representative/initial/run',async(req,res)=>{const db=dbFrom(req);if(job.running)return fail(res,409,'representative initial job already running');try{const st=await settings(db);job=Object.assign(freshJob(),{running:true,phase:'QUEUED',started_at:new Date().toISOString(),run_no:st.run_no,threshold:st.threshold});setImmediate(()=>void runInitial(db,st));ok(res,{started:true,...st});}catch(e){job=freshJob();fail(res,500,'representative initial start failed',{detail:S(e&&e.message||e)});}});
module.exports=router;
