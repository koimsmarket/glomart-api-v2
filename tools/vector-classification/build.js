'use strict';
/*
 * GM_VECTOR_CLASSIFICATION_BUILD_V006 (V032)
 *
 * PURPOSE
 *   Build a visual category tree from ORIGINAL 512D vector_image data and write
 *   the COMPLETE result to persistent STAGING tables only.
 *
 * MEMORY POLICY
 *   - DB rows are read in bounded keyset pages.
 *   - One contiguous Float32Array is preallocated after COUNT(*).
 *   - PostgreSQL's large JS row array is never held for the whole dataset.
 *   - For 62,476 vectors the raw normalized vector buffer is ~122 MiB.
 *   - For future 200k vectors it is ~391 MiB, so this algorithm is still not an
 *     unlimited-memory design; however it removes the much larger duplicate
 *     pg-row/JS-array peak present in V031.
 *
 * STAGING POLICY
 *   gm_vector_category_stage : complete tree for GM_VECTOR_CLASS_JOB_ID
 *   gm_vector_class_stage    : product_uid -> temp_class_id
 *   Production tables are NEVER modified by this process.
 *
 * APPLY is intentionally owned by Builder classification.js after staging
 * verification. This separation guarantees a failed/odd classification cannot
 * partially alter the production category tree.
 */

const { Pool } = require('pg');
const DIM=512;
const LEAF_MAX=Math.max(10,Number(process.env.GM_VECTOR_CLASS_LEAF_MAX||100));
const MAX_DEPTH=Math.max(2,Number(process.env.GM_VECTOR_CLASS_MAX_DEPTH||12));
const MAX_CHILDREN=Math.max(2,Math.min(1000,Number(process.env.GM_VECTOR_CLASS_MAX_CHILDREN||1000)));
const ITER=Math.max(2,Math.min(12,Number(process.env.GM_VECTOR_CLASS_ITER||4)));
const TRAIN_SAMPLE_MAX=Math.max(256,Number(process.env.GM_VECTOR_CLASS_TRAIN_SAMPLE_MAX||1024));
const MIN_SPLIT_SIZE=Math.max(10,Number(process.env.GM_VECTOR_CLASS_MIN_SPLIT_SIZE||40));
const COHESION_STOP=Math.max(-1,Math.min(1,Number(process.env.GM_VECTOR_CLASS_COHESION_STOP||0.82)));
const MIN_SPLIT_GAIN=Math.max(0,Number(process.env.GM_VECTOR_CLASS_MIN_SPLIT_GAIN||0.015));
const LOAD_PAGE=Math.max(100,Math.min(10000,Number(process.env.GM_VECTOR_CLASS_LOAD_PAGE||1000)));
const STAGE_BATCH=Math.max(100,Math.min(10000,Number(process.env.GM_VECTOR_CLASS_STAGE_BATCH||5000)));
const GROUPS=String(process.env.GM_VECTOR_CLASS_GROUPS||'FD').split(',').map(s=>s.trim().toUpperCase()).filter(Boolean);
const JOB_ID=String(process.env.GM_VECTOR_CLASS_JOB_ID||'').trim();
const pool=new Pool();

function emitIpc(phase,extra={}){if(typeof process.send!=='function')return;try{process.send({source:'GM_VECTOR_CLASS_BUILD_V006',phase,...extra});}catch(_){}}
function vecOffset(ix){return ix*DIM;}
function dotIndex(buf,ix,center){let s=0,o=vecOffset(ix);for(let d=0;d<DIM;d++)s+=buf[o+d]*center[d];return s;}
function normArrayInto(src,buf,ix){
  let ss=0;for(let d=0;d<DIM;d++){const x=Number(src[d]);if(!Number.isFinite(x))return false;ss+=x*x;}
  const inv=1/(Math.sqrt(ss)||1),o=vecOffset(ix);for(let d=0;d<DIM;d++)buf[o+d]=Number(src[d])*inv;return true;
}
function centerFromIndex(buf,ix){const out=new Float32Array(DIM),o=vecOffset(ix);for(let d=0;d<DIM;d++)out[d]=buf[o+d];return out;}
function normalizeCenter(c){let ss=0;for(let d=0;d<DIM;d++)ss+=c[d]*c[d];const inv=1/(Math.sqrt(ss)||1);for(let d=0;d<DIM;d++)c[d]*=inv;return c;}
function mean(indices,buf){const c=new Float32Array(DIM);for(const ix of indices){let o=vecOffset(ix);for(let d=0;d<DIM;d++)c[d]+=buf[o+d];}if(indices.length){const inv=1/indices.length;for(let d=0;d<DIM;d++)c[d]*=inv;}return normalizeCenter(c);}
function cohesion(indices,buf,center){if(!indices.length)return 1;let s=0;for(const ix of indices)s+=dotIndex(buf,ix,center);return s/indices.length;}
function splitK(n){return Math.max(2,Math.min(MAX_CHILDREN,Math.ceil(Math.sqrt(Math.max(2,n)/LEAF_MAX))));}
function sampleIndices(indices,maxN){if(indices.length<=maxN)return indices.slice();const out=new Array(maxN),step=indices.length/maxN;for(let i=0;i<maxN;i++)out[i]=indices[Math.min(indices.length-1,Math.floor((i+0.5)*step))];return out;}
function seededCenters(train,buf,k,seed){let x=(seed>>>0)||1;const used=new Set(),centers=[];while(centers.length<k){x=(Math.imul(x,1664525)+1013904223)>>>0;const ix=train[x%train.length];if(used.has(ix))continue;used.add(ix);centers.push(centerFromIndex(buf,ix));}return centers;}
function trainCenters(indices,buf,k,seed){
  const train=sampleIndices(indices,TRAIN_SAMPLE_MAX);let centers=seededCenters(train,buf,k,seed);const assign=new Int32Array(train.length);assign.fill(-1);
  for(let it=0;it<ITER;it++){
    const sums=Array.from({length:k},()=>new Float32Array(DIM)),counts=new Int32Array(k);let changed=0;
    for(let p=0;p<train.length;p++){
      const ix=train[p];let best=0,bestScore=-Infinity;for(let c=0;c<k;c++){const score=dotIndex(buf,ix,centers[c]);if(score>bestScore){bestScore=score;best=c;}}
      if(assign[p]!==best){assign[p]=best;changed++;}counts[best]++;const sum=sums[best],o=vecOffset(ix);for(let d=0;d<DIM;d++)sum[d]+=buf[o+d];
    }
    for(let c=0;c<k;c++){
      if(!counts[c]){centers[c]=centerFromIndex(buf,train[(c*997+it*37)%train.length]);continue;}
      const inv=1/counts[c];for(let d=0;d<DIM;d++)sums[c][d]*=inv;centers[c]=normalizeCenter(sums[c]);
    }
    if(!changed)break;
  }
  return centers;
}
function assignAll(indices,buf,centers){const groups=Array.from({length:centers.length},()=>[]);for(const ix of indices){let best=0,bestScore=-Infinity;for(let c=0;c<centers.length;c++){const score=dotIndex(buf,ix,centers[c]);if(score>bestScore){bestScore=score;best=c;}}groups[best].push(ix);}return groups.filter(g=>g.length);}
function buildNode(indices,buf,parent,childNo,depth,tree){
  const id=++tree.value,started=Date.now(),center=mean(indices,buf),coh=cohesion(indices,buf,center);
  const node={tmp_id:id,parent_tmp_id:parent?parent.tmp_id:null,child_no:childNo,depth,count:indices.length,center,cohesion:coh,leaf:false,indices:null};
  tree.nodes.push(node);if(tree.nodes.length===1||tree.nodes.length%25===0)emitIpc('BUILDING',{progress:{nodes:tree.nodes.length,leaf_assigned:tree.leafAssigned,current_depth:depth}});
  const stopByDepth=depth>=MAX_DEPTH,stopBySmall=indices.length<MIN_SPLIT_SIZE,stopByGoodLeaf=indices.length<=LEAF_MAX&&coh>=COHESION_STOP;
  if(stopByDepth||stopBySmall||stopByGoodLeaf){node.leaf=true;node.indices=indices;tree.leafAssigned+=indices.length;console.log('[GM_VECTOR_CLASS_NODE]',{id,depth,count:indices.length,cohesion:Number(coh.toFixed(4)),leaf:true,reason:stopByDepth?'MAX_DEPTH':stopBySmall?'MIN_SPLIT_SIZE':'COHESION_STOP',elapsed_ms:Date.now()-started});return node;}
  const k=splitK(indices.length),centers=trainCenters(indices,buf,k,(id*2654435761)>>>0),groups=assignAll(indices,buf,centers);
  if(groups.length<=1){node.leaf=true;node.indices=indices;tree.leafAssigned+=indices.length;console.log('[GM_VECTOR_CLASS_NODE]',{id,depth,count:indices.length,cohesion:Number(coh.toFixed(4)),leaf:true,reason:'NO_EFFECTIVE_SPLIT',elapsed_ms:Date.now()-started});return node;}
  let childWeighted=0;const stats=[];for(const g of groups){const cc=mean(g,buf),gc=cohesion(g,buf,cc);childWeighted+=gc*g.length;stats.push({group:g,cohesion:gc});}childWeighted/=indices.length;
  const gain=childWeighted-coh;if(indices.length<=LEAF_MAX&&gain<MIN_SPLIT_GAIN){node.leaf=true;node.indices=indices;tree.leafAssigned+=indices.length;console.log('[GM_VECTOR_CLASS_NODE]',{id,depth,count:indices.length,cohesion:Number(coh.toFixed(4)),leaf:true,reason:'LOW_SPLIT_GAIN',split_gain:Number(gain.toFixed(4)),elapsed_ms:Date.now()-started});return node;}
  stats.sort((a,b)=>b.group.length-a.group.length);console.log('[GM_VECTOR_CLASS_NODE]',{id,depth,count:indices.length,cohesion:Number(coh.toFixed(4)),leaf:false,children:stats.length,split_gain:Number(gain.toFixed(4)),elapsed_ms:Date.now()-started});
  for(let i=0;i<stats.length;i++)buildNode(stats[i].group,buf,node,i+1,depth+1,tree);return node;
}
function pgArray(v){return '{'+Array.from(v,x=>Number(x).toPrecision(9)).join(',')+'}';}
async function ensureStageSchema(){
  await pool.query(`CREATE TABLE IF NOT EXISTS gm_vector_category_stage(job_id text NOT NULL,temp_class_id bigint NOT NULL,parent_temp_class_id bigint NULL,child_no integer NOT NULL,depth integer NOT NULL DEFAULT 0,vector_center real[] NOT NULL,is_leaf boolean NOT NULL,product_count integer NOT NULL DEFAULT 0,cohesion real NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(job_id,temp_class_id))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS gm_vector_class_stage(job_id text NOT NULL,product_uid text NOT NULL,temp_class_id bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(job_id,product_uid))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gm_vector_class_stage_job_class ON gm_vector_class_stage(job_id,temp_class_id)`);
}
async function validateScope(){const q=await pool.query(`SELECT category_group,COUNT(*)::int AS n FROM gm_product_image_vector WHERE category_group=ANY($1::text[]) GROUP BY category_group ORDER BY category_group`,[GROUPS]);return q.rows;}
async function validCount(){const q=await pool.query(`SELECT COUNT(*)::int AS n FROM gm_product_image_vector WHERE category_group=ANY($1::text[]) AND vector_image IS NOT NULL AND array_length(vector_image,1)=512`,[GROUPS]);return Number(q.rows[0]&&q.rows[0].n||0);}
async function loadBounded(expected){
  const uids=new Array(expected),buf=new Float32Array(expected*DIM);let loaded=0,last='';
  while(true){
    const q=await pool.query(`SELECT product_uid,vector_image FROM gm_product_image_vector WHERE category_group=ANY($1::text[]) AND vector_image IS NOT NULL AND array_length(vector_image,1)=512 AND product_uid>$2 ORDER BY product_uid LIMIT $3`,[GROUPS,last,LOAD_PAGE]);
    if(!q.rows.length)break;
    for(const r of q.rows){const a=Array.isArray(r.vector_image)?r.vector_image:null;if(!a||a.length!==DIM||!normArrayInto(a,buf,loaded))throw new Error(`INVALID_VECTOR product_uid=${r.product_uid}`);uids[loaded]=String(r.product_uid);loaded++;}
    last=String(q.rows[q.rows.length-1].product_uid);emitIpc('LOADING',{progress:{vectors:loaded,total_vectors:expected,nodes:0,leaf_assigned:0,current_depth:0}});console.log('[GM_VECTOR_CLASS_LOAD_BATCH]',{loaded,total:expected,last_uid:last});if(q.rows.length<LOAD_PAGE)break;
  }
  if(loaded!==expected)throw new Error(`LOAD_COUNT_MISMATCH expected=${expected} actual=${loaded}`);return{uids,buf};
}
async function writeStage(tree,uids){
  const c=await pool.connect();try{
    await c.query('BEGIN');await c.query(`DELETE FROM gm_vector_class_stage WHERE job_id=$1`,[JOB_ID]);await c.query(`DELETE FROM gm_vector_category_stage WHERE job_id=$1`,[JOB_ID]);
    for(const n of tree.nodes){await c.query(`INSERT INTO gm_vector_category_stage(job_id,temp_class_id,parent_temp_class_id,child_no,depth,vector_center,is_leaf,product_count,cohesion) VALUES($1,$2,$3,$4,$5,$6::real[],$7,$8,$9)`,[JOB_ID,n.tmp_id,n.parent_tmp_id,n.child_no,n.depth,pgArray(n.center),n.leaf,n.count,n.cohesion]);}
    let done=0;for(const n of tree.nodes){if(!n.leaf||!n.indices)continue;for(let i=0;i<n.indices.length;i+=STAGE_BATCH){const part=n.indices.slice(i,i+STAGE_BATCH);await c.query(`INSERT INTO gm_vector_class_stage(job_id,product_uid,temp_class_id) SELECT $1,x.uid,$2 FROM UNNEST($3::text[]) AS x(uid)`,[JOB_ID,n.tmp_id,part.map(ix=>uids[ix])]);done+=part.length;emitIpc('STAGING',{progress:{vectors:uids.length,nodes:tree.nodes.length,leaf_assigned:done,current_depth:n.depth}});}}
    const v=await c.query(`WITH t AS (SELECT COUNT(*)::int nodes,COUNT(*) FILTER(WHERE is_leaf)::int leaves,COALESCE(SUM(product_count) FILTER(WHERE is_leaf),0)::bigint leaf_sum FROM gm_vector_category_stage WHERE job_id=$1),a AS (SELECT COUNT(*)::int assignments,COUNT(DISTINCT product_uid)::int distinct_products FROM gm_vector_class_stage WHERE job_id=$1),o AS (SELECT COUNT(*)::int orphan FROM gm_vector_class_stage s WHERE s.job_id=$1 AND NOT EXISTS(SELECT 1 FROM gm_vector_category_stage c WHERE c.job_id=s.job_id AND c.temp_class_id=s.temp_class_id AND c.is_leaf=true)) SELECT * FROM t CROSS JOIN a CROSS JOIN o`,[JOB_ID]);const vr=v.rows[0]||{};
    if(Number(vr.assignments)!==uids.length||Number(vr.distinct_products)!==uids.length||Number(vr.leaf_sum)!==uids.length||Number(vr.orphan)!==0)throw new Error(`STAGE_VERIFY_FAILED assignments=${vr.assignments} distinct=${vr.distinct_products} leaf_sum=${vr.leaf_sum} orphan=${vr.orphan} expected=${uids.length}`);
    await c.query('COMMIT');return{job_id:JOB_ID,nodes:Number(vr.nodes||0),leaves:Number(vr.leaves||0),assignments:Number(vr.assignments||0),leaf_product_count:Number(vr.leaf_sum||0),orphan_assignments:Number(vr.orphan||0)};
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}

(async()=>{const started=Date.now();try{
  if(!JOB_ID)throw new Error('GM_VECTOR_CLASS_JOB_ID_REQUIRED');
  emitIpc('START',{progress:{nodes:0,leaf_assigned:0,current_depth:0}});console.log('[GM_VECTOR_CLASS_BUILD_V006] START',{job_id:JOB_ID,scope:GROUPS.join(','),leaf_max:LEAF_MAX,max_depth:MAX_DEPTH,min_split_size:MIN_SPLIT_SIZE,cohesion_stop:COHESION_STOP,min_split_gain:MIN_SPLIT_GAIN,iter:ITER,train_sample_max:TRAIN_SAMPLE_MAX,load_page:LOAD_PAGE});
  await ensureStageSchema();const scope=await validateScope();console.log('[GM_VECTOR_CLASS_BUILD_V006] PRODUCT_SCOPE',scope);emitIpc('PRODUCT_SCOPE',{scope});
  const expected=await validCount();if(!expected)throw new Error('NO_VECTORS_IN_SCOPE');
  const loadStarted=Date.now(),{uids,buf}=await loadBounded(expected);console.log('[GM_VECTOR_CLASS_BUILD_V006] LOADED',{vectors:uids.length,buffer_mib:Number((buf.byteLength/1024/1024).toFixed(2)),elapsed_ms:Date.now()-loadStarted});emitIpc('LOADED',{progress:{vectors:uids.length,nodes:0,leaf_assigned:0,current_depth:0}});
  const all=Array.from({length:uids.length},(_,i)=>i),tree={nodes:[],value:0,leafAssigned:0},buildStarted=Date.now();buildNode(all,buf,null,1,0,tree);
  const leaves=tree.nodes.filter(n=>n.leaf),depths=leaves.map(n=>n.depth),sizes=leaves.map(n=>n.count);if(tree.leafAssigned!==uids.length)throw new Error(`LEAF_ASSIGN_COUNT_MISMATCH expected=${uids.length} actual=${tree.leafAssigned}`);
  const result={job_id:JOB_ID,vectors:uids.length,nodes:tree.nodes.length,leaves:leaves.length,max_depth:Math.max(...depths),avg_leaf:Number((sizes.reduce((a,b)=>a+b,0)/sizes.length).toFixed(2)),min_leaf:Math.min(...sizes),max_leaf:Math.max(...sizes),avg_leaf_cohesion:Number((leaves.reduce((a,n)=>a+n.cohesion,0)/leaves.length).toFixed(4)),assigned_check:tree.leafAssigned,build_elapsed_ms:Date.now()-buildStarted,total_elapsed_ms:Date.now()-started};
  console.log('[GM_VECTOR_CLASS_BUILD_V006] RESULT',result);emitIpc('RESULT',{result,progress:{vectors:uids.length,nodes:tree.nodes.length,leaf_assigned:tree.leafAssigned,current_depth:result.max_depth}});
  const staged=await writeStage(tree,uids);console.log('[GM_VECTOR_CLASS_BUILD_V006] STAGED',staged);emitIpc('STAGED',{result:{...result,stage:staged}});console.log('[GM_VECTOR_CLASS_BUILD_V006] COMPLETE',{job_id:JOB_ID,total_elapsed_ms:Date.now()-started});
}catch(e){console.error('[GM_VECTOR_CLASS_BUILD_V006] FAIL',e&&e.stack||e);emitIpc('FAILED',{error:String(e&&e.message||e)});process.exitCode=1;}finally{await pool.end();}})();
