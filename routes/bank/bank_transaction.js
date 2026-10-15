'use strict';

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const { parseWooriXlsx } = require('../../services/bank/bank_woori_xlsx');

const router = express.Router();
const VERSION = 'GM_BANK_TRANSACTION_ROUTE_V001';
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 }
});

function db(req){ return req.app.locals.db || req.app.locals.pool; }
function clean(v){ return String(v == null ? '' : v).trim(); }
function sha256(buf){ return crypto.createHash('sha256').update(buf).digest('hex'); }
function ok(res, data){ res.json(Object.assign({ ok:true, version:VERSION }, data || {})); }
function fail(res, status, message, extra){ res.status(status).json(Object.assign({ ok:false, version:VERSION, error:message }, extra || {})); }

// Bank administrator login: cookie is HttpOnly; never expose server secret to JS.
const COOKIE_NAME = 'gm_bank_admin';
const SESSION_MS = 8 * 60 * 60 * 1000;
const failedLogins = new Map(); // per-process throttling; use upstream WAF for distributed limits
function configuredSecret(){ return clean(process.env.GM_BANK_UPLOAD_TOKEN); }
function sign(payload, secret){ return crypto.createHmac('sha256', secret).update(payload).digest('base64url'); }
function cookieValue(req){
  const raw = String(req.headers.cookie || '');
  const entry = raw.split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE_NAME+'='));
  return entry ? entry.slice(COOKIE_NAME.length+1) : '';
}
function validSession(req){
  const secret = configuredSecret();
  if(!secret || secret.length < 32) return false;
  const parts=cookieValue(req).split('.');
  if(parts.length!==2) return false;
  const [payload,signature]=parts;
  const expected=sign(payload,secret);
  const a=Buffer.from(signature), b=Buffer.from(expected);
  if(a.length!==b.length || !crypto.timingSafeEqual(a,b)) return false;
  const issued=Number(payload);
  return Number.isSafeInteger(issued) && issued<=Date.now() && Date.now()-issued<SESSION_MS;
}
function requireBankSession(req,res,next){
  if(!validSession(req)) return fail(res,401,'BANK_ADMIN_LOGIN_REQUIRED');
  if(!['GET','HEAD','OPTIONS'].includes(req.method)){
    const origin=clean(req.headers.origin);
    const host=clean(req.headers['x-forwarded-host'] || req.headers.host).split(',')[0];
    // Mutation requests from other sites must not be accepted.
    if(!origin || !host || !['https://'+host,'http://'+host].includes(origin))
      return fail(res,403,'BANK_ADMIN_ORIGIN_REJECTED');
  }
  next();
}
router.post('/api/gm/bank/admin/login', express.json({limit:'2kb'}), (req,res)=>{
  const secret=configuredSecret();
  if(!secret || secret.length<32) return fail(res,503,'GM_BANK_UPLOAD_TOKEN must be configured (32+ characters)');
  const address=String(req.socket && req.socket.remoteAddress || 'unknown');
  const attempts=failedLogins.get(address);
  if(attempts && attempts.until>Date.now() && attempts.count>=5) return fail(res,429,'TOO_MANY_LOGIN_ATTEMPTS');
  const supplied=clean(req.body && req.body.password);
  const a=Buffer.from(supplied),b=Buffer.from(secret);
  if(a.length!==b.length || !crypto.timingSafeEqual(a,b)){
    const old=attempts && attempts.until>Date.now() ? attempts.count : 0;
    failedLogins.set(address,{count:old+1,until:Date.now()+15*60*1000});
    return fail(res,401,'INVALID_ADMIN_CREDENTIAL');
  }
  failedLogins.delete(address);
  const now=Date.now(), value=String(now)+'.'+sign(String(now),secret);
  res.setHeader('Set-Cookie',COOKIE_NAME+'='+value+'; HttpOnly; Secure; SameSite=Strict; Path=/api/gm/bank; Max-Age=28800');
  ok(res,{authenticated:true,expires_in_seconds:28800});
});
router.get('/api/gm/bank/admin/status',(req,res)=>ok(res,{authenticated:validSession(req)}));
router.post('/api/gm/bank/admin/logout',requireBankSession,(req,res)=>{
  res.setHeader('Set-Cookie',COOKIE_NAME+'=; HttpOnly; Secure; SameSite=Strict; Path=/api/gm/bank; Max-Age=0');ok(res,{authenticated:false});
});

router.post('/api/gm/bank/woori/upload', requireBankSession, upload.single('file'), async (req,res)=>{
  const pool = db(req);
  if(!pool) return fail(res, 500, 'DB pool is not attached');
  if(!req.file || !Buffer.isBuffer(req.file.buffer)) return fail(res, 400, 'xlsx file required (field name: file)');
  const ext = path.extname(req.file.originalname || '').toLowerCase();
  if(ext !== '.xlsx') return fail(res, 400, 'WOORI V001 accepts .xlsx only');

  let parsed;
  try{ parsed = parseWooriXlsx(req.file.buffer); }
  catch(e){ return fail(res, 400, 'WOORI xlsx parse failed', { detail:String(e && e.message || e) }); }

  if(!parsed.account_no) return fail(res, 400, 'WOORI account number not found in file');
  const fileHash = sha256(req.file.buffer);
  const client = await pool.connect().catch(()=>null);
  if(!client) return fail(res, 500, 'DB client connect failed');

  let inserted = 0;
  let duplicates = 0;
  let depositRows = 0;
  let withdrawRows = 0;
  try{
    await client.query('BEGIN');
    for(const t of parsed.transactions){
      if(t.deposit_amount > 0) depositRows++;
      if(t.withdraw_amount > 0) withdrawRows++;
      const status = t.deposit_amount > 0 ? 'UNPROCESSED' : 'EXCLUDED';
      const q = await client.query(`
        INSERT INTO gm_bank_transaction (
          bank_code, account_no, account_holder,
          transaction_at, transaction_type, description,
          withdraw_amount, deposit_amount, balance_amount,
          branch_name, bank_memo, instrument_amount,
          source_type, source_file_name, source_file_hash, source_row_no, bank_row_no,
          transaction_hash, raw_json, process_status, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
          'FILE',$13,$14,$15,$16,$17,$18::jsonb,$19,NOW(),NOW()
        )
        ON CONFLICT (transaction_hash) DO NOTHING
        RETURNING bank_transaction_id
      `,[
        parsed.bank_code, parsed.account_no, parsed.account_holder || null,
        t.transaction_at, t.transaction_type || null, t.description || null,
        t.withdraw_amount, t.deposit_amount, t.balance_amount,
        t.branch_name || null, t.bank_memo || null, t.instrument_amount,
        req.file.originalname || 'woori.xlsx', fileHash, t.source_row_no, t.bank_row_no,
        t.transaction_hash, JSON.stringify(t.raw || {}), status
      ]);
      if(q.rowCount) inserted++; else duplicates++;
    }
    await client.query('COMMIT');
    console.log('[GM_BANK_WOORI_UPLOAD_OK]', JSON.stringify({
      file:req.file.originalname, account_no:parsed.account_no, rows:parsed.transactions.length,
      inserted, duplicates, deposit_rows:depositRows, withdraw_rows:withdrawRows
    }));
    return ok(res, {
      bank_code:parsed.bank_code,
      account_no:parsed.account_no,
      account_holder:parsed.account_holder,
      query_start:parsed.query_start,
      query_end:parsed.query_end,
      queried_at:parsed.queried_at,
      file_name:req.file.originalname,
      file_hash:fileHash,
      total_rows:parsed.transactions.length,
      deposit_rows:depositRows,
      withdraw_rows:withdrawRows,
      inserted,
      duplicates
    });
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    console.error('[GM_BANK_WOORI_UPLOAD_ERROR]', String(e && e.message || e));
    return fail(res, 500, 'WOORI upload failed', { detail:String(e && e.message || e) });
  }finally{ client.release(); }
});

router.get('/api/gm/bank/transactions', requireBankSession, async (req,res)=>{
  const pool = db(req);
  if(!pool) return fail(res, 500, 'DB pool is not attached');
  const bankCode = clean(req.query.bank_code || 'WOORI').toUpperCase();
  const status = clean(req.query.status || 'UNPROCESSED').toUpperCase();
  const limit = Math.max(1, Math.min(500, Number(req.query.limit || 200) || 200));
  const depositOnly = clean(req.query.deposit_only || '1') !== '0';
  const allowed = new Set(['UNPROCESSED','MATCHED','MANUAL','EXCLUDED','ALL']);
  if(!allowed.has(status)) return fail(res, 400, 'invalid status');
  try{
    const vals = [bankCode];
    const where = ['bank_code=$1'];
    if(status !== 'ALL'){ vals.push(status); where.push(`process_status=$${vals.length}`); }
    if(depositOnly) where.push('deposit_amount > 0');
    vals.push(limit);
    const q = await pool.query(`
      SELECT bank_transaction_id, bank_code, account_no, account_holder,
             transaction_at, transaction_type, description,
             withdraw_amount, deposit_amount, balance_amount,
             branch_name, bank_memo, source_file_name, source_row_no,
             process_status, matched_order_no, matched_amount,
             processed_at, processed_by_member_id, created_at
      FROM gm_bank_transaction
      WHERE ${where.join(' AND ')}
      ORDER BY transaction_at DESC, bank_transaction_id DESC
      LIMIT $${vals.length}
    `, vals);
    return ok(res, { items:q.rows, count:q.rows.length, bank_code:bankCode, status, deposit_only:depositOnly });
  }catch(e){ return fail(res, 500, 'bank transaction list failed', { detail:String(e && e.message || e) }); }
});

router.post('/api/gm/bank/transactions/:id/process', requireBankSession, async (req,res)=>{
  const pool = db(req);
  if(!pool) return fail(res, 500, 'DB pool is not attached');
  const id = Number(req.params.id);
  if(!Number.isInteger(id) || id <= 0) return fail(res, 400, 'invalid bank_transaction_id');
  const body = req.body || {};
  const status = clean(body.process_status).toUpperCase();
  if(!['UNPROCESSED','MATCHED','MANUAL','EXCLUDED'].includes(status)) return fail(res, 400, 'invalid process_status');
  const orderNo = clean(body.matched_order_no);
  const memberId = clean(body.processed_by_member_id);
  if((status === 'MATCHED' || status === 'MANUAL') && !orderNo) return fail(res, 400, 'matched_order_no required');
  try{
    if(orderNo){
      const exists = await pool.query('SELECT 1 FROM gm_order WHERE order_no=$1 LIMIT 1',[orderNo]);
      if(!exists.rows.length) return fail(res, 404, 'matched order not found');
    }
    const q = await pool.query(`
      UPDATE gm_bank_transaction
      SET process_status=$2,
          matched_order_no=NULLIF($3,''),
          matched_amount=CASE WHEN $2 IN ('MATCHED','MANUAL') THEN deposit_amount ELSE NULL END,
          processed_at=CASE WHEN $2='UNPROCESSED' THEN NULL ELSE NOW() END,
          processed_by_member_id=CASE WHEN $2='UNPROCESSED' THEN NULL ELSE NULLIF($4,'') END,
          updated_at=NOW()
      WHERE bank_transaction_id=$1
      RETURNING *
    `,[id,status,orderNo,memberId]);
    if(!q.rows.length) return fail(res,404,'bank transaction not found');
    return ok(res,{ item:q.rows[0] });
  }catch(e){ return fail(res,500,'bank transaction process failed',{detail:String(e&&e.message||e)}); }
});


// GM_BANK_MANUAL_ENTRY_V001: manually asserted deposit, not bank-verified and never auto-approved.
router.post('/api/gm/bank/transactions/manual', requireBankSession, async (req,res)=>{
  const pool=db(req); if(!pool) return fail(res,500,'DB pool is not attached');
  const b=req.body||{};
  const bank=clean(b.bank_code||'WOORI').toUpperCase();
  const account=clean(b.account_no).replace(/[\s-]/g,'');
  const holder=clean(b.account_holder);
  const reference=clean(b.reference);
  const operator=clean(b.operator);
  const memo=clean(b.bank_memo);
  const description=clean(b.description);
  const amount=Number(b.deposit_amount);
  const datetime=clean(b.transaction_at);
  if(!/^[A-Z0-9_]{2,20}$/.test(bank) || !/^\d{6,30}$/.test(account)) return fail(res,400,'invalid bank or account');
  if(!Number.isSafeInteger(amount)||amount<=0) return fail(res,400,'invalid deposit amount');
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(datetime) || !Number.isFinite(new Date(datetime+'+09:00').getTime())) return fail(res,400,'invalid KST timestamp');
  if(reference.length<6 || reference.length>160 || !operator || operator.length>160) return fail(res,400,'reference and operator required');
  if(memo.length>4000 || description.length>1000) return fail(res,400,'text too long');
  const normalized=datetime.replace('T',' ')+(datetime.length===16?':00':'');
  // Manual reference must be uniquely stable on repeat; avoid auto-matching an actual bank row.
  const transactionHash=sha256(Buffer.from(['MANUAL',bank,account,reference].join('|')));
  const raw=JSON.stringify({source:'MANUAL_ASSERTION',reference,operator,submitted_at:new Date().toISOString()});
  try{
    const q=await pool.query(`INSERT INTO gm_bank_transaction (
      bank_code,account_no,account_holder,transaction_at,transaction_type,description,
      withdraw_amount,deposit_amount,balance_amount,bank_memo,source_type,transaction_hash,
      raw_json,process_status,created_at,updated_at
    ) VALUES ($1,$2,$3,$4::timestamp,'MANUAL', $5,0,$6,0,$7,'MANUAL',$8,$9::jsonb,'UNPROCESSED',NOW(),NOW())
    ON CONFLICT(transaction_hash) DO NOTHING RETURNING bank_transaction_id`,
    [bank,account,holder||null,normalized,description,amount,memo,transactionHash,raw]);
    if(!q.rowCount) return fail(res,409,'manual reference already registered');
    return ok(res,{bank_transaction_id:q.rows[0].bank_transaction_id,source_type:'MANUAL',process_status:'UNPROCESSED',bank_verified:false});
  }catch(e){console.error('[GM_BANK_MANUAL_ERROR]',String(e&&e.message||e));return fail(res,500,'manual record failed');}
});

module.exports = router;
