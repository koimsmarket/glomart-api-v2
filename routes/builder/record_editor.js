const express = require('express');
const router = express.Router();
const { dbFrom, ok, fail, qIdent, tableSpec, keySets, getColumns, getColumnMeta, getUniqueKeySets } = require('./core');

// 인증정보는 직접 편집 화면에서도 브라우저로 내려보내지 않는다.
const HIDDEN_COLUMNS_BY_TABLE = {
  gm_member: new Set(['password_hash','password_algo','password_updated_at','password_migrated'])
};

const INTEGER_UDT = new Set(['int2','int4','int8','serial','bigserial']);
const DECIMAL_UDT = new Set(['numeric','decimal','float4','float8','money']);
const BOOLEAN_UDT = new Set(['bool']);
const JSON_UDT = new Set(['json','jsonb']);
const DATE_UDT = new Set(['date','timestamp','timestamptz','time','timetz','interval']);

function safeLimit(v){ return Math.min(Math.max(Number(v || 50), 1), 100); }
function hiddenColumns(spec){ return HIDDEN_COLUMNS_BY_TABLE[spec.table] || new Set(); }
function visibleColumns(spec, columns){
  const hidden = hiddenColumns(spec);
  return columns.filter(c => !hidden.has(c));
}
function sameKeySet(a,b){ return a.length===b.length && a.every((v,i)=>v===b[i]); }
async function recordKeyInfo(db,spec,allColumns){
  const dbKeys = await getUniqueKeySets(db,spec.table);
  const info=[];
  for(const k of dbKeys){
    if(k.columns.every(c=>allColumns.includes(c)) && !info.some(x=>sameKeySet(x.columns,k.columns))) info.push(k);
  }
  // 실제 PK/UNIQUE가 하나도 없는 레거시 테이블에만 기존 Builder 기준키를 보조키로 사용한다.
  // DB가 보장하는 식별키가 존재하면 업로드/UPSERT용 Builder key/keyAny는 직접 편집 식별키 후보에 섞지 않는다.
  if(info.length === 0){
    for(const ks of keySets(spec)){
      if(Array.isArray(ks) && ks.length && ks.every(c=>allColumns.includes(c)) && !info.some(x=>sameKeySet(x.columns,ks))){
        info.push({columns:ks.slice(),source:'BUILDER KEY',name:''});
      }
    }
  }
  return info;
}
function editableColumns(spec, columns, identityInfo){
  const identityColumns = (identityInfo || []).flatMap(x=>x.columns || []);
  const protectedSet = new Set([...(spec.blocked || []), ...identityColumns]);
  const hidden = hiddenColumns(spec);
  return columns.filter(c => !protectedSet.has(c) && !hidden.has(c));
}
function normalizeKeyObject(raw, keyInfo){
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  for(const info of keyInfo || []){
    const keys=info.columns || [];
    if(keys.length && keys.every(k => obj[k] !== undefined && obj[k] !== null && String(obj[k]) !== '')){
      return { keys, values:keys.map(k => obj[k]), source:info.source, name:info.name };
    }
  }
  return null;
}
function pickVisible(row, columns){
  const out={};
  for(const c of columns) out[c]=row[c];
  return out;
}
async function acquireClient(db){
  if(db && typeof db.connect === 'function'){
    const client = await db.connect();
    return { client, release:()=>client.release() };
  }
  if(db && typeof db.query === 'function') return { client:db, release:()=>{} };
  throw new Error('database client unavailable');
}
function isArrayMeta(meta){ return !!meta && (meta.data_type === 'ARRAY' || String(meta.udt_name || '').startsWith('_')); }
function scalarUdt(meta){
  const u = String(meta && meta.udt_name || '').toLowerCase();
  return u.startsWith('_') ? u.slice(1) : u;
}
function invalidValue(column, message){
  const e = new Error(message);
  e.status = 400;
  e.publicError = 'invalid column value';
  e.extra = { column, reason:message };
  return e;
}
function normalizeScalarValue(column, value, meta){
  const udt = scalarUdt(meta);
  if(value === null){
    if(meta && meta.is_nullable === 'NO') throw invalidValue(column,'NULL_NOT_ALLOWED');
    return null;
  }
  if(BOOLEAN_UDT.has(udt)){
    if(value === true || value === false) return value;
    const s=String(value).trim().toLowerCase();
    if(s === 'true') return true;
    if(s === 'false') return false;
    throw invalidValue(column,'INVALID_BOOLEAN');
  }
  if(INTEGER_UDT.has(udt)){
    const s=String(value).trim().replace(/,/g,'');
    if(!/^[+-]?\d+$/.test(s)) throw invalidValue(column,'INVALID_INTEGER');
    return s;
  }
  if(DECIMAL_UDT.has(udt)){
    const s=String(value).trim().replace(/,/g,'');
    if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) throw invalidValue(column,'INVALID_NUMBER');
    return s;
  }
  if(JSON_UDT.has(udt)){
    if(typeof value === 'string'){
      try{ return JSON.parse(value); }catch(_){ throw invalidValue(column,'INVALID_JSON'); }
    }
    if(typeof value === 'object') return value;
    throw invalidValue(column,'INVALID_JSON');
  }
  if(DATE_UDT.has(udt)){
    const s=String(value).trim();
    if(!s) throw invalidValue(column,'EMPTY_DATE_TIME');
    return s;
  }
  if(udt === 'uuid'){
    const s=String(value).trim();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) throw invalidValue(column,'INVALID_UUID');
    return s;
  }
  if(udt === 'bytea') throw invalidValue(column,'BYTEA_EDIT_NOT_SUPPORTED');
  if(typeof value === 'object') throw invalidValue(column,'OBJECT_NOT_ALLOWED_FOR_SCALAR');
  return String(value);
}
function normalizeTypedValue(column, value, meta){
  if(!meta) throw invalidValue(column,'COLUMN_META_MISSING');
  if(value === null) return normalizeScalarValue(column,value,meta);
  if(isArrayMeta(meta)){
    let arr=value;
    if(typeof arr === 'string'){
      try{ arr=JSON.parse(arr); }catch(_){ throw invalidValue(column,'ARRAY_REQUIRES_JSON_ARRAY'); }
    }
    if(!Array.isArray(arr)) throw invalidValue(column,'ARRAY_REQUIRES_JSON_ARRAY');
    const elementMeta={...meta,data_type:'USER-DEFINED',udt_name:scalarUdt(meta),is_nullable:'YES'};
    return arr.map((v,i)=>{
      if(v === null) return null;
      try{ return normalizeScalarValue(column,v,elementMeta); }
      catch(e){ if(e && e.extra) e.extra.array_index=i; throw e; }
    });
  }
  return normalizeScalarValue(column,value,meta);
}
function comparable(v){
  if(v instanceof Date) return v.toISOString();
  if(Array.isArray(v)) return v.map(comparable);
  if(v && typeof v === 'object'){
    const o={}; for(const k of Object.keys(v).sort()) o[k]=comparable(v[k]); return o;
  }
  return v;
}
function sameValue(a,b){ return JSON.stringify(comparable(a)) === JSON.stringify(comparable(b)); }
function keyWhere(key){ return key.keys.map((k,i)=>`${qIdent(k)}=$${i+1}`).join(' AND '); }
function publicKeyInfo(info){ return info.map(x=>({columns:x.columns,source:x.source,name:x.name||''})); }

router.get('/api/gm/builder/record/meta', async (req,res)=>{
  const spec = tableSpec(req.query.table);
  if(!spec) return fail(res,400,'invalid table');
  const db = dbFrom(req);
  try{
    const allColumns = await getColumns(db,spec.table);
    const columns = visibleColumns(spec, allColumns);
    const allMeta = await getColumnMeta(db,spec.table);
    const identity = await recordKeyInfo(db,spec,allColumns);
    const meta={}; for(const c of columns) if(allMeta[c]) meta[c]=allMeta[c];
    ok(res,{
      key:String(req.query.table), table:spec.table, columns,
      key_sets:identity.map(x=>x.columns), key_info:publicKeyInfo(identity),
      blocked:(spec.blocked || []).filter(c=>columns.includes(c)),
      editable:editableColumns(spec,allColumns,identity), column_meta:meta
    });
  }catch(e){ fail(res,500,'record meta failed',{detail:String(e&&e.message||e)}); }
});

router.get('/api/gm/builder/record/search', async (req,res)=>{
  const spec = tableSpec(req.query.table);
  if(!spec) return fail(res,400,'invalid table');
  const db = dbFrom(req);
  try{
    const allColumns = await getColumns(db,spec.table);
    const columns = visibleColumns(spec, allColumns);
    const identity = await recordKeyInfo(db,spec,allColumns);
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
      else where = ` WHERE ${qIdent(field)} = $1`;
    }
    params.push(limit);
    const order = spec.order ? ` ORDER BY ${spec.order}` : '';
    const selectSql = columns.map(qIdent).join(', ');
    const r = await db.query(`SELECT ${selectSql} FROM ${qIdent(spec.table)}${where}${order} LIMIT $${params.length}`,params);
    ok(res,{
      table:spec.table,count:r.rows.length,items:r.rows,
      key_sets:identity.map(x=>x.columns),key_info:publicKeyInfo(identity),
      blocked:(spec.blocked || []).filter(c=>columns.includes(c)),
      editable:editableColumns(spec,allColumns,identity)
    });
  }catch(e){ fail(res,500,'record search failed',{detail:String(e&&e.message||e)}); }
});

router.post('/api/gm/builder/record/update', express.json({limit:'2mb'}), async (req,res)=>{
  const tableKey = req.body && req.body.table;
  const spec = tableSpec(tableKey);
  if(!spec) return fail(res,400,'invalid table');
  const changes = req.body && req.body.changes;
  if(!changes || typeof changes !== 'object' || Array.isArray(changes)) return fail(res,400,'changes required');
  const originals = req.body && req.body.original;
  if(originals !== undefined && (!originals || typeof originals !== 'object' || Array.isArray(originals))) return fail(res,400,'invalid original snapshot');
  const db = dbFrom(req);
  let handle=null, inTx=false;
  try{
    const allColumns = await getColumns(db,spec.table);
    const visible = visibleColumns(spec, allColumns);
    const meta = await getColumnMeta(db,spec.table);
    const identity = await recordKeyInfo(db,spec,allColumns);
    const key = normalizeKeyObject(req.body && req.body.key,identity);
    if(!key) return fail(res,400,'valid record key required');
    const editable = new Set(editableColumns(spec,allColumns,identity));
    const rawEntries = Object.entries(changes);
    const rejected = rawEntries.map(([c])=>c).filter(c=>!editable.has(c));
    if(rejected.length) return fail(res,400,'protected or invalid column',{columns:rejected});
    if(!rawEntries.length) return fail(res,400,'no editable changes');
    const entries = rawEntries.map(([c,v])=>[c,normalizeTypedValue(c,v,meta[c])]);

    handle = await acquireClient(db);
    const client = handle.client;
    await client.query('BEGIN'); inTx=true;
    const where = keyWhere(key);
    const before = await client.query(`SELECT * FROM ${qIdent(spec.table)} WHERE ${where} FOR UPDATE`,key.values);
    if(before.rows.length !== 1){
      await client.query('ROLLBACK'); inTx=false;
      return fail(res,409,before.rows.length?'record key is not unique':'record not found',{count:before.rows.length});
    }

    if(originals){
      const conflicts=[];
      for(const [c] of entries){
        if(Object.prototype.hasOwnProperty.call(originals,c) && !sameValue(before.rows[0][c], originals[c])) conflicts.push(c);
      }
      if(conflicts.length){
        await client.query('ROLLBACK'); inTx=false;
        return fail(res,409,'record changed since search',{columns:conflicts});
      }
    }

    const base=key.values.length;
    const setSql = entries.map(([c],i)=>`${qIdent(c)}=$${base+i+1}`).join(', ');
    const vals=[...key.values,...entries.map(x=>x[1])];
    const updated = await client.query(`UPDATE ${qIdent(spec.table)} SET ${setSql} WHERE ${where} RETURNING *`,vals);
    if(updated.rows.length !== 1){
      await client.query('ROLLBACK'); inTx=false;
      return fail(res,409,'update affected unexpected row count',{count:updated.rows.length});
    }
    await client.query('COMMIT'); inTx=false;
    ok(res,{
      table:spec.table,key:req.body.key,changed:entries.map(x=>x[0]),
      before:pickVisible(before.rows[0],visible),after:pickVisible(updated.rows[0],visible)
    });
  }catch(e){
    if(handle && inTx){ try{ await handle.client.query('ROLLBACK'); }catch(_){} }
    if(e && e.status) return fail(res,e.status,e.publicError || e.message,e.extra);
    fail(res,500,'record update failed',{detail:String(e&&e.message||e)});
  }finally{ if(handle) handle.release(); }
});

router.post('/api/gm/builder/record/delete-selected', express.json({limit:'2mb'}), async (req,res)=>{
  const tableKey = req.body && req.body.table;
  const spec = tableSpec(tableKey);
  if(!spec) return fail(res,400,'invalid table');
  const confirmText=String((req.body&&req.body.confirm)||req.query.confirm||'');
  if(confirmText !== 'DELETE SELECTED') return fail(res,400,'confirmation required');
  const items=req.body && req.body.items;
  if(!Array.isArray(items) || !items.length) return fail(res,400,'selected records required');
  if(items.length > 100) return fail(res,400,'too many selected records',{max:100});

  const db=dbFrom(req);
  let handle=null,inTx=false;
  try{
    const allColumns=await getColumns(db,spec.table);
    const identity=await recordKeyInfo(db,spec,allColumns);
    const normalized=[];
    const seen=new Set();
    for(const item of items){
      const key=normalizeKeyObject(item&&item.key,identity);
      if(!key) return fail(res,400,'valid record key required for every selected record');
      const sig=JSON.stringify(key.keys.map((k,i)=>[k,key.values[i]]));
      if(seen.has(sig)) continue;
      seen.add(sig); normalized.push(key);
    }
    if(!normalized.length) return fail(res,400,'selected records required');

    handle=await acquireClient(db);
    const client=handle.client;
    await client.query('BEGIN'); inTx=true;

    // 먼저 선택된 모든 키를 잠그고 각각 정확히 1건인지 확인한다.
    for(const key of normalized){
      const where=keyWhere(key);
      const locked=await client.query(`SELECT 1 FROM ${qIdent(spec.table)} WHERE ${where} FOR UPDATE`,key.values);
      if(locked.rows.length !== 1){
        await client.query('ROLLBACK'); inTx=false;
        return fail(res,409,locked.rows.length?'record key is not unique':'record not found',{key:Object.fromEntries(key.keys.map((k,i)=>[k,key.values[i]])),count:locked.rows.length});
      }
    }

    let deleted=0;
    for(const key of normalized){
      const where=keyWhere(key);
      const d=await client.query(`DELETE FROM ${qIdent(spec.table)} WHERE ${where}`,key.values);
      if(d.rowCount !== 1){
        await client.query('ROLLBACK'); inTx=false;
        return fail(res,409,'delete affected unexpected row count',{count:d.rowCount});
      }
      deleted += d.rowCount;
    }
    await client.query('COMMIT'); inTx=false;
    ok(res,{table:spec.table,requested:items.length,deleted});
  }catch(e){
    if(handle && inTx){ try{ await handle.client.query('ROLLBACK'); }catch(_){} }
    if(e && e.code === '23503') return fail(res,409,'record is referenced by other data',{detail:String(e.detail||e.message||e)});
    fail(res,500,'record delete failed',{detail:String(e&&e.message||e)});
  }finally{ if(handle) handle.release(); }
});

module.exports = router;
