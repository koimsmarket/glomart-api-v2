'use strict';
// GM_BUILDER_IMAGE_VECTOR_CLASSIFICATION_V001
//
// PURPOSE
//   Builder control plane for visual-vector classification.
//
// OWNERSHIP / SAFETY
//   - This module owns ONLY /api/gm/builder/image-vector/classification/*.
//   - Existing IMAGE VECTOR BACKGROUND OFF/AUTO/ON behavior is NOT changed.
//   - DRY RUN computes the tree without changing DB data.
//   - APPLY runs the same engine with GM_VECTOR_CLASS_APPLY=1. The engine replaces
//     gm_vector_category + gm_product_image_vector.class_id in one transaction.
//   - vector_image / candidate_vector / category_group are never modified here.
//   - Classification runs in a child Node process so CPU-heavy 512D clustering
//     does not block the main API event loop.
//
// LIGHTWEIGHT VERIFICATION EXPORTS
//   1) categories.csv   : class_id,parent_class_id,child_no,is_leaf,product_count
//                         (vector_center intentionally omitted)
//   2) assignments.csv  : product_uid,class_id
//                         (vector_image intentionally omitted)
//   These two files are intentionally small enough to compare after APPLY.

const express = require('express');
const router = express.Router();
const path = require('path');
const { fork } = require('child_process');
const { dbFrom } = require('../core');

const VERSION = 'GM_BUILDER_IMAGE_VECTOR_CLASSIFICATION_V001';
const BUILD_SCRIPT = path.resolve(__dirname, '../../../tools/vector-classification/build.js');
const LOG_LIMIT = 120;

const state = {
  running: false,
  mode: null,
  groups: [],
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
function filenameDate() {
  const d = new Date();
  const p = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
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
      SELECT COUNT(*)::int AS assigned_all
        FROM gm_product_image_vector
       WHERE class_id IS NOT NULL
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
    const summary = await databaseSummary(dbFrom(req), groups);
    res.json({ok:true,version:VERSION,state:{...state,logs:state.logs.slice(-80)},database:{groups,...summary}});
  } catch (e) {
    res.status(500).json({ok:false,version:VERSION,error:'STATUS_FAILED',detail:String(e&&e.message||e),state});
  }
});

router.post('/api/gm/builder/image-vector/classification/start', express.json({limit:'64kb'}), async (req,res) => {
  if (state.running) return res.status(409).json({ok:false,version:VERSION,error:'CLASSIFICATION_ALREADY_RUNNING',state});

  let groups;
  try { groups = parseGroups(req.body && req.body.groups); }
  catch (e) { return res.status(400).json({ok:false,version:VERSION,error:String(e.message||e)}); }

  const apply = !!(req.body && req.body.apply);
  state.running = true;
  state.mode = apply ? 'APPLY' : 'DRY_RUN';
  state.groups = groups;
  state.pid = null;
  state.started_at = nowIso();
  state.finished_at = null;
  state.exit_code = null;
  state.phase = 'STARTING';
  state.progress = null;
  state.result = null;
  state.applied = null;
  state.error = null;
  state.logs = [];

  const child = fork(BUILD_SCRIPT, [], {
    cwd: path.resolve(__dirname, '../../..'),
    env: {
      ...process.env,
      GM_VECTOR_CLASS_GROUPS: groups.join(','),
      GM_VECTOR_CLASS_APPLY: apply ? '1' : '0',
      GM_VECTOR_CLASS_IPC: '1'
    },
    silent: true
  });
  state.pid = child.pid;

  child.stdout.on('data', b => String(b).split(/\r?\n/).forEach(pushLog));
  child.stderr.on('data', b => String(b).split(/\r?\n/).forEach(pushLog));
  child.on('message', msg => {
    if (!msg || msg.source !== 'GM_VECTOR_CLASS_BUILD_V005') return;
    if (msg.phase) state.phase = msg.phase;
    if (msg.progress) state.progress = msg.progress;
    if (msg.result) state.result = msg.result;
    if (msg.applied) state.applied = msg.applied;
    if (msg.error) state.error = msg.error;
  });
  child.on('error', e => {
    state.error = String(e&&e.message||e);
    state.phase = 'FAILED';
  });
  child.on('exit', code => {
    state.running = false;
    state.exit_code = code;
    state.finished_at = nowIso();
    if (code === 0) state.phase = 'COMPLETE';
    else {
      state.phase = 'FAILED';
      if (!state.error) state.error = `PROCESS_EXIT_${code}`;
    }
  });

  res.json({ok:true,version:VERSION,started:true,mode:state.mode,groups,pid:state.pid,started_at:state.started_at});
});

// Download category address table without the 512D vector_center payload.
router.get('/api/gm/builder/image-vector/classification/export/categories.csv', async (req,res) => {
  const db = dbFrom(req);
  try {
    const q = await db.query(`
      SELECT id AS class_id, parent_id AS parent_class_id, child_no, is_leaf, product_count
        FROM gm_vector_category
       ORDER BY id
    `);
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="gm_vector_category_light_${filenameDate()}.csv"`);
    res.write('\uFEFFclass_id,parent_class_id,child_no,is_leaf,product_count\r\n');
    for (const r of q.rows) res.write([r.class_id,r.parent_class_id,r.child_no,r.is_leaf,r.product_count].map(csv).join(',')+'\r\n');
    res.end();
  } catch (e) {
    if (!res.headersSent) return res.status(500).json({ok:false,version:VERSION,error:'CATEGORY_EXPORT_FAILED',detail:String(e&&e.message||e)});
    res.end();
  }
});

// Download only PUID + category codes; never sends vector_image.
// Keyset pagination keeps memory bounded when the table later grows far beyond 100k rows.
router.get('/api/gm/builder/image-vector/classification/export/assignments.csv', async (req,res) => {
  let groups;
  try { groups = parseGroups(req.query.groups || 'FD'); }
  catch (e) { return res.status(400).json({ok:false,version:VERSION,error:String(e.message||e)}); }

  const db = dbFrom(req);
  const PAGE = 10000;
  let lastUid = '';
  let client;
  try {
    client = await db.connect();
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="gm_product_image_vector_class_light_${groups.join('-')}_${filenameDate()}.csv"`);
    res.write('\uFEFFproduct_uid,class_id\r\n');

    while (true) {
      const q = await client.query(`
        SELECT product_uid, class_id
          FROM gm_product_image_vector
         WHERE category_group = ANY($1::text[])
           AND product_uid > $2
         ORDER BY product_uid
         LIMIT $3
      `, [groups, lastUid, PAGE]);
      if (!q.rows.length) break;
      for (const r of q.rows) res.write([r.product_uid,r.class_id].map(csv).join(',')+'\r\n');
      lastUid = String(q.rows[q.rows.length-1].product_uid);
      if (q.rows.length < PAGE) break;
    }
    res.end();
  } catch (e) {
    if (!res.headersSent) return res.status(500).json({ok:false,version:VERSION,error:'ASSIGNMENT_EXPORT_FAILED',detail:String(e&&e.message||e)});
    res.end();
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
