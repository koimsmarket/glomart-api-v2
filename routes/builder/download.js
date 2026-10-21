const express = require('express');
const router = express.Router();
const { tableSpec, dbFrom, fail, getColumns, qIdent, ok, toCsv, TABLES, makeZip } = require('./core');


function csvCell(v){
  if(v === null || v === undefined) return '';
  let x;
  if(Array.isArray(v)) x = '{' + v.join(',') + '}';
  else if(typeof v === 'object') x = JSON.stringify(v);
  else x = String(v);
  return /[",\r\n]/.test(x) ? '"' + x.replace(/"/g,'""') + '"' : x;
}

// V001: bounded-memory CSV export for ALL tables, not only product tables.
// A fixed ORDER BY plus OFFSET pagination preserves configured ordering. Large OFFSETs
// can be slower than indexed keyset paging, but never load the entire table in Node.
async function streamTableCsv(db,res,table,cols,order,limit){
  const pageSize=500;
  let offset=0;
  let sent=0;
  let opened=false;
  const write=async data=>{
    if(res.destroyed) throw new Error('client disconnected');
    if(res.write(data)) return;
    await new Promise((resolve,reject)=>{
      const done=()=>{res.off('close',closed);resolve();};
      const closed=()=>{res.off('drain',done);reject(new Error('client disconnected'));};
      res.once('drain',done);res.once('close',closed);
    });
  };
  while(!res.destroyed){
    if(limit!==null && sent>=limit)break;
    const take=limit!==null?Math.min(pageSize,limit-sent):pageSize;
    const r=await db.query(
      `SELECT ${cols.map(qIdent).join(', ')} FROM ${qIdent(table)} ORDER BY ${order} LIMIT $1 OFFSET $2`,
      [take,offset]
    );
    if(!opened){
      res.setHeader('Content-Type','text/csv; charset=utf-8');
      res.setHeader('Content-Disposition',`attachment; filename="${table}_${Date.now()}.csv"`);
      res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
      res.setHeader('X-Content-Type-Options','nosniff');
      await write('\ufeff'+cols.map(csvCell).join(',')+'\n');
      opened=true;
    }
    for(const row of r.rows) await write(cols.map(c=>csvCell(row[c])).join(',')+'\n');
    offset+=r.rows.length;sent+=r.rows.length;
    if(r.rows.length<take)break;
  }
  if(!res.destroyed)res.end();
  console.info('[GM_BUILDER_REWORK_V001] export',table,'rows='+sent,'mode=stream');
}

function exportTableSpec(raw){
  const spec=tableSpec(raw);
  if(spec)return spec;
  const m=/^readonly:(gm_[a-z0-9_]+)$/.exec(String(raw||''));
  return m?{table:m[1],order:null,readOnly:true}:null;
}

router.get('/api/gm/builder/export', async (req,res)=>{
  const spec = exportTableSpec(req.query.table);
  if (!spec) return fail(res, 400, 'invalid table');

  const format = String(req.query.format || 'csv').toLowerCase();
  const db = dbFrom(req);
  // V017: 기본 export 제한 제거.
  // - limit 파라미터가 없으면 전체 다운로드
  // - limit 파라미터가 있으면 요청한 개수만 다운로드
  const rawLimit = req.query.limit;
  const limit = rawLimit === undefined || rawLimit === null || String(rawLimit).trim() === ''
    ? null
    : Math.min(Math.max(Math.floor(Number(rawLimit)||1), 1), 1000000000);

  try {
    let cols = await getColumns(db, spec.table);
    if (!cols.length) return fail(res,404,'table not found');
    if (spec.table === 'gm_member') cols = cols.filter(c => !/^password_/i.test(c));

    // Metadata-derived tables must be verified against pg_catalog: no arbitrary SQL identifiers.
    if(spec.readOnly){
      const found=await db.query(`SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename=$1`,[spec.table]);
      if(!found.rows.length)return fail(res,404,'table not found');
    }
    // Unregistered tables use physical tuple id for bounded scan ordering.
    // ctid is a snapshot-local pagination convenience, not a stable record identity.
    const order=spec.order||'ctid ASC';
    if(format!=='json')return await streamTableCsv(db,res,spec.table,cols,order,limit);
    // JSON is restricted to small diagnostic previews; full exports must use CSV streaming.
    if(limit===null||limit>5000)return fail(res,400,'JSON export requires limit <= 5000; use CSV for full export');
    const r=await db.query(`SELECT ${cols.map(qIdent).join(', ')} FROM ${qIdent(spec.table)} ORDER BY ${order} LIMIT $1`,[limit]);
    return ok(res,{table:spec.table,count:r.rows.length,limit,columns:cols,rows:r.rows});
  } catch(e) {
    fail(res, 500, 'export failed', { detail:String(e && e.message || e) });
  }
});


// 전체 테이블 CSV를 한 번에 ZIP으로 다운로드한다.


router.get('/api/gm/builder/export-all', async (req,res)=>{
  const db = dbFrom(req);
  // V017: export-all도 기본 제한 제거.
  // limit 파라미터가 없으면 각 테이블 전체 다운로드.
  const rawLimit = req.query.limit;
  const limit = rawLimit === undefined || rawLimit === null || String(rawLimit).trim() === ''
    ? null
    : Math.max(Number(rawLimit), 1);
  try{
    const files=[];
    const errors=[];
    for(const key of Object.keys(TABLES)){
      const spec = TABLES[key];
      try{
        let cols = await getColumns(db, spec.table);
        if(!cols.length){ errors.push({key, table:spec.table, error:'no columns'}); continue; }
        if(spec.table === 'gm_member') cols = cols.filter(c => !/^password_/i.test(c));
        const sql = `SELECT ${cols.map(qIdent).join(', ')} FROM ${qIdent(spec.table)} ORDER BY ${spec.order}` + (limit ? ' LIMIT $1' : '');
        const r = await db.query(sql, limit ? [limit] : []);
        files.push({ name: `${spec.table}.csv`, data: toCsv(r.rows, cols) });
      }catch(e){
        errors.push({ key, table:spec.table, error:String(e && e.message || e) });
      }
    }
    if(errors.length){
      files.push({ name:'_export_errors.json', data: JSON.stringify({ ok:false, errors }, null, 2) });
    }
    const zip = makeZip(files);
    const fname = `gm_all_tables_${Date.now()}.zip`;
    res.setHeader('Content-Type','application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.setHeader('Content-Length', String(zip.length));
    res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.end(zip);
  }catch(e){
    fail(res, 500, 'export all failed', { detail:String(e && e.message || e) });
  }
});

module.exports = router;
