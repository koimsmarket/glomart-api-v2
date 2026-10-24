'use strict';
// GM_BUILDER_ADMIN_REAUTH_V001: server-side password hash verification for
// explicitly selected administrative table operations only.
// The password is never cached and is verified for each individual request.
const { gmVerifyHash } = require('../GM_MEMBER_PASSWORD');
const attempts = new Map();
const ADMIN_ID = 'derzon';
function protectedOperation(req) {
  const method = req.method.toUpperCase();
  const path = req.path;
  if (method === 'GET') return (
    path === '/api/gm/builder/export' ||
    path === '/api/gm/builder/export-all' ||
    path === '/api/gm/builder/cafe24-member-export'
  );
  if (method !== 'POST') return false;
  if (path === '/api/gm/background/image-vector/mode' || path === '/api/gm/background/image-vector/pending/import') return true;
  if (path === '/api/gm/builder/safe-update') return true; // DRY_RUN also uploads data; authenticate all uploads
  return (
    path === '/api/gm/builder/cafe24-member-import' ||
    path === '/api/gm/builder/record/update' ||
    path === '/api/gm/builder/record/delete-selected'
  );
}
async function requireBuilderReauth(req,res,next) {
  if (!protectedOperation(req)) return next();
  res.set('Cache-Control','no-store');
  const key = String(req.ip||'unknown');
  const now = Date.now();
  let attempt = attempts.get(key);
  if (!attempt || now-attempt.start > 15*60*1000) attempt={start:now,count:0};
  if (attempt.count>=5) return res.status(429).json({ok:false,error:'BUILDER_AUTH_RATE_LIMIT'});
  const password = req.get('x-gm-builder-admin-password') || '';
  if (!password || password.length>256) return res.status(401).json({ok:false,error:'BUILDER_REAUTH_REQUIRED'});
  const pool = req.app && req.app.locals && req.app.locals.pool;
  if (!pool) return res.status(503).json({ok:false,error:'BUILDER_AUTH_DB_UNAVAILABLE'});
  try {
    const result = await pool.query('SELECT password_hash FROM gm_member WHERE member_id=$1 LIMIT 1',[ADMIN_ID]);
    const hash = result.rows[0] && result.rows[0].password_hash;
    if (!hash || !(await gmVerifyHash(password,String(hash)))) {
      attempt.count++; attempts.set(key,attempt);
      return res.status(401).json({ok:false,error:'BUILDER_AUTH_INVALID'});
    }
    attempts.delete(key);
    res.set('X-GM-Builder-Reauth','verified');
    return next();
  } catch (e) {
    console.error('[GM_BUILDER_ADMIN_REAUTH_V001] verify failed:',e && e.code || 'UNKNOWN');
    return res.status(503).json({ok:false,error:'BUILDER_AUTH_UNAVAILABLE'});
  }
}
module.exports={requireBuilderReauth,protectedOperation};
