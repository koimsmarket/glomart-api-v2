const express = require('express');
const router = express.Router();
const { dbFrom, ok, fail, qIdent, tableSpec, keySets, getColumns, getColumnMeta } = require('./core');

function safeLimit(v){ return Math.min(Math.max(Number(v || 50), 1), 100); }
function keyColumns(spec){ return [...new Set(keySets(spec).flat())]; }
function editableColumns(spec, columns){
  const protectedSet = new Set([...(spec.blocked || []), ...keyColumns(spec)]);
  return columns.filter(c => !protectedSet.has(c));
}
function normalizeKeyObject(raw, spec){
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  for(const keys of keySets(spec)){
    if(keys.every(k => obj[k] !== undefined && obj[k] !== null && String(obj[k]) !== '')){
      return { keys, values:keys.map(k => obj[k]) };
    }
  }
  return null;
}

router.get('/api/gm/builder/record/meta', async (req,res)=>{
  const spec = tableSpec(req.query.table);
  if(!spec) return fail(res,400,'invalid table');
  const db = dbFrom(req);
  try{
    const columns = await getColumns(db,spec.table);
    const meta = await getColumnMeta(db,spec.table);
    ok(res,{
      key:String(req.query.table), table:spec.table, columns,
      key_sets:keySets(spec), blocked:spec.blocked || [],
      editable:editableColumns(spec,columns), column_meta:meta
    });
  }catch(e){ fail(res,500,'record meta failed',{detail:String(e&&e.message||e)}); }
});

router.get('/api/gm/builder/record/search', async (req,res)=>{
  const spec = tableSpec(req.query.table);
  if(!spec) return fail(res,400,'invalid table');
  const db = dbFrom(req);
  try{
    const columns = await getColumns(db,spec.table);
    const field = String(req.query.field || '').trim();
    const value = req.query.value;
    const mode = String(req.query.mode || 'exact').toLowerCase();
    const limit = safeLimit(req.query.limit);
    let where = '';
    const params = [];
    if(field){
      if(!columns.includes(field)) return fail(res,400,'invalid field');
      if(value === undefined || value === null || String(value) === '') return fail(res,400,'search value required');
      params.push(value);
      if(mode === 'contains') where = ` WHERE ${qIdent(field)}::text ILIKE '%' || $1::text || '%'`;
      else where = ` WHERE ${qIdent(field)}::text = $1::text`;
    }
    params.push(limit);
    const order = spec.order ? ` ORDER BY ${spec.order}` : '';
    const r = await db.query(`SELECT * FROM ${qIdent(spec.table)}${where}${order} LIMIT $${params.length}`,params);
    ok(res,{table:spec.table,count:r.rows.length,items:r.rows,key_sets:keySets(spec),blocked:spec.blocked || [],editable:editableColumns(spec,columns)});
  }catch(e){ fail(res,500,'record search failed',{detail:String(e&&e.message||e)}); }
});

router.post('/api/gm/builder/record/update', express.json({limit:'2mb'}), async (req,res)=>{
  const tableKey = req.body && req.body.table;
  const spec = tableSpec(tableKey);
  if(!spec) return fail(res,400,'invalid table');
  const key = normalizeKeyObject(req.body && req.body.key,spec);
  if(!key) return fail(res,400,'valid record key required');
  const changes = req.body && req.body.changes;
  if(!changes || typeof changes !== 'object' || Array.isArray(changes)) return fail(res,400,'changes required');
  const db = dbFrom(req);
  let inTx = false;
  try{
    const columns = await getColumns(db,spec.table);
    const meta = await getColumnMeta(db,spec.table);
    const editable = new Set(editableColumns(spec,columns));
    const entries = Object.entries(changes).filter(([c])=>editable.has(c));
    const rejected = Object.keys(changes).filter(c=>!editable.has(c));
    if(rejected.length) return fail(res,400,'protected or invalid column',{columns:rejected});
    if(!entries.length) return fail(res,400,'no editable changes');
    for(const [c,v] of entries){
      if(v === null && meta[c] && meta[c].is_nullable === 'NO') return fail(res,400,'null not allowed',{column:c});
    }
    await db.query('BEGIN'); inTx=true;
    const where = key.keys.map((k,i)=>`${qIdent(k)}=$${i+1}`).join(' AND ');
    const before = await db.query(`SELECT * FROM ${qIdent(spec.table)} WHERE ${where} FOR UPDATE`,key.values);
    if(before.rows.length !== 1){ await db.query('ROLLBACK'); inTx=false; return fail(res,409,before.rows.length?'record key is not unique':'record not found',{count:before.rows.length}); }
    const base = key.values.length;
    const setSql = entries.map(([c],i)=>`${qIdent(c)}=$${base+i+1}`).join(', ');
    const values = [...key.values,...entries.map(([,v])=>v)];
    const updated = await db.query(`UPDATE ${qIdent(spec.table)} SET ${setSql} WHERE ${where} RETURNING *`,values);
    if(updated.rows.length !== 1) throw new Error('unexpected update count: '+updated.rows.length);
    await db.query('COMMIT'); inTx=false;
    ok(res,{table:spec.table,key:req.body.key,changed:entries.map(([c])=>c),before:before.rows[0],after:updated.rows[0]});
  }catch(e){
    if(inTx){ try{ await db.query('ROLLBACK'); }catch(_){} }
    fail(res,500,'record update failed',{detail:String(e&&e.message||e)});
  }
});

module.exports = router;
