'use strict';
// GM_BUILDER_IMAGE_VECTOR_CLASSIFICATION_V002
//
// PURPOSE
//   Builder control plane for periodic visual-vector classification.
//
// V032 POLICY
//   1) Classification first writes the full result to STAGING tables.
//   2) Production gm_vector_category / gm_product_image_vector.class_id are not
//      touched while STAGING is being built.
//   3) User reviews STAGING counts / lightweight CSV exports.
//   4) APPLY copies a verified STAGING result to production in one transaction.
//   5) STAGING is intentionally kept after APPLY. It is deleted automatically
//      immediately before the NEXT classification build, or manually with the
//      Builder "STAGING 삭제" button.
//   6) Existing IMAGE VECTOR BACKGROUND OFF/AUTO/ON semantics are untouched.
//
// STAGING TABLES
//   gm_vector_category_stage : temporary visual category tree for one job
//   gm_vector_class_stage    : product_uid -> temporary category code
//
// These are persistent work tables, NOT PostgreSQL TEMP tables, so the latest
// result survives process restarts until the next build/manual delete.

const express = require('express');
const router = express.Router();
const path = require('path');
const { fork } = require('child_process');
const { dbFrom } = require('../core');

const VERSION = 'GM_BUILDER_IMAGE_VECTOR_CLASSIFICATION_V002';
const BUILD_SCRIPT = path.resolve(__dirname, '../../../tools/vector-classification/build.js');
const LOG_LIMIT = 160;

const state = {
  running: false,
  mode: null,
  groups: [],
  job_id: null,
  pid: null,
  started_at: null,
  finished_at: null,
  exit_code: null,
  phase: 'IDLE',
  progress: null,
  result: null,
  applied: null,
  error: null,
  logs: []
};

function nowIso(){ return new Date().toISOString(); }
function compactTs(){
  const d=new Date(); const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function newJobId(groups){ return `${groups.join('_')}_${compactTs()}`; }
function parseGroups(raw) {
  const groups = String(raw || 'FD').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean);
  if (!groups.length) throw new Error('NO_GROUPS');
  for (const g of groups) if (!/^[A-Z]{2}$/.test(g)) throw new Error(`INVALID_GROUP:${g}`);
  return [...new Set(groups)];
}
function pushLog(line) {
  const s = String(line || '').trim();
  if (!s) return;
  state.logs.push(s);
  if (state.logs.length > LOG_LIMIT) state.logs.splice(0, state.logs.length - LOG_LIMIT);
}
function csv(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}
function filenameDate(){ return compactTs(); }

async function ensureStageSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS gm_vector_category_stage (
      job_id text NOT NULL,
      temp_class_id bigint NOT NULL,
      parent_temp_class_id bigint NULL,
      child_no integer NOT NULL,
      depth integer NOT NULL DEFAULT 0,
      vector_center real[] NOT NULL,
      is_leaf boolean NOT NULL,
      product_count integer NOT NULL DEFAULT 0,
      cohesion real NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (job_id, temp_class_id)
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS gm_vector_class_stage (
      job_id text NOT NULL,
      product_uid text NOT NULL,
      temp_class_id bigint NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (job_id, product_uid)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_gm_vector_class_stage_job_class ON gm_vector_class_stage(job_id,temp_class_id)`);
}

async function clearStage(db) {
  await ensureStageSchema(db);
  // Only work data is removed. The reusable table definitions remain.
  const a = await db.query(`DELETE FROM gm_vector_class_stage`);
  const b = await db.query(`DELETE FROM gm_vector_category_stage`);
  return { assignments_deleted:a.rowCount||0, categories_deleted:b.rowCount||0 };
}

async function latestStageJob(db) {
  await ensureStageSchema(db);
  const q = await db.query(`
    SELECT job_id, MAX(created_at) AS created_at
      FROM (
        SELECT job_id, created_at FROM gm_vector_category_stage
        UNION ALL
        SELECT job_id, created_at FROM gm_vector_class_stage
      ) s
     GROUP BY job_id
     ORDER BY MAX(created_at) DESC
     LIMIT 1
  `);
  return q.rows[0] || null;
}

async function stageSummary(db, jobId) {
  await ensureStageSchema(db);
  if (!jobId) return { job_id:null,nodes:0,leaves:0,leaf_product_count:0,assignments:0,orphan_assignments:0,duplicate_assignments:0 };
  const q = await db.query(`
    WITH tree AS (
      SELECT COUNT(*)::int AS nodes,
             COUNT(*) FILTER (WHERE is_leaf)::int AS leaves,
             COALESCE(SUM(product_count) FILTER (WHERE is_leaf),0)::bigint AS leaf_product_count
        FROM gm_vector_category_stage
       WHERE job_id=$1
    ), assn AS (
      SELECT COUNT(*)::int AS assignments,
             COUNT(DISTINCT product_uid)::int AS distinct_products
        FROM gm_vector_class_stage
       WHERE job_id=$1
    ), orphan AS (
      SELECT COUNT(*)::int AS orphan_assignments
        FROM gm_vector_class_stage a
       WHERE a.job_id=$1
         AND NOT EXISTS (
           SELECT 1 FROM gm_vector_category_stage c
            WHERE c.job_id=a.job_id
              AND c.temp_class_id=a.temp_class_id
              AND c.is_leaf=true
         )
    )
    SELECT tree.*, assn.assignments,
           (assn.assignments-assn.distinct_products)::int AS duplicate_assignments,
           orphan.orphan_assignments
      FROM tree CROSS JOIN assn CROSS JOIN orphan
  `,[jobId]);
  return {job_id:jobId,...(q.rows[0]||{})};
}

async function databaseSummary(db, groups) {
  const q = await db.query(`
    WITH selected AS (
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE class_id IS NOT NULL)::int AS assigned,
             COUNT(*) FILTER (WHERE class_id IS NULL)::int AS unassigned
        FROM gm_product_image_vector
       WHERE category_group = ANY($1::text[])
         AND vector_image IS NOT NULL
         AND array_length(vector_image,1)=512
    ), assigned_all AS (
      SELECT COUNT(*)::int AS assigned_all FROM gm_product_image_vector WHERE class_id IS NOT NULL
    ), tree AS (
      SELECT COUNT(*)::int AS nodes,
             COUNT(*) FILTER (WHERE is_leaf)::int AS leaves,
             COALESCE(SUM(product_count) FILTER (WHERE is_leaf),0)::bigint AS leaf_product_count
        FROM gm_vector_category
    ), orphan AS (
      SELECT COUNT(*)::int AS orphan_assignments
        FROM gm_product_image_vector v
       WHERE v.class_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM gm_vector_category c WHERE c.id=v.class_id)
    )
    SELECT * FROM selected CROSS JOIN assigned_all CROSS JOIN tree CROSS JOIN orphan
  `, [groups]);
  return q.rows[0] || {};
}

router.get('/api/gm/builder/image-vector/classification/status', async (req,res) => {
  let groups;
  try { groups = parseGroups(req.query.groups || (state.groups.length ? state.groups.join(',') : 'FD')); }
  catch (e) { return res.status(400).json({ok:false,version:VERSION,error:String(e.message||e)}); }
  try {
    const db=dbFrom(req);
    await ensureStageSchema(db);
    const latest=await latestStageJob(db);
    const jobId=state.job_id || (latest&&latest.job_id) || null;
    const [summary,stage] = await Promise.all([databaseSummary(db,groups),stageSummary(db,jobId)]);
    res.json({ok:true,version:VERSION,state:{...state,logs:state.logs.slice(-100)},database:{groups,...summary},stage});
  } catch (e) {
    res.status(500).json({ok:false,version:VERSION,error:'STATUS_FAILED',detail:String(e&&e.message||e),state});
  }
});

// Build a NEW STAGING classification. Previous STAGING is deleted only here,
// immediately before the next job starts, exactly per the agreed policy.
router.post('/api/gm/builder/image-vector/classification/start', express.json({limit:'64kb'}), async (req,res) => {
  if (state.running) return res.status(409).json({ok:false,version:VERSION,error:'CLASSIFICATION_ALREADY_RUNNING',state});
  let groups;
  try { groups = parseGroups(req.body && req.body.groups); }
  catch (e) { return res.status(400).json({ok:false,version:VERSION,error:String(e.message||e)}); }

  const db=dbFrom(req);
  try { await clearStage(db); }
  catch(e){ return res.status(500).json({ok:false,version:VERSION,error:'STAGE_PREPARE_FAILED',detail:String(e&&e.message||e)}); }

  const jobId=newJobId(groups);
  state.running=true;
  state.mode='STAGING_BUILD';
  state.groups=groups;
  state.job_id=jobId;
  state.pid=null;
  state.started_at=nowIso();
  state.finished_at=null;
  state.exit_code=null;
  state.phase='STARTING';
  state.progress=null;
  state.result=null;
  state.applied=null;
  state.error=null;
  state.logs=[];

  const child=fork(BUILD_SCRIPT,[],{
    cwd:path.resolve(__dirname,'../../..'),
    env:{...process.env,GM_VECTOR_CLASS_GROUPS:groups.join(','),GM_VECTOR_CLASS_JOB_ID:jobId,GM_VECTOR_CLASS_IPC:'1'},
    silent:true
  });
  state.pid=child.pid;
  child.stdout.on('data',b=>String(b).split(/\r?\n/).forEach(pushLog));
  child.stderr.on('data',b=>String(b).split(/\r?\n/).forEach(pushLog));
  child.on('message',msg=>{
    if(!msg||msg.source!=='GM_VECTOR_CLASS_BUILD_V006')return;
    if(msg.phase)state.phase=msg.phase;
    if(msg.progress)state.progress=msg.progress;
    if(msg.result)state.result=msg.result;
    if(msg.error)state.error=msg.error;
  });
  child.on('error',e=>{state.error=String(e&&e.message||e);state.phase='FAILED';});
  child.on('exit',code=>{
    state.running=false;state.exit_code=code;state.finished_at=nowIso();
    if(code===0)state.phase='STAGED';
    else{state.phase='FAILED';if(!state.error)state.error=`PROCESS_EXIT_${code}`;}
  });

  res.json({ok:true,version:VERSION,started:true,mode:state.mode,groups,job_id:jobId,pid:state.pid,started_at:state.started_at});
});

// Copy the fully verified STAGING result to production in ONE transaction.
router.post('/api/gm/builder/image-vector/classification/apply', express.json({limit:'64kb'}), async (req,res) => {
  if(state.running)return res.status(409).json({ok:false,version:VERSION,error:'CLASSIFICATION_RUNNING'});
  const db=dbFrom(req);
  let groups;
  try { groups=parseGroups(req.body&&req.body.groups); }
  catch(e){ return res.status(400).json({ok:false,version:VERSION,error:String(e.message||e)}); }

  let client;
  try{
    await ensureStageSchema(db);
    const latest=await latestStageJob(db);
    const jobId=String((req.body&&req.body.job_id)||(latest&&latest.job_id)||'').trim();
    if(!jobId)return res.status(400).json({ok:false,version:VERSION,error:'NO_STAGING_JOB'});

    const before=await stageSummary(db,jobId);
    const expectedQ=await db.query(`
      SELECT COUNT(*)::int AS n
        FROM gm_product_image_vector
       WHERE category_group=ANY($1::text[])
         AND vector_image IS NOT NULL
         AND array_length(vector_image,1)=512
    `,[groups]);
    const expected=Number(expectedQ.rows[0]&&expectedQ.rows[0].n||0);
    if(!before.nodes||!before.leaves)throw new Error('STAGE_TREE_EMPTY');
    if(before.assignments!==expected)throw new Error(`STAGE_ASSIGNMENT_COUNT_MISMATCH expected=${expected} actual=${before.assignments}`);
    if(Number(before.leaf_product_count)!==expected)throw new Error(`STAGE_LEAF_COUNT_MISMATCH expected=${expected} actual=${before.leaf_product_count}`);
    if(Number(before.orphan_assignments)!==0)throw new Error(`STAGE_ORPHAN_ASSIGNMENTS=${before.orphan_assignments}`);
    if(Number(before.duplicate_assignments)!==0)throw new Error(`STAGE_DUPLICATE_ASSIGNMENTS=${before.duplicate_assignments}`);

    client=await db.connect();
    await client.query('BEGIN');
    await client.query(`UPDATE gm_product_image_vector SET class_id=NULL WHERE class_id IS NOT NULL`);
    await client.query(`DELETE FROM gm_vector_category`);

    const rows=await client.query(`
      SELECT temp_class_id,parent_temp_class_id,child_no,depth,vector_center,is_leaf,product_count
        FROM gm_vector_category_stage
       WHERE job_id=$1
       ORDER BY depth,temp_class_id
    `,[jobId]);
    const map=new Map();
    for(const n of rows.rows){
      const parent=n.parent_temp_class_id==null?null:map.get(String(n.parent_temp_class_id));
      if(n.parent_temp_class_id!=null&&!parent)throw new Error(`STAGE_PARENT_MAPPING_MISSING temp=${n.temp_class_id}`);
      const r=await client.query(`
        INSERT INTO gm_vector_category(parent_id,child_no,vector_center,is_leaf,product_count)
        VALUES($1,$2,$3::real[],$4,$5) RETURNING id
      `,[parent,n.child_no,n.vector_center,n.is_leaf,n.product_count]);
      map.set(String(n.temp_class_id),Number(r.rows[0].id));
    }

    // Map temporary leaf IDs to final DB IDs and update products in bounded batches.
    const leafMap=[];
    for(const n of rows.rows)if(n.is_leaf)leafMap.push([String(n.temp_class_id),map.get(String(n.temp_class_id))]);
    const BATCH=500;
    let assigned=0;
    for(let i=0;i<leafMap.length;i+=BATCH){
      const part=leafMap.slice(i,i+BATCH);
      const tmp=part.map(x=>x[0]);
      const real=part.map(x=>x[1]);
      const q=await client.query(`
        UPDATE gm_product_image_vector v
           SET class_id=m.real_id
          FROM gm_vector_class_stage s
          JOIN UNNEST($2::bigint[],$3::bigint[]) AS m(temp_id,real_id)
            ON s.temp_class_id=m.temp_id
         WHERE s.job_id=$1
           AND v.product_uid=s.product_uid
      `,[jobId,tmp,real]);
      assigned+=q.rowCount||0;
    }

    const verify=await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM gm_vector_category) AS nodes,
        (SELECT COUNT(*)::int FROM gm_product_image_vector v JOIN gm_vector_class_stage s ON s.product_uid=v.product_uid WHERE s.job_id=$1 AND v.class_id IS NOT NULL) AS assigned,
        (SELECT COUNT(*)::int FROM gm_product_image_vector v WHERE v.class_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM gm_vector_category c WHERE c.id=v.class_id)) AS orphan
    `,[jobId]);
    const vr=verify.rows[0]||{};
    if(Number(vr.assigned)!==expected)throw new Error(`FINAL_ASSIGNMENT_COUNT_MISMATCH expected=${expected} actual=${vr.assigned}`);
    if(Number(vr.orphan)!==0)throw new Error(`FINAL_ORPHAN_ASSIGNMENTS=${vr.orphan}`);

    await client.query('COMMIT');
    state.applied={job_id:jobId,groups,assigned,expected,nodes:Number(vr.nodes||0),at:nowIso()};
    state.phase='APPLIED';
    pushLog(`[${VERSION}] APPLY COMPLETE job=${jobId} assigned=${assigned}/${expected} nodes=${vr.nodes}`);
    res.json({ok:true,version:VERSION,applied:state.applied,stage_kept:true});
  }catch(e){
    if(client)try{await client.query('ROLLBACK');}catch(_){}
    res.status(500).json({ok:false,version:VERSION,error:'APPLY_FAILED',detail:String(e&&e.message||e)});
  }finally{if(client)client.release();}
});

// Manual cleanup requested by user. Disabled while a classification build runs.
router.post('/api/gm/builder/image-vector/classification/stage/clear', express.json({limit:'16kb'}), async (req,res) => {
  if(state.running)return res.status(409).json({ok:false,version:VERSION,error:'CLASSIFICATION_RUNNING'});
  try{
    const deleted=await clearStage(dbFrom(req));
    state.job_id=null;state.result=null;state.progress=null;state.phase='IDLE';
    pushLog(`[${VERSION}] STAGING MANUAL CLEAR categories=${deleted.categories_deleted} assignments=${deleted.assignments_deleted}`);
    res.json({ok:true,version:VERSION,...deleted});
  }catch(e){res.status(500).json({ok:false,version:VERSION,error:'STAGE_CLEAR_FAILED',detail:String(e&&e.message||e)});}
});

async function resolveExportJob(db,raw){
  await ensureStageSchema(db);
  const job=String(raw||'').trim();
  if(job)return job;
  const latest=await latestStageJob(db);return latest&&latest.job_id||'';
}

// STAGING category export: no 512D vector_center payload.
router.get('/api/gm/builder/image-vector/classification/export/stage/categories.csv', async (req,res) => {
  const db=dbFrom(req);
  try{
    const jobId=await resolveExportJob(db,req.query.job_id);
    if(!jobId)return res.status(404).json({ok:false,error:'NO_STAGING_JOB'});
    const q=await db.query(`SELECT temp_class_id AS class_id,parent_temp_class_id AS parent_class_id,child_no,is_leaf,product_count FROM gm_vector_category_stage WHERE job_id=$1 ORDER BY temp_class_id`,[jobId]);
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="gm_vector_category_stage_${jobId}_${filenameDate()}.csv"`);
    res.write('\uFEFFclass_id,parent_class_id,child_no,is_leaf,product_count\r\n');
    for(const r of q.rows)res.write([r.class_id,r.parent_class_id,r.child_no,r.is_leaf,r.product_count].map(csv).join(',')+'\r\n');
    res.end();
  }catch(e){if(!res.headersSent)return res.status(500).json({ok:false,error:'STAGE_CATEGORY_EXPORT_FAILED',detail:String(e&&e.message||e)});res.end();}
});

router.get('/api/gm/builder/image-vector/classification/export/stage/assignments.csv', async (req,res) => {
  const db=dbFrom(req);let client;
  try{
    const jobId=await resolveExportJob(db,req.query.job_id);
    if(!jobId)return res.status(404).json({ok:false,error:'NO_STAGING_JOB'});
    client=await db.connect();
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="gm_vector_class_stage_${jobId}_${filenameDate()}.csv"`);
    res.write('\uFEFFproduct_uid,class_id\r\n');
    const PAGE=10000;let last='';
    while(true){
      const q=await client.query(`SELECT product_uid,temp_class_id AS class_id FROM gm_vector_class_stage WHERE job_id=$1 AND product_uid>$2 ORDER BY product_uid LIMIT $3`,[jobId,last,PAGE]);
      if(!q.rows.length)break;
      for(const r of q.rows)res.write([r.product_uid,r.class_id].map(csv).join(',')+'\r\n');
      last=String(q.rows[q.rows.length-1].product_uid);if(q.rows.length<PAGE)break;
    }
    res.end();
  }catch(e){if(!res.headersSent)return res.status(500).json({ok:false,error:'STAGE_ASSIGNMENT_EXPORT_FAILED',detail:String(e&&e.message||e)});res.end();}
  finally{if(client)client.release();}
});

// FINAL lightweight exports kept for post-APPLY comparison.
router.get('/api/gm/builder/image-vector/classification/export/categories.csv', async (req,res) => {
  const db=dbFrom(req);
  try{
    const q=await db.query(`SELECT id AS class_id,parent_id AS parent_class_id,child_no,is_leaf,product_count FROM gm_vector_category ORDER BY id`);
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="gm_vector_category_light_${filenameDate()}.csv"`);
    res.write('\uFEFFclass_id,parent_class_id,child_no,is_leaf,product_count\r\n');
    for(const r of q.rows)res.write([r.class_id,r.parent_class_id,r.child_no,r.is_leaf,r.product_count].map(csv).join(',')+'\r\n');
    res.end();
  }catch(e){if(!res.headersSent)return res.status(500).json({ok:false,error:'CATEGORY_EXPORT_FAILED',detail:String(e&&e.message||e)});res.end();}
});

router.get('/api/gm/builder/image-vector/classification/export/assignments.csv', async (req,res) => {
  let groups;try{groups=parseGroups(req.query.groups||'FD');}catch(e){return res.status(400).json({ok:false,error:String(e.message||e)});}
  const db=dbFrom(req);let client;
  try{
    client=await db.connect();
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="gm_product_image_vector_class_light_${groups.join('-')}_${filenameDate()}.csv"`);
    res.write('\uFEFFproduct_uid,class_id\r\n');
    const PAGE=10000;let last='';
    while(true){
      const q=await client.query(`SELECT product_uid,class_id FROM gm_product_image_vector WHERE category_group=ANY($1::text[]) AND product_uid>$2 ORDER BY product_uid LIMIT $3`,[groups,last,PAGE]);
      if(!q.rows.length)break;
      for(const r of q.rows)res.write([r.product_uid,r.class_id].map(csv).join(',')+'\r\n');
      last=String(q.rows[q.rows.length-1].product_uid);if(q.rows.length<PAGE)break;
    }
    res.end();
  }catch(e){if(!res.headersSent)return res.status(500).json({ok:false,error:'ASSIGNMENT_EXPORT_FAILED',detail:String(e&&e.message||e)});res.end();}
  finally{if(client)client.release();}
});

module.exports=router;
