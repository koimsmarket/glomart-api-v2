 'use strict';
// GM_GPAY_OWNER_AUTH_V121: PIN lock is DB-owned; password failures use distinct process-local backoff.
// Explicit password verification only; member ID or Cafe24 admin cookie is NOT authentication.
// TODO: replace manual password challenge with independently validated member session.
const router = require('express').Router();
const Credential = require('../../services/bank/gm_transaction_credential');

const BASE_DEFAULT = 'https://port-0-guppy-pay-api-mss6kcqn688f1333.sel3.cloudtype.app';
const attempts = new Map();
const s = x => String(x == null ? '' : x).trim();
function fail(res, code, status, extras) { return res.status(status).json(Object.assign({ok:false,error:code},extras||{})); }
function waitSeconds(until) { return Math.max(1,Math.ceil((until-Date.now())/1000)); }
router.post('/api/gm/gpay/checkout-owner-auth', async (req,res) => {
  res.set('Cache-Control','no-store');
  const mid = s(req.body && req.body.member_id);
  const pw = req.body && typeof req.body.password==='string' ? req.body.password : '';
  if (!/^[A-Za-z0-9._@-]{2,80}$/.test(mid)) return fail(res,'INVALID_INPUT',400);
  const ip = s(req.ip).slice(0,120);
  const method=s(req.body&&req.body.auth_method||'PASSWORD').toUpperCase();
  const purpose=s(req.body&&req.body.purpose||'PAYMENT').toUpperCase();
  if(!['PIN','PASSWORD'].includes(method)||!['PAYMENT','TRANSFER'].includes(purpose))return fail(res,'INVALID_INPUT',400);
  // PIN is rate-limited durably by gm_member_payment_pin, not this process-local map.
  // Password has its own independent failure-only limiter. An authorized PIN reset
  // must never remain blocked by prior PIN attempts.
  const key = ip + '|' + mid.toLowerCase() + '|PASSWORD';
  const now = Date.now();
  if (attempts.size>5000) for(const [k,v] of attempts) if(now-v.at>15*60*1000)attempts.delete(k);
  let entry=attempts.get(key)||{count:0,at:now};
  if(now-entry.at>15*60*1000)entry={count:0,at:now};
  if(method==='PASSWORD'&&entry.count>=5)return fail(res,'TRY_AGAIN_LATER',429,{retry_after_seconds:waitSeconds(entry.at+15*60*1000)});
  const db = req.app.locals.pool;
  if(!db) return fail(res,'MEMBER_DB_UNAVAILABLE',503);
  try {
    const q = await db.query('SELECT member_id,password_hash FROM gm_member WHERE member_id=$1 LIMIT 1',[mid]);
    const row = q.rows[0];
    if(!row || !row.password_hash) return fail(res,'MEMBER_PASSWORD_NOT_READY',403);
    // Shared member credential verification for payment AND transfer. No credential logging.
    const secret=method==='PIN'?req.body.pin:pw;
    const valid=await Credential.verify(db,{member_id:mid,method,secret,purpose});
    if(!valid){
      if(method==='PASSWORD'){
        const next=entry.count+1;
        attempts.set(key,{count:next,at:entry.at});
        if(next>=5)return fail(res,'TRY_AGAIN_LATER',429,{retry_after_seconds:waitSeconds(entry.at+15*60*1000)});
      }
      return fail(res,'INVALID_CREDENTIALS',401,{auth_method:method});
    }
    if(method==='PASSWORD')attempts.delete(key);
    console.info('[GM_GPAY_OWNER_AUTH_V114] CREDENTIAL_VERIFIED purpose='+purpose+' method='+method);
    const keySecret=s(process.env.GPAY_TRUSTED_CALLER_KEY);
    if(keySecret.length<32)return fail(res,'GPAY_SERVER_AUTH_NOT_READY',503);
    const base=s(process.env.GPAY_API_BASE||BASE_DEFAULT).replace(/\/+$/,'');
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),6000);
    let upstream;
    try { upstream=await fetch(base+'/api/gpay/security/certificate-access', {
      method:'POST',signal:controller.signal,
      headers:{'Content-Type':'application/json','Accept':'application/json','x-gpay-trusted-caller':keySecret},
      body:JSON.stringify({owner_type:'MEMBER',owner_id:row.member_id,ttl_seconds:300})
    }); }finally{clearTimeout(timeout)}
    if(!upstream.ok) {
      // Upstream error only. Never record passwords, signing keys or owner tokens.
      let upstreamCode='UNKNOWN';
      try { const problem=await upstream.json(); upstreamCode=s(problem && problem.error).slice(0,80)||'UNKNOWN'; }catch(_e){}
      console.error('[GM_GPAY_OWNER_AUTH_V058] TOKEN_UPSTREAM status='+upstream.status+' code='+upstreamCode);
      return fail(res, upstreamCode==='GPAY_CERT_ACCESS_KEY_NOT_READY' ? 'GPAY_TOKEN_SIGNING_NOT_READY' : 'GPAY_TOKEN_UPSTREAM_FAILED',upstream.status===503?503:502);
    }
    const data=await upstream.json();
    if(data.ok!==true || data.owner_id!==row.member_id || !data.certificate_owner_token)return fail(res,'GPAY_TOKEN_INVALID_RESPONSE',502);
    console.info('[GM_GPAY_OWNER_AUTH_V057] OWNER_VERIFIED');
    return res.json({ok:true,member_id:row.member_id,certificate_owner_token:data.certificate_owner_token,expires_in:300});
  }catch(e){const code=e.message==='PIN_HASH_PROVIDER_UNAVAILABLE'?'PIN_HASH_PROVIDER_UNAVAILABLE':e.message==='PIN_LOCKED'?'PIN_LOCKED':e.message==='PIN_INVALID'?'PIN_INVALID':'GPAY_OWNER_AUTH_UNAVAILABLE';console.error('[GM_GPAY_OWNER_AUTH_V121] VERIFY_ERROR code='+code+' type='+s(e.name));return fail(res,code,e.status||502,(e.retry_after_seconds||Number.isInteger(e.remaining_attempts))?{...(e.retry_after_seconds?{retry_after_seconds:e.retry_after_seconds}:{}),...(Number.isInteger(e.remaining_attempts)?{remaining_attempts:e.remaining_attempts}:{})}:null);}
});
// V114: registration requires existing member password; no logged-in session alone can register a PIN.
router.post('/api/gm/gpay/transaction-pin/register',async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{
    const db=req.app.locals.pool;if(!db)return fail(res,'MEMBER_DB_UNAVAILABLE',503);
    const v=await Credential.register(db,req.body||{});
    // Existing member password was successfully verified inside Credential.register().
    // No PIN attempt limiter remains in this route. Clear legacy process-local
    // counters for this authenticated member after successful PIN re-registration.
    const mid=s(req.body&&req.body.member_id).toLowerCase();
    for(const key of attempts.keys())if(key.split('|').slice(1).join('|')===mid+'|PASSWORD')attempts.delete(key);
    res.json({ok:true,registered:v.registered,pin_version:v.pin_version,remaining_attempts:5,lock_cleared:true});
  }catch(e){const code=e.message==='PIN_HASH_PROVIDER_UNAVAILABLE'?'PIN_HASH_PROVIDER_UNAVAILABLE':e.message==='INVALID_CREDENTIALS'?'INVALID_CREDENTIALS':'PIN_REGISTER_FAILED';console.error('[GM_GPAY_OWNER_AUTH_V116] PIN_REGISTER_ERROR code='+code+' type='+s(e.name));return fail(res,code,e.status||500);}
});
module.exports=router;
