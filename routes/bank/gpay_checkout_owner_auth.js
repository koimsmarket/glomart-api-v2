 'use strict';
// GM_GPAY_OWNER_AUTH_V060_DIAG: distinguish malformed hash / missing argon2 / invalid credentials; no bypass
// Explicit password verification only; member ID or Cafe24 admin cookie is NOT authentication.
// TODO: replace manual password challenge with independently validated member session.
const router = require('express').Router();
const { gmVerifyHash } = require('../GM_MEMBER_PASSWORD');
let argon2Ready=false;try{argon2Ready=!!require('argon2').verify;}catch(_e){}
const BASE_DEFAULT = 'https://port-0-guppy-pay-api-mss6kcqn688f1333.sel3.cloudtype.app';
const attempts = new Map();
const s = x => String(x == null ? '' : x).trim();
function fail(res, code, status) { return res.status(status).json({ok:false,error:code}); }
router.post('/api/gm/gpay/checkout-owner-auth', async (req,res) => {
  res.set('Cache-Control','no-store');
  const mid = s(req.body && req.body.member_id);
  const pw = req.body && typeof req.body.password==='string' ? req.body.password : '';
  if (!/^[A-Za-z0-9._@-]{2,80}$/.test(mid) || pw.length<8 || pw.length>256) return fail(res,'INVALID_INPUT',400);
  const ip = s(req.ip).slice(0,120);
  const key = ip + '|' + mid.toLowerCase();
  const now = Date.now();
  // Rudimentary process-local backoff; production multi-instance needs shared durable limiter.
  if (attempts.size>5000) for(const [k,v] of attempts) if(now-v.at>15*60*1000)attempts.delete(k);
  let entry=attempts.get(key)||{count:0,at:now};
  if(now-entry.at>15*60*1000)entry={count:0,at:now};
  if(entry.count>=5) return fail(res,'TRY_AGAIN_LATER',429);
  attempts.set(key,{count:entry.count+1,at:entry.at});
  const db = req.app.locals.pool;
  if(!db) return fail(res,'MEMBER_DB_UNAVAILABLE',503);
  try {
    const q = await db.query('SELECT member_id,password_hash FROM gm_member WHERE member_id=$1 LIMIT 1',[mid]);
    const row = q.rows[0];
    if(!row || !row.password_hash) return fail(res,'MEMBER_PASSWORD_NOT_READY',403);
    // Only metadata, never plaintext password, complete hash, token, or member ID.
    const stored=String(row.password_hash);
    const hashKind=stored.startsWith('$argon2')?'ARGON2':stored.startsWith('pbkdf2_sha512$')?'PBKDF2_SHA512':'OTHER';
    if(hashKind==='OTHER'){
      console.error('[GM_GPAY_OWNER_AUTH_V060] VERIFY_BLOCKED reason=HASH_FORMAT_UNSUPPORTED');
      return fail(res,'MEMBER_HASH_FORMAT_UNSUPPORTED',503);
    }
    if(hashKind==='ARGON2' && !argon2Ready){
      console.error('[GM_GPAY_OWNER_AUTH_V060] VERIFY_BLOCKED reason=ARGON2_MODULE_MISSING');
      return fail(res,'MEMBER_HASH_VERIFIER_UNAVAILABLE',503);
    }
    const passwordValid=await gmVerifyHash(pw,stored);
    if(!passwordValid){
      console.warn('[GM_GPAY_OWNER_AUTH_V060] VERIFY_REJECTED reason=CREDENTIALS_NOT_MATCHED hash_kind='+hashKind);
      return fail(res,'INVALID_CREDENTIALS',401);
    }
    console.info('[GM_GPAY_OWNER_AUTH_V060] PASSWORD_VERIFIED hash_kind='+hashKind);
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
    attempts.delete(key);
    console.info('[GM_GPAY_OWNER_AUTH_V057] OWNER_VERIFIED');
    return res.json({ok:true,member_id:row.member_id,certificate_owner_token:data.certificate_owner_token,expires_in:300});
  }catch(e){console.error('[GM_GPAY_OWNER_AUTH_V057] ERROR type='+s(e.name));return fail(res,'GPAY_OWNER_AUTH_UNAVAILABLE',502);}
});
module.exports=router;
