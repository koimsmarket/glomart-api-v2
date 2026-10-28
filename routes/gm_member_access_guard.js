// GM_ADMIN_SECURITY_V006: member-only access token, independent of admin/Guppy sessions.
'use strict';
const crypto=require('crypto');
const SECRET=()=>String(process.env.GM_MEMBER_ACCESS_TOKEN_SECRET||'');
const enabled=()=>Buffer.byteLength(SECRET(),'utf8')>=32;
const ENFORCE=()=>String(process.env.GM_MEMBER_PROFILE_AUTH_ENFORCE||'0')==='1';
const TTL=15*60;
const b64=s=>Buffer.from(s,'utf8').toString('base64url');
function issue(memberId){
  if(!enabled())return null;
  const now=Math.floor(Date.now()/1000);
  const p=b64(JSON.stringify({v:1,sub:String(memberId),aud:'gm-member-profile',iat:now,exp:now+TTL,jti:crypto.randomBytes(12).toString('hex')}));
  const sig=crypto.createHmac('sha256',SECRET()).update(p).digest('base64url');
  return p+'.'+sig;
}
function validate(req){
  if(!enabled())return null;
  const a=String(req.get('authorization')||'');
  const m=/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(a);
  if(!m)return null;
  const [p,sig]=m[1].split('.');
  const expected=crypto.createHmac('sha256',SECRET()).update(p).digest('base64url');
  const x=Buffer.from(sig),y=Buffer.from(expected);
  if(x.length!==y.length||!crypto.timingSafeEqual(x,y))return null;
  try{
    const d=JSON.parse(Buffer.from(p,'base64url').toString('utf8'));
    const now=Math.floor(Date.now()/1000);
    if(d.v!==1||d.aud!=='gm-member-profile'||!Number.isInteger(d.iat)||!Number.isInteger(d.exp)||d.iat>now+30||d.exp<now||d.exp>d.iat+TTL||typeof d.sub!=='string'||!d.sub||d.sub.length>128)return null;
    return d.sub;
  }catch(_){return null}
}
const paths=new Set(['/api/gm/member/me','/api/member/me','/api/gm/member/list','/api/gm/member/profile']);
function middleware(req,res,next){
  if(!paths.has(req.path.toLowerCase())||!['GET','HEAD'].includes(req.method))return next();
  if(!ENFORCE())return next(); // V005 staged; legacy clients must migrate before enablement.
  res.set('Cache-Control','no-store');
  const verified=validate(req);
  if(!verified)return res.status(401).json({ok:false,error:'MEMBER_LOGIN_REQUIRED'});
  const requested=String(req.query.member_id||req.query.memberId||req.query.id||'').trim();
  if(!requested||verified!==requested)return res.status(403).json({ok:false,error:'MEMBER_ACCESS_DENIED'});
  return next();
}
module.exports={issue,validate,middleware,enabled,ENFORCE};
