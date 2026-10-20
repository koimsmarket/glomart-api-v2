'use strict';
// GM_GPAY_CHECKOUT_BALANCE_V001. Read-only, per-member authenticated bridge.
// Never accept member_id alone as authorization. Never expose the trusted caller key.
const router = require('express').Router();
const DEFAULT_BASE = 'https://port-0-guppy-pay-api-mss6kcqn688f1333.sel3.cloudtype.app';
const base = () => String(process.env.GPAY_API_BASE || DEFAULT_BASE).trim().replace(/\/+$/, '');
const member = x => String(x || '').trim();
router.get('/api/gm/gpay/checkout-balance', async (req,res) => {
  res.set('Cache-Control','no-store');
  const id=member(req.query.member_id);
  const auth=String(req.get('authorization')||'');
  if(!id || id.length>120)return res.status(400).json({ok:false,error:'MEMBER_ID_REQUIRED'});
  if(!/^Bearer [A-Za-z0-9._~+\/-]+={0,2}$/i.test(auth))return res.status(401).json({ok:false,error:'GPAY_OWNER_TOKEN_REQUIRED'});
  try{
    const controller = new AbortController();
    const timeout=setTimeout(()=>controller.abort(),6000);
    let upstream;
    try{upstream=await fetch(base()+'/api/gpay/dashboard?member_id='+encodeURIComponent(id),{
      headers:{authorization:auth,accept:'application/json'},signal:controller.signal});}
    finally{clearTimeout(timeout)}
    if(!upstream.ok){
      console.warn('[GM_GPAY_CHECKOUT_BALANCE_V001] upstream_rejected status='+upstream.status);
      return res.status(upstream.status===401||upstream.status===403?403:502).json({ok:false,error:upstream.status===401||upstream.status===403?'GPAY_OWNER_AUTH_REJECTED':'GPAY_BALANCE_UPSTREAM_FAILED'});
    }
    const data=await upstream.json();
    const amount=Number(data.balance_g);
    if(data.ok!==true || member(data.member_id)!==id || !Number.isSafeInteger(amount) || amount<0)
      return res.status(502).json({ok:false,error:'GPAY_BALANCE_INVALID_RESPONSE'});
    console.log('[GM_GPAY_CHECKOUT_BALANCE_V001] verified member=Y');
    return res.json({ok:true,member_id:id,balance_g:amount});
  }catch(e){
    console.error('[GM_GPAY_CHECKOUT_BALANCE_V001] error='+String(e&&e.name||'UNKNOWN'));
    return res.status(502).json({ok:false,error:'GPAY_BALANCE_UNAVAILABLE'});
  }
});
module.exports=router;
