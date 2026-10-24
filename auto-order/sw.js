const CACHE='gm-auto-order-dashboard-v015';
const ASSETS=['./','./index.html','./dashboard.css?v=gm_v15','./dashboard_ui.js?v=gm_v15','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
// GM_AUTO_ORDER_SW_SCHEME_GUARD_V001: do not cache extension/non-web/cross-origin requests.
self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET')return;
  let url;
  try{url=new URL(req.url)}catch(_){return;}
  if((url.protocol!=='http:'&&url.protocol!=='https:')||url.origin!==self.location.origin)return;
  if(url.pathname.startsWith('/api/'))return;
  e.respondWith(fetch(req).then(response=>{
    if(response.ok&&response.type==='basic'){
      const copy=response.clone();
      e.waitUntil(caches.open(CACHE).then(cache=>cache.put(req,copy)).catch(err=>{
        console.warn('[GM_AUTO_ORDER_SW_CACHE_SKIP]',String(err&&err.name||'CACHE_ERROR'));
      }));
    }
    return response;
  }).catch(()=>caches.match(req)));
});
