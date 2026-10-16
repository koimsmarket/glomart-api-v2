'use strict';

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const { parseWooriXlsx } = require('../../services/bank/bank_woori_xlsx');

const router = express.Router();
const VERSION = 'GM_BANK_TRANSACTION_ROUTE_V008';
console.log('[GM_BANK_ROUTE_V008_LOADED]',JSON.stringify({auth:'member',login:'/api/gm/bank/admin/login'}));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 }
});

function db(req){ return req.app.locals.db || req.app.locals.pool; }
function clean(v){ return String(v == null ? '' : v).trim(); }
function sha256(buf){ return crypto.createHash('sha256').update(buf).digest('hex'); }
function ok(res, data){ res.json(Object.assign({ ok:true, version:VERSION }, data || {})); }
function fail(res, status, message, extra){ res.status(status).json(Object.assign({ ok:false, version:VERSION, error:message }, extra || {})); }

// GM_BANK_MEMBER_AUTH_V007 - existing gm_member hashes, bank-only signed session.
const COOKIE_NAME = 'gm_bank_admin';
const SESSION_MS = 8 * 60 * 60 * 1000;
const failures = new Map();
const MASTER_ID = 'derzon';
let argon2 = null;
try { argon2 = require('argon2'); } catch (_) { /* PBKDF2 fallback supported */ }
// Bank-session fallback: per-process random secret. No additional Cloudtype setting is needed.
// Sessions intentionally expire on restart; never use a static or predictable fallback.
const bankEphemeralSessionSecret = crypto.randomBytes(48).toString('hex');
function sessionSecret(){
  const configured = clean(process.env.AUTH_SESSION_SECRET || process.env.SESSION_SECRET);
  return configured.length >= 32 ? configured : bankEphemeralSessionSecret;
}
function sign(body){ return crypto.createHmac('sha256',sessionSecret()).update(body).digest('base64url'); }
function equal(a,b){ const x=Buffer.from(String(a)),y=Buffer.from(String(b)); return x.length===y.length && crypto.timingSafeEqual(x,y); }
function cookies(req){ const entry=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE_NAME+'=')); return entry ? entry.slice(COOKIE_NAME.length+1) : ''; }
function validSession(req){
  if(sessionSecret().length<32) return false;
  const parts=cookies(req).split('.'); if(parts.length!==2 || !equal(sign(parts[0]),parts[1])) return false;
  try { const obj=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
    return obj.id===MASTER_ID && obj.exp>Date.now() && obj.exp<=Date.now()+SESSION_MS && obj.iat<=Date.now();
  }catch(_){return false;}
}
function requireBankSession(req,res,next){
  if(!validSession(req)) return fail(res,401,'BANK_ADMIN_LOGIN_REQUIRED');
  if(!['GET','HEAD','OPTIONS'].includes(req.method)){
    const origin=clean(req.headers.origin), host=clean(req.headers['x-forwarded-host']||req.headers.host).split(',')[0];
    if(!origin || !host || !['https://'+host,'http://'+host].includes(origin)) return fail(res,403,'BANK_ADMIN_ORIGIN_REJECTED');
  }
  req.bankAdminId=MASTER_ID;
  next();
}
async function passwordMatches(password,hash){
  if(hash.startsWith('$argon2')){
    if(!argon2 || !argon2.verify) return false;
    return await argon2.verify(hash,password);
  }
  const fields=hash.split('$');
  if(fields.length===4 && fields[0]==='pbkdf2_sha512'){
    const iterations=Number(fields[1]);
    if(iterations<100000 || iterations>2000000 || !/^[0-9a-f]{32,128}$/i.test(fields[2]) || !/^[0-9a-f]{128}$/i.test(fields[3])) return false;
    const derived=crypto.pbkdf2Sync(password,fields[2],iterations,64,'sha512').toString('hex');
    return equal(derived,fields[3]);
  }
  return false;
}
router.post('/api/gm/bank/admin/login',express.json({limit:'2kb'}),async(req,res)=>{
  console.log('[GM_BANK_LOGIN_V008_ENTER]',JSON.stringify({path:req.originalUrl,method:req.method}));
  if(sessionSecret().length<32) return fail(res,503,'BANK_SESSION_SECRET_NOT_CONFIGURED');
  const address=String(req.socket?.remoteAddress||'unknown');
  const item=failures.get(address);
  if(item && item.until>Date.now() && item.count>=5) return fail(res,429,'TOO_MANY_LOGIN_ATTEMPTS');
  const memberId=clean(req.body?.member_id).toLowerCase();
  const password=typeof req.body?.password==='string' ? req.body.password : '';
  if(memberId!==MASTER_ID || !password || password.length>1024) return fail(res,401,'INVALID_MEMBER_CREDENTIAL');
  try{
    const pool=db(req); if(!pool) return fail(res,503,'DB_NOT_AVAILABLE');
    const result=await pool.query('SELECT member_id,password_hash FROM gm_member WHERE LOWER(member_id)=LOWER($1) LIMIT 1',[MASTER_ID]);
    const member=result.rows[0];
    const valid=member && typeof member.password_hash==='string' && await passwordMatches(password,member.password_hash);
    if(!valid){
      const count=item && item.until>Date.now()?item.count:0;
      failures.set(address,{count:count+1,until:Date.now()+15*60*1000});
      return fail(res,401,'INVALID_MEMBER_CREDENTIAL');
    }
    failures.delete(address);
    const now=Date.now();const payload=Buffer.from(JSON.stringify({id:MASTER_ID,iat:now,exp:now+SESSION_MS})).toString('base64url');
    res.setHeader('Set-Cookie',`${COOKIE_NAME}=${payload}.${sign(payload)}; HttpOnly; Secure; SameSite=Strict; Path=/api/gm/bank; Max-Age=28800`);
    console.log('[GM_BANK_MEMBER_LOGIN_V007]',JSON.stringify({member_id:MASTER_ID}));
    return ok(res,{authenticated:true,member_id:MASTER_ID,expires_in_seconds:28800});
  }catch(err){ console.error('[GM_BANK_MEMBER_LOGIN_ERROR_V007]',String(err.message||err));return fail(res,503,'MEMBER_AUTH_UNAVAILABLE'); }
});
router.get('/api/gm/bank/admin/status',(req,res)=>ok(res,{authenticated:validSession(req)}));
router.get('/api/gm/bank/admin/diag',(req,res)=>ok(res,{route_mounted:true,auth:'member',session_secret_ready:sessionSecret().length>=32}));
router.post('/api/gm/bank/admin/logout',requireBankSession,(req,res)=>{
  res.setHeader('Set-Cookie',`${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/api/gm/bank; Max-Age=0`);
  return ok(res,{authenticated:false});
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
  const memberId = req.bankAdminId;
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
      WHERE bank_transaction_id=$1 AND COALESCE(matched_order_no,'') NOT LIKE 'GPAY:%'
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
  const operator=req.bankAdminId;
  const memo=clean(b.bank_memo);
  const description=clean(b.description);
  const amount=Number(b.deposit_amount);
  const datetime=clean(b.transaction_at);
  if(!/^[A-Z0-9_]{2,20}$/.test(bank) || !/^\d{6,30}$/.test(account)) return fail(res,400,'invalid bank or account');
  if(!Number.isSafeInteger(amount)||amount<=0) return fail(res,400,'invalid deposit amount');
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(datetime) || !Number.isFinite(new Date(datetime+'+09:00').getTime())) return fail(res,400,'invalid KST timestamp');
  if(reference.length<6 || reference.length>160 || !operator || operator.length>160) return fail(res,400,'reference and operator required');
  if(memo.length>4000 || description.length>1000) return fail(res,400,'text too long');
  const memberId=clean(b.gpay_member_id),requestNumber=clean(b.gpay_request_no);
  if(!memberId||!/^GR-[A-Za-z0-9-]{8,80}$/.test(requestNumber)) return fail(res,400,'MEMBER_AND_REQUEST_REQUIRED');
  let requestData;
  try{requestData=(await gpayBridge('/api/gpay/issue-requests/lookup/by-request-no/'+encodeURIComponent(requestNumber),'GET')).item;}
  catch(e){return fail(res,e.status||502,e.message);}
  if(String(requestData.from_id)!==memberId||Number(requestData.total_amount)!==amount||
      !['HQ_DEPOSIT_PENDING','AGENT_DEPOSIT_PENDING'].includes(requestData.process_state))return fail(res,409,'PURCHASE_MEMBER_AMOUNT_OR_STATE_MISMATCH');
  const normalized=datetime.replace('T',' ')+(datetime.length===16?':00':'');
  // Manual reference must be uniquely stable on repeat; avoid auto-matching an actual bank row.
  const transactionHash=sha256(Buffer.from(['MANUAL',bank,account,reference].join('|')));
  const raw=JSON.stringify({source:'MANUAL_ASSERTION',reference,operator,submitted_at:new Date().toISOString(),gpay_member_id:memberId,gpay_request_no:requestNumber,gpay_request_verified:true});
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

// INTERNAL G-PAY bridge: distinct from member login; secret is server-to-server only.
// Fail closed if a shared credential has not been configured on BOTH services.
function requireGpayServiceAuth(req,res,next){
 const expected=clean(process.env.GPAY_GLOMART_BANK_TOKEN);
 const supplied=clean(req.headers['x-gm-bank-token']);
 if(expected.length<32) return fail(res,503,'GPAY_BANK_BRIDGE_NOT_CONFIGURED');
 if(!equal(expected,supplied)) return fail(res,401,'GPAY_BANK_BRIDGE_UNAUTHORIZED');
 return next();
}

// G-PAY bank claim uses the existing immutable bank transaction row, not a new bank ledger.
// Authenticated internal calls only; buyer requests never access these endpoints.
router.post('/api/gm/bank/gpay/claim', requireGpayServiceAuth, async(req,res)=>{
  const pool=db(req), b=req.body||{};
  const tx=Number(b.bank_transaction_id), amount=Number(b.amount);
  const ref=clean(b.request_no), scope=clean(b.collection_scope);
  if(!Number.isSafeInteger(tx)||tx<=0||!Number.isSafeInteger(amount)||amount<=0||!/^GR-[A-Za-z0-9-]+$/.test(ref)||!['HQ','AGENT'].includes(scope)) return fail(res,400,'INVALID_BANK_CLAIM');
  const c=await pool.connect();
  try {
    await c.query('BEGIN');
    const q=await c.query('SELECT * FROM gm_bank_transaction WHERE bank_transaction_id=$1 FOR UPDATE',[tx]);
    if(!q.rowCount){await c.query('ROLLBACK');return fail(res,404,'BANK_TRANSACTION_NOT_FOUND');}
    const t=q.rows[0];
    // Keep account ownership verification fail-closed. Map agent_id -> account_no in env.
    let accounts;
    try { accounts=JSON.parse(process.env.GPAY_BANK_ACCOUNT_MAP||'{}'); } catch(_) {accounts={};}
    const ownerKey=scope==='HQ'?'HQ':`AGENT:${Number(b.agent_id)}`;
    const approvedAccounts=accounts[ownerKey];
    if(!Array.isArray(approvedAccounts)||!approvedAccounts.map(clean).includes(clean(t.account_no))){
      await c.query('ROLLBACK');return fail(res,409,'BANK_ACCOUNT_NOT_AUTHORIZED_FOR_RECIPIENT');
    }
    if(Number(t.deposit_amount)!==amount){await c.query('ROLLBACK');return fail(res,409,'AMOUNT_MISMATCH');}
    if(t.process_status==='MATCHED' && t.matched_order_no===`GPAY:${ref}`){await c.query('COMMIT');return ok(res,{already_claimed:true,deposit_amount:Number(t.deposit_amount)});}
    if(t.process_status!=='UNPROCESSED'){await c.query('ROLLBACK');return fail(res,409,'BANK_TRANSACTION_ALREADY_USED');}
    const upd=await c.query(`UPDATE gm_bank_transaction SET process_status='MATCHED',matched_order_no=$2,matched_amount=deposit_amount,
      processed_at=NOW(),processed_by_member_id='GPAY_BRIDGE',updated_at=NOW() WHERE bank_transaction_id=$1 RETURNING deposit_amount`,[tx,`GPAY:${ref}`]);
    await c.query('COMMIT');return ok(res,{deposit_amount:Number(upd.rows[0].deposit_amount)});
  }catch(e){await c.query('ROLLBACK').catch(()=>{});return fail(res,500,'BANK_GPAY_CLAIM_FAILED');}finally{c.release();}
});
router.post('/api/gm/bank/gpay/lookup', requireGpayServiceAuth, async(req,res)=>{
  const pool=db(req), ref=clean(req.body?.request_no);
  if(!/^GR-[A-Za-z0-9-]+$/.test(ref))return fail(res,400,'INVALID_REQUEST_REF');
  try{const q=await pool.query(`SELECT bank_transaction_id,deposit_amount,process_status,matched_order_no,account_no FROM gm_bank_transaction WHERE matched_order_no=$1`,[`GPAY:${ref}`]);
    return ok(res,{transactions:q.rows});}catch(e){return fail(res,500,'BANK_LOOKUP_FAILED');}
});



// GM_GPAY_BANK_V013: master-session-only proxy to G-PAY. Authentication above is V008 unchanged.
const GPAY_REQUEST_BASE=()=>clean(process.env.GPAY_API_BASE_URL||process.env.GPAY_SERVER_URL).replace(/\/$/,'');
async function gpayBridge(path,method,body){
  const base=GPAY_REQUEST_BASE(),secret=clean(process.env.GPAY_TRUSTED_CALLER_KEY);
  if(!base||secret.length<32){const e=Error('GPAY_BRIDGE_NOT_CONFIGURED');e.status=503;throw e;}
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),8000);
  try{
    const u=new URL(path,base+'/');
    if(u.origin!==new URL(base).origin)throw Error('INVALID_BRIDGE_URL');
    const response=await fetch(u,{method,headers:{'x-gpay-trusted-caller':secret,...(body?{'content-type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),signal:abort.signal});
    const type=response.headers.get('content-type')||'';
    if(!type.includes('application/json')){const e=Error('GPAY_NON_JSON_RESPONSE');e.status=502;throw e;}
    const data=await response.json();
    if(!response.ok||!data.ok){const e=Error(data.error||'GPAY_UPSTREAM_FAILED');e.status=response.status;throw e;}
    return data;
  }finally{clearTimeout(timer);}
}
router.get('/api/gm/bank/gpay/pending-requests',requireBankSession,async(req,res)=>{
 const member=clean(req.query.member_id);
 if(!member||member.length>100)return fail(res,400,'MEMBER_ID_REQUIRED');
 try{const data=await gpayBridge('/api/gpay/issue-requests/lookup/pending-purchases?member_id='+encodeURIComponent(member),'GET');
   return ok(res,{items:data.items||[]});
 }catch(e){console.error('[GM_BANK_PURCHASE_LIST_FAILED]',e.message);return fail(res,e.status||502,e.message);}
});
router.get('/api/gm/bank/gpay/request/:requestNo',requireBankSession,async(req,res)=>{
  const no=clean(req.params.requestNo);
  if(!/^GR-[A-Za-z0-9-]{8,80}$/.test(no))return fail(res,400,'INVALID_REQUEST_NUMBER');
  try{const info=await gpayBridge('/api/gpay/issue-requests/lookup/by-request-no/'+encodeURIComponent(no),'GET');
    return ok(res,{item:info.item});
  }catch(e){console.error('[GM_BANK_V013_LOOKUP_FAILED]',e.message);return fail(res,e.status||502,e.message);}
});
router.post('/api/gm/bank/gpay/verify-manual',requireBankSession,async(req,res)=>{
  const no=clean(req.body?.request_no),member=clean(req.body?.member_id),tx=Number(req.body?.bank_transaction_id);
  if(!/^GR-[A-Za-z0-9-]{8,80}$/.test(no)||!member||!Number.isSafeInteger(tx)||tx<=0)return fail(res,400,'INVALID_CONFIRMATION_INPUT');
  try{
    const record=await db(req).query(`SELECT bank_transaction_id,deposit_amount,process_status,source_type,raw_json FROM gm_bank_transaction WHERE bank_transaction_id=$1`,[tx]);
    if(!record.rowCount)return fail(res,404,'BANK_TRANSACTION_NOT_FOUND');
    const t=record.rows[0];
    if(t.process_status!=='UNPROCESSED')return fail(res,409,'BANK_TRANSACTION_ALREADY_PROCESSED');
    const lookup=await gpayBridge('/api/gpay/issue-requests/lookup/by-request-no/'+encodeURIComponent(no),'GET');
    const r=lookup.item;
    if(r.from_id!==member||Number(r.total_amount)!==Number(t.deposit_amount))return fail(res,409,'MEMBER_OR_AMOUNT_MISMATCH');
    if(!['HQ_DEPOSIT_PENDING','AGENT_DEPOSIT_PENDING'].includes(r.process_state))return fail(res,409,'PURCHASE_NOT_PENDING');
    // For a manually registered transaction require previously validated pair in source metadata.
    if(t.source_type==='MANUAL'){
      const raw=typeof t.raw_json==='string'?JSON.parse(t.raw_json):t.raw_json||{};
      if(raw.gpay_member_id!==member||raw.gpay_request_no!==no||raw.gpay_request_verified!==true) return fail(res,409,'MANUAL_RECORD_NOT_LINKED_TO_REQUEST');
      const result=await gpayBridge('/api/gpay/issue-requests/'+r.id+'/verify-payment','POST',
        {method:'MANUAL',actor_id:req.bankAdminId,proof_ref:'BANK_MANUAL:'+tx});
      return ok(res,{verified:true,state:result.state,request_no:no,request_id:r.id});
    }
    // File-based transactions are claimed through G-PAY -> bank service; no manual override.
    const result=await gpayBridge('/api/gpay/issue-requests/'+r.id+'/verify-payment','POST',
      {method:'BANK_FILE',actor_id:req.bankAdminId,bank_transaction_id:tx});
    return ok(res,{verified:true,state:result.state,request_no:no,request_id:r.id});
  }catch(e){console.error('[GM_BANK_V013_VERIFY_FAILED]',e.message);return fail(res,e.status||502,e.message);}
});

module.exports = router;
