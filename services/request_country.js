'use strict';

// Resolve only a country code; raw IP is never persisted by this module.
const CACHE = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 5000;

function normCountry(v){
  const x=String(v||'').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(x) && x !== 'XX' ? x : '';
}
function cleanIp(v){
  let x=String(v||'').split(',')[0].trim();
  if(!x) return '';
  if(x.startsWith('::ffff:')) x=x.slice(7);
  if(x==='::1') return '127.0.0.1';
  return x;
}
function isPrivateIp(ip){
  if(!ip) return true;
  if(/^127\./.test(ip) || /^10\./.test(ip) || /^192\.168\./.test(ip) || /^169\.254\./.test(ip)) return true;
  const m=ip.match(/^172\.(\d+)\./); if(m && Number(m[1])>=16 && Number(m[1])<=31) return true;
  if(ip==='0.0.0.0' || ip==='localhost') return true;
  if(ip.includes(':') && (/^(fc|fd|fe80)/i.test(ip))) return true;
  return false;
}
function headerCountry(req){
  const h=(req&&req.headers)||{};
  const keys=['cf-ipcountry','cloudfront-viewer-country','x-vercel-ip-country','x-country-code','x-geo-country'];
  for(const k of keys){ const c=normCountry(h[k]); if(c) return c; }
  return '';
}
function requestIp(req){
  const h=(req&&req.headers)||{};
  return cleanIp(h['cf-connecting-ip'] || h['x-real-ip'] || h['x-forwarded-for'] || (req&&req.ip) || (req&&req.socket&&req.socket.remoteAddress));
}
function cacheSet(ip,country){
  if(!ip) return;
  if(CACHE.size>=CACHE_MAX){
    const first=CACHE.keys().next(); if(!first.done) CACHE.delete(first.value);
  }
  CACHE.set(ip,{country,at:Date.now()});
}
async function lookupIp(ip){
  if(!ip || isPrivateIp(ip) || String(process.env.GM_GEOIP_DISABLE||'').toUpperCase()==='Y') return '';
  const old=CACHE.get(ip);
  if(old && Date.now()-old.at<CACHE_TTL_MS) return old.country;
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),1800);
  try{
    const tpl=String(process.env.GM_GEOIP_URL||'https://ipwho.is/{ip}?fields=success,country_code').trim();
    const url=tpl.replace('{ip}',encodeURIComponent(ip));
    const r=await fetch(url,{headers:{accept:'application/json'},signal:ctrl.signal});
    if(!r.ok) throw new Error('geo_http_'+r.status);
    const j=await r.json();
    const country=normCountry(j.country_code || j.countryCode || j.country || '');
    cacheSet(ip,country);
    return country;
  }catch(e){
    cacheSet(ip,'');
    return '';
  }finally{ clearTimeout(timer); }
}
async function resolveCountryCode(req){
  const hc=headerCountry(req); if(hc) return hc;
  return lookupIp(requestIp(req));
}
module.exports={resolveCountryCode,normCountry,requestIp};
