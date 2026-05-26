const express = require('express');
const router = express.Router();

const VERSION = 'GM_DATA_BUILDER_V001';

const TABLES = {
  products: { table: 'gm_products', pk: ['product_uid'], order: 'updated_at DESC NULLS LAST, created_at DESC NULLS LAST' },
  cart: { table: 'gm_basket', pk: ['guest_key', 'pi_ii_vi'], order: 'updated_at DESC NULLS LAST, added_at DESC NULLS LAST' },
  orders: { table: 'gm_orders', pk: ['order_no'], order: 'created_at DESC NULLS LAST' },
  order_items: { table: 'gm_order_items', pk: ['order_no', 'pi_ii_vi'], order: 'created_at DESC NULLS LAST' },
  cs: { table: 'gm_cs', pk: ['cs_no'], order: 'created_at DESC NULLS LAST' },
  cs_messages: { table: 'gm_cs_message', pk: ['message_id'], order: 'created_at DESC NULLS LAST' }
};

function pool(req){ return req.app.locals.db || req.app.locals.pool; }
function ok(res, data){ res.json({ ok:true, version:VERSION, ...data }); }
function fail(res, status, error, extra={}){ res.status(status).json({ ok:false, version:VERSION, error, ...extra }); }
function mapTable(name){ return TABLES[String(name || '').trim()] || null; }
function qIdent(s){ return '"' + String(s).replace(/"/g, '""') + '"'; }
function csvEscape(v){
  if(v === null || v === undefined) return '';
  if(typeof v === 'object') v = JSON.stringify(v);
  v = String(v);
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function toCsv(rows, columns){
  const lines = [columns.map(csvEscape).join(',')];
  for(const row of rows) lines.push(columns.map(c => csvEscape(row[c])).join(','));
  return '\ufeff' + lines.join('\n');
}
function parseCsv(text){
  text = String(text || '').replace(/^\ufeff/, '');
  const rows=[]; let row=[], cell='', q=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i], nx=text[i+1];
    if(q){
      if(ch==='"' && nx==='"'){ cell+='"'; i++; }
      else if(ch==='"') q=false;
      else cell+=ch;
    }else{
      if(ch==='"') q=true;
      else if(ch===','){ row.push(cell); cell=''; }
      else if(ch==='\n'){ row.push(cell); rows.push(row); row=[]; cell=''; }
      else if(ch!=='\r') cell+=ch;
    }
  }
  row.push(cell);
  if(row.length>1 || row[0] !== '') rows.push(row);
  if(!rows.length) return [];
  const header = rows.shift().map(h => String(h || '').trim());
  return rows.filter(r => r.some(v => String(v || '').trim() !== '')).map(r => {
    const o={}; header.forEach((h,i)=>{ if(h) o[h]=r[i] ?? ''; }); return o;
  });
}
function cleanRow(row, allowedCols){
  const out={};
  for(const c of allowedCols){ if(Object.prototype.hasOwnProperty.call(row,c)){ out[c] = row[c] === '' ? null : row[c]; } }
  return out;
}
async function getColumns(db, table){
  const r = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table]);
  return r.rows.map(x => x.column_name);
}

router.get('/api/gm/builder/tables', (req,res)=>{
  ok(res, { tables:Object.keys(TABLES).map(k => ({ key:k, table:TABLES[k].table, pk:TABLES[k].pk })) });
});

router.get('/api/gm/builder/columns', async (req,res)=>{
  const spec = mapTable(req.query.table);
  if(!spec) return fail(res, 400, 'invalid table');
  try{ const columns = await getColumns(pool(req), spec.table); ok(res, { key:req.query.table, table:spec.table, pk:spec.pk, columns }); }
  catch(e){ fail(res, 500, 'columns failed', { detail:String(e && e.message || e) }); }
});

router.get('/api/gm/builder/export', async (req,res)=>{
  const spec = mapTable(req.query.table);
  if(!spec) return fail(res, 400, 'invalid table');
  const format = String(req.query.format || 'csv').toLowerCase();
  const limit = Math.min(Math.max(Number(req.query.limit || 5000), 1), 50000);
  const where=[]; const vals=[];
  const guestKey=String(req.query.guest_key || '').trim();
  const memberId=String(req.query.member_id || '').trim();
  const orderNo=String(req.query.order_no || '').trim();
  if(guestKey && ['gm_basket','gm_orders'].includes(spec.table)){ vals.push(guestKey); where.push(`guest_key = $${vals.length}`); }
  if(memberId && ['gm_basket','gm_orders'].includes(spec.table)){ vals.push(memberId); where.push(`member_id = $${vals.length}`); }
  if(orderNo && ['gm_orders','gm_order_items','gm_cs','gm_cs_message'].includes(spec.table)){ vals.push(orderNo); where.push(`order_no = $${vals.length}`); }
  try{
    const db=pool(req); const columns=await getColumns(db, spec.table);
    const sql = `SELECT ${columns.map(qIdent).join(', ')} FROM ${qIdent(spec.table)} ${where.length ? 'WHERE '+where.join(' AND ') : ''} ORDER BY ${spec.order} LIMIT ${limit}`;
    const r = await db.query(sql, vals);
    if(format==='json') return ok(res, { table:spec.table, count:r.rows.length, columns, rows:r.rows });
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${spec.table}_${Date.now()}.csv"`);
    res.end(toCsv(r.rows, columns));
  }catch(e){ fail(res, 500, 'export failed', { detail:String(e && e.message || e) }); }
});

router.post('/api/gm/builder/import', express.text({ type:['text/*','application/csv'], limit:'20mb' }), async (req,res,next)=>{
  if(!req.is('text/*') && !req.is('application/csv')) return next();
  req.gmCsvRows = parseCsv(req.body);
  next();
});

router.post('/api/gm/builder/import', async (req,res)=>{
  const spec = mapTable(req.query.table || req.body?.table);
  if(!spec) return fail(res, 400, 'invalid table');
  const mode = String(req.query.mode || req.body?.mode || 'upsert').toLowerCase();
  if(!['upsert','insert'].includes(mode)) return fail(res, 400, 'invalid mode');
  try{
    const db=pool(req); const allowedCols=await getColumns(db, spec.table);
    let rows = req.gmCsvRows || req.body?.rows || [];
    if(!Array.isArray(rows)) return fail(res, 400, 'rows required');
    const client = await db.connect();
    let saved=0, skipped=0, errors=[];
    try{
      await client.query('BEGIN');
      for(let i=0;i<rows.length;i++){
        const row=cleanRow(rows[i], allowedCols); const cols=Object.keys(row);
        if(!cols.length){ skipped++; continue; }
        const missingPk = mode==='upsert' && spec.pk.some(pk => row[pk] === null || row[pk] === undefined || row[pk] === '');
        if(missingPk){ skipped++; errors.push({ row:i+1, error:'missing primary key', pk:spec.pk }); continue; }
        const params=cols.map(c=>row[c]);
        let sql = `INSERT INTO ${qIdent(spec.table)} (${cols.map(qIdent).join(', ')}) VALUES (${cols.map((c,idx)=>'$'+(idx+1)).join(', ')})`;
        if(mode==='upsert'){
          const updateCols = cols.filter(c => !spec.pk.includes(c));
          if(updateCols.length) sql += ` ON CONFLICT (${spec.pk.map(qIdent).join(', ')}) DO UPDATE SET ` + updateCols.map(c => `${qIdent(c)} = EXCLUDED.${qIdent(c)}`).join(', ');
          else sql += ` ON CONFLICT (${spec.pk.map(qIdent).join(', ')}) DO NOTHING`;
        }
        await client.query(sql, params); saved++;
      }
      await client.query('COMMIT');
    }catch(e){ await client.query('ROLLBACK').catch(()=>{}); throw e; }
    finally{ client.release(); }
    ok(res, { table:spec.table, mode, saved, skipped, errors });
  }catch(e){ fail(res, 500, 'import failed', { detail:String(e && e.message || e) }); }
});

module.exports = router;