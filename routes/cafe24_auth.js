"use strict";

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const VERSION = 'GM_CAFE24_AUTH_V001';
const COOKIE_NAME = 'gm_auto_order_session';
const STATE_COOKIE = 'gm_cafe24_oauth_state';
const SESSION_SECONDS = Math.max(900, Number(process.env.CAFE24_SESSION_SECONDS || 28800));
const PRIVILEGED_ROLES = new Set(['MASTER','DEPUTY','SUBMASTER']);

function clean(v){ return String(v == null ? '' : v).trim(); }
function b64url(v){ return Buffer.from(v).toString('base64url'); }
function fromB64url(v){ return Buffer.from(v,'base64url').toString('utf8'); }
function secret(){ return clean(process.env.AUTH_SESSION_SECRET || process.env.SESSION_SECRET); }
function hmac(v){ return crypto.createHmac('sha256',secret()).update(v).digest('base64url'); }
function safeEqual(a,b){
  const x=Buffer.from(String(a||'')); const y=Buffer.from(String(b||''));
  return x.length===y.length && crypto.timingSafeEqual(x,y);
}
function parseCookies(req){
  const out={};
  for(const part of String(req.headers.cookie||'').split(';')){
    const i=part.indexOf('='); if(i<0) continue;
    out[decodeURIComponent(part.slice(0,i).trim())]=decodeURIComponent(part.slice(i+1).trim());
  }
  return out;
}
function cookieOptions(maxAge){
  return {httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge};
}
function signObject(obj){
  const body=b64url(JSON.stringify(obj));
  return body+'.'+hmac(body);
}
function readSigned(value){
  try{
    const [body,sig]=String(value||'').split('.');
    if(!body||!sig||!safeEqual(sig,hmac(body))) return null;
    const obj=JSON.parse(fromB64url(body));
    if(!obj.exp || Number(obj.exp)<Date.now()) return null;
    return obj;
  }catch(_){ return null; }
}
function currentUser(req){
  if(!secret()) return null;
  return readSigned(parseCookies(req)[COOKIE_NAME]);
}
function safeReturnTo(v){
  const s=clean(v);
  return s.startsWith('/') && !s.startsWith('//') ? s : '/auto-order/';
}
function authConfig(){
  return {
    mallId:clean(process.env.CAFE24_MALL_ID || 'koims1287'),
    clientId:clean(process.env.CAFE24_CLIENT_ID),
    clientSecret:clean(process.env.CAFE24_CLIENT_SECRET),
    redirectUri:clean(process.env.CAFE24_REDIRECT_URI),
    scope:clean(process.env.CAFE24_OAUTH_SCOPE || 'mall.read_application')
  };
}
function configMissing(c){
  const m=[];
  if(!c.mallId)m.push('CAFE24_MALL_ID'); if(!c.clientId)m.push('CAFE24_CLIENT_ID');
  if(!c.clientSecret)m.push('CAFE24_CLIENT_SECRET'); if(!c.redirectUri)m.push('CAFE24_REDIRECT_URI');
  if(!secret())m.push('AUTH_SESSION_SECRET'); return m;
}
async function findAuthorizedAccount(req,userId,mallId){
  const db=req.app.locals.db || req.app.locals.pool;
  const r=await db.query(`
    SELECT account_admin_id,admin_id,account_admin_role,mall_code,account_name,enabled
    FROM gm_auto_order_account
    WHERE lower(COALESCE(admin_id,''))=lower($1)
      AND enabled=true
    ORDER BY CASE upper(COALESCE(account_admin_role,''))
      WHEN 'MASTER' THEN 1 WHEN 'DEPUTY' THEN 2 WHEN 'SUBMASTER' THEN 2 ELSE 3 END,
      account_admin_id
    LIMIT 1
  `,[userId]);
  if(!r.rows.length) return null;
  const x=r.rows[0];
  return {
    account_admin_id:x.account_admin_id,
    admin_id:x.admin_id,
    role:clean(x.account_admin_role).toUpperCase(),
    account_name:x.account_name||'', mall_code:x.mall_code||'', mall_id:mallId
  };
}

router.get('/auth/cafe24/login',(req,res)=>{
  const c=authConfig(); const missing=configMissing(c);
  if(missing.length) return res.status(503).json({ok:false,error:'CAFE24_AUTH_NOT_CONFIGURED',missing,version:VERSION});
  const returnTo=safeReturnTo(req.query.return_to);
  const state=crypto.randomBytes(24).toString('base64url');
  res.cookie(STATE_COOKIE,signObject({state,return_to:returnTo,exp:Date.now()+10*60*1000}),cookieOptions(10*60*1000));
  const u=new URL(`https://${c.mallId}.cafe24api.com/api/v2/oauth/authorize`);
  u.searchParams.set('response_type','code'); u.searchParams.set('client_id',c.clientId);
  u.searchParams.set('state',state); u.searchParams.set('redirect_uri',c.redirectUri); u.searchParams.set('scope',c.scope);
  return res.redirect(u.toString());
});

router.get('/auth/cafe24/callback',async(req,res)=>{
  const c=authConfig(); const saved=readSigned(parseCookies(req)[STATE_COOKIE]);
  res.clearCookie(STATE_COOKIE,{path:'/'});
  if(!saved || !safeEqual(saved.state,clean(req.query.state))) return res.status(400).send('Cafe24 OAuth state verification failed.');
  if(!req.query.code) return res.status(400).send('Cafe24 authorization code is missing.');
  try{
    const body=new URLSearchParams({grant_type:'authorization_code',code:clean(req.query.code),redirect_uri:c.redirectUri});
    const tokenRes=await fetch(`https://${c.mallId}.cafe24api.com/api/v2/oauth/token`,{
      method:'POST',headers:{Authorization:'Basic '+Buffer.from(c.clientId+':'+c.clientSecret).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body
    });
    const text=await tokenRes.text(); let token={}; try{token=JSON.parse(text)}catch(_){ }
    if(!tokenRes.ok) return res.status(502).json({ok:false,error:'CAFE24_TOKEN_EXCHANGE_FAILED',status:tokenRes.status,detail:token.error_description||token.error||text.slice(0,300)});
    const userId=clean(token.user_id); const mallId=clean(token.mall_id||c.mallId);
    if(!userId) return res.status(502).json({ok:false,error:'CAFE24_USER_ID_MISSING'});
    const account=await findAuthorizedAccount(req,userId,mallId);
    if(!account) return res.status(403).send('지정된 자동주문 사용자 계정이 아니거나 비활성 상태입니다.');
    const session={...account,login_type:'CAFE24_ADMIN',iat:Date.now(),exp:Date.now()+SESSION_SECONDS*1000};
    res.cookie(COOKIE_NAME,signObject(session),cookieOptions(SESSION_SECONDS*1000));
    console.log('[GM_CAFE24_AUTH_LOGIN_V001]',JSON.stringify({mall_id:mallId,user_id:userId,role:account.role,account_admin_id:account.account_admin_id}));
    return res.redirect(safeReturnTo(saved.return_to));
  }catch(e){
    console.error('[GM_CAFE24_AUTH_CALLBACK_ERROR_V001]',String(e&&e.message||e));
    return res.status(500).json({ok:false,error:'CAFE24_AUTH_CALLBACK_FAILED',detail:String(e&&e.message||e)});
  }
});

router.get('/api/auth/me',(req,res)=>{
  const user=currentUser(req);
  if(!user) return res.status(401).json({ok:false,authenticated:false,error:'AUTH_REQUIRED',login_url:'/auth/cafe24/login?return_to='+encodeURIComponent(req.query.return_to||'/auto-order/'),version:VERSION});
  return res.json({ok:true,authenticated:true,user:{mall_id:user.mall_id,admin_id:user.admin_id,role:user.role,account_name:user.account_name,login_type:user.login_type},version:VERSION});
});
router.all('/auth/logout',(req,res)=>{
  res.clearCookie(COOKIE_NAME,{path:'/'});
  if(req.method==='GET') return res.redirect('/auto-order/');
  return res.json({ok:true,action:'logout'});
});

function requireCafe24Roles(roles){
  const allowed=new Set((roles||[]).map(x=>String(x).toUpperCase()));
  return (req,res,next)=>{
    const user=currentUser(req);
    if(!user) return res.status(401).json({ok:false,error:'AUTH_REQUIRED',login_url:'/auth/cafe24/login?return_to='+encodeURIComponent(req.originalUrl||'/auto-order/')});
    if(allowed.size && !allowed.has(String(user.role||'').toUpperCase())) return res.status(403).json({ok:false,error:'ROLE_DENIED',role:user.role,required:[...allowed]});
    req.authUser=user; next();
  };
}
function requirePrivileged(req,res,next){ return requireCafe24Roles([...PRIVILEGED_ROLES])(req,res,next); }

router.currentUser=currentUser;
router.requireCafe24Roles=requireCafe24Roles;
router.requirePrivileged=requirePrivileged;
router.PRIVILEGED_ROLES=PRIVILEGED_ROLES;
module.exports=router;
console.log('[GM_CAFE24_AUTH_V001] route loaded');
