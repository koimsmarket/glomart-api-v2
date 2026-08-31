const express = require('express');
const router = express.Router();
const { tableSpec, dbFrom, fail, getColumns, qIdent, ok, toCsv, TABLES, makeZip } = require('./core');

router.get('/api/gm/builder/export', async (req,res)=>{
  const spec = tableSpec(req.query.table);
  if (!spec) return fail(res, 400, 'invalid table');

  const format = String(req.query.format || 'csv').toLowerCase();
  const db = dbFrom(req);
  // V017: 기본 export 제한 제거.
  // - limit 파라미터가 없으면 전체 다운로드
  // - limit 파라미터가 있으면 요청한 개수만 다운로드
  const rawLimit = req.query.limit;
  const limit = rawLimit === undefined || rawLimit === null || String(rawLimit).trim() === ''
    ? null
    : Math.max(Number(rawLimit), 1);

  try {
    let cols = await getColumns(db, spec.table);
    if (spec.table === 'gm_member') cols = cols.filter(c => !/^password_/i.test(c));
    const sql = `SELECT ${cols.map(qIdent).join(', ')} FROM ${qIdent(spec.table)} ORDER BY ${spec.order}` + (limit ? ' LIMIT $1' : '');
    const r = await db.query(sql, limit ? [limit] : []);
    if (format === 'json') return ok(res, { table:spec.table, count:r.rows.length, limit:limit || 'ALL', columns:cols, rows:r.rows });

    const csv = toCsv(r.rows, cols);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${spec.table}_${Date.now()}.csv"`);
    res.end(csv);
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
