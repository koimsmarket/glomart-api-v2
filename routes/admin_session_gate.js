// GM_ADMIN_SESSION_GATE_V001. Isolated admin-only guard; does not touch customer sessions.
'use strict';
const crypto = require('crypto');
const {gmVerifyHash}=require('./GM_MEMBER_PASSWORD');
const COOKIE='__Host-gm_admin';
const sessions=new Map(), failures=new Map();
const MAX_AGE=30*60*1000, IDLE=15*60*1000, MAX_FAILURES=5, FAILURE_WINDOW=15*60*1000;
function log(action,req,detail){console.log('[GM_ADMIN_GATE_V001]',JSON.stringify({action,ip:req.ip||'',path:req.path,detail:detail||'',at:new Date().toISOString()}));}
function cookie(req,value,age){return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;}
function getCookie(req){const h=String(req.headers.cookie||'');const re=new RegExp('(?:^|;\\s*)'+COOKIE+'=([^;]*)');const m=h.match(re);return m?m[1]:'';}
function sameOrigin(req){const origin=String(req.get('origin')||'');const host=String(req.get('host')||'');if(!origin||!host)return false;try{return new URL(origin).host===host&&new URL(origin).protocol==='https:'}catch(_){return false}}
// GM_ADMIN_SESSION_GATE_V002: All Builder documents/assets and known admin APIs,
// including /public aliases, require the same authenticated server-side session.
const ADMIN_DOCUMENTS=new Set(['/gm_admin.html','/gm_data_builder.html','/ui_dictionary_admin.html','/product_data_builder.html','/admin','/gm_admin']);
const ADMIN_API_EXACT=new Set(['/api/gm/db/table-counts','/api/gm/dashboard/ops','/api/gm/dashboard/snapshot']);
function canonicalPath(req){
 let p=String(req.path||'/');
 try{p=decodeURIComponent(p)}catch(_){return '/__invalid_admin_path__'}
 if(/[\\\u0000-\u001f]/.test(p))return '/__invalid_admin_path__';
 p=p.replace(/\/{2,}/g,'/').toLowerCase().replace(/\/$/,'')||'/';
 // express.static is registered both on / and /public; strip repeated aliases.
 while(p.startsWith('/public/'))p=p.slice('/public'.length);
 return p;
}
function isAdminPath(req){
 const p=canonicalPath(req);
 return ADMIN_DOCUMENTS.has(p)||ADMIN_API_EXACT.has(p)||
   p==='/builder'||p.startsWith('/builder/')||
   p==='/api/gm/builder'||p.startsWith('/api/gm/builder/')||
   p==='/api/gm/admin'||p.startsWith('/api/gm/admin/')||
   p==='/api/gm/ui-dictionary/admin'||p.startsWith('/api/gm/ui-dictionary/admin/');
}

function valid(req){const token=getCookie(req);if(!/^[a-f0-9]{64}$/.test(token))return false;const k=crypto.createHash('sha256').update(token).digest('hex');const a=sessions.get(k);if(!a)return false;const now=Date.now();if(now>a.exp||now-a.last>IDLE){sessions.delete(k);return false}a.last=now;return true;}
function loginForm(res){res.status(200).type('html').set('Cache-Control','no-store').send(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Glomart 관리자 로그인</title></head><body><main style="max-width:370px;margin:12vh auto;font:16px sans-serif;padding:20px"><h2>관리자 인증</h2><form id="f"><input id="pw" type="password" required autocomplete="current-password" placeholder="관리자 비밀번호" style="width:100%;padding:12px;box-sizing:border-box"><button type="submit" style="margin-top:16px;padding:12px">인증</button></form><p id="msg" role="alert"></p></main><script>document.getElementById('f').addEventListener('submit',async e=>{e.preventDefault();const p=document.getElementById('pw');const msg=document.getElementById('msg');try{const r=await fetch('/gm-admin-auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:p.value}),credentials:'same-origin',cache:'no-store'});p.value='';if(r.ok)location.replace('/gm_data_builder.html');else msg.textContent='인증에 실패했습니다 ('+r.status+')';}catch(_){msg.textContent='서버 연결에 실패했습니다';}});</script></body></html>`);}
async function middleware(req,res,next){const p=canonicalPath(req);
 if(p==='/gm-admin-auth/login'&&req.method==='GET')return loginForm(res);
 if(p==='/gm-admin-auth/status'&&req.method==='GET')return res.set('Cache-Control','no-store').json({ok:true,authenticated:valid(req)});
 if(p==='/gm-admin-auth/logout'&&req.method==='POST'){if(!sameOrigin(req))return res.sendStatus(403);const token=getCookie(req);if(token)sessions.delete(crypto.createHash('sha256').update(token).digest('hex'));res.set('Set-Cookie',cookie(req,'',0));log('LOGOUT',req);return res.set('Cache-Control','no-store').json({ok:true});}
 if(p==='/gm-admin-auth/login'&&req.method==='POST'){
  res.set('Cache-Control','no-store');if(!sameOrigin(req))return res.status(403).json({ok:false,error:'ORIGIN_REJECTED'});
  const ip=req.ip||'unknown',now=Date.now(),f=failures.get(ip);if(f&&now-f.start<FAILURE_WINDOW&&f.count>=MAX_FAILURES)return res.status(429).json({ok:false,error:'RATE_LIMIT'});
  const password=typeof req.body?.password==='string'?req.body.password:'';if(!password||password.length>256)return res.status(400).json({ok:false,error:'INVALID_INPUT'});
  try{const pool=req.app.locals.pool;if(!pool)return res.status(503).json({ok:false,error:'DB_UNAVAILABLE'});const r=await pool.query('SELECT password_hash FROM gm_member WHERE member_id=$1 LIMIT 1',['derzon']);const hash=r.rows[0]?.password_hash;
   if(!hash||!await gmVerifyHash(password,String(hash))){const a=f&&now-f.start<FAILURE_WINDOW?f:{start:now,count:0};a.count++;failures.set(ip,a);log('DENY_LOGIN',req);return res.status(401).json({ok:false,error:'INVALID_CREDENTIALS'});}
   failures.delete(ip);const token=crypto.randomBytes(32).toString('hex');sessions.set(crypto.createHash('sha256').update(token).digest('hex'),{exp:now+MAX_AGE,last:now,member:'derzon'});res.set('Set-Cookie',cookie(req,token,Math.floor(MAX_AGE/1000)));log('LOGIN',req);return res.json({ok:true});
  }catch(e){log('AUTH_ERROR',req,e?.code||'UNKNOWN');return res.status(503).json({ok:false,error:'AUTH_UNAVAILABLE'});}
 }
 if(!isAdminPath(req))return next();
 res.set('Cache-Control','no-store');if(!valid(req)){log('DENY_ACCESS',req);if(req.method==='GET'&&!p.startsWith('/api/')&&req.accepts('html'))return res.redirect(302,'/gm-admin-auth/login');return res.status(401).json({ok:false,error:'ADMIN_LOGIN_REQUIRED'});}
 if(!['GET','HEAD','OPTIONS'].includes(req.method)&&!sameOrigin(req))return res.status(403).json({ok:false,error:'ORIGIN_REJECTED'});
 log('ACCESS',req);return next();
}
module.exports={middleware};
