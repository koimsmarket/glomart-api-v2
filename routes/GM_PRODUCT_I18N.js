'use strict';
const express=require('express');
const crypto=require('crypto');
const svc=require('../services/GM_PRODUCT_I18N');
const router=express.Router();
const pool=req=>req.app.locals.pool;
const reply=(res,fn)=>Promise.resolve().then(fn).then(data=>res.set('Cache-Control','no-store').json({ok:true,...data})).catch(e=>res.status(e.status||500).set('Cache-Control','no-store').json({ok:false,error:e.status?e.message:'I18N_DB_ERROR'}));
// An unauthenticated translation write endpoint would permit DB poisoning.
// Server-only key for staging/testing; do NOT embed in browser/Android clients.
// V004 must replace this boundary with the existing verified member/collector authentication.
function writeGuard(req,res,next){
  const expected=process.env.GM_PRODUCT_I18N_API_KEY||'';
  const supplied=String(req.get('x-gm-product-i18n-key')||'');
  if(!expected||!supplied)return res.status(503).json({ok:false,error:'I18N_WRITE_AUTH_NOT_CONFIGURED'});
  const a=Buffer.from(expected),b=Buffer.from(supplied);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(401).json({ok:false,error:'UNAUTHORIZED'});
  next();
}
router.get('/api/gm/product-i18n/v003/lookup',(_req,res)=>res.status(410).json({ok:false,error:'LEGACY_QUEUE_LOOKUP_REMOVED'}));
// Legacy server-side queue API retired. Never recreate server pending records.
for(const action of ['register','claim','complete','fail']){
 router.post('/api/gm/product-i18n/v003/queue/'+action,(_req,res)=>res.status(410).json({ok:false,error:'SERVER_QUEUE_REMOVED_USE_INDEXEDDB'}));
}
module.exports=router;
