'use strict';
// GM_GPAY_V065 server settlement quote: READ/CALCULATE ONLY. No debit, no order completion.
const router=require('express').Router();
const point=require('../../services/order/member_point_service');
const {quote}=require('../../services/order/gpay_settlement_contract');
router.post('/api/gm/gpay/settlement/quote',async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{
    const b=req.body||{};
    const mid=String(b.member_id||'').trim();
    if(!/^[A-Za-z0-9._@-]{2,80}$/.test(mid))return res.status(400).json({ok:false,code:'INVALID_MEMBER'});
    const pool=req.app.locals.pool;
    if(!pool)return res.status(503).json({ok:false,code:'DB_UNAVAILABLE'});
    const summary=await point.getSummary(pool,mid);
    if(!summary.found)return res.status(404).json({ok:false,code:'MEMBER_NOT_FOUND'});
    const available=summary.point.available_point;
    const result=quote({product_amount_krw:b.product_amount_krw,shipping_amount_krw:b.shipping_amount_krw,point_use_krw:b.point_use_krw,available_point_krw:available});
    console.info('[GM_GPAY_SETTLEMENT_V065] QUOTE_OK member=Y point_used='+result.point_used_amount_krw+' gpay='+result.pay_amount_g);
    return res.json({ok:true,member_id:mid,settlement:result,authoritative:false});
  }catch(e){
    const reason=String(e&&e.message||e);
    if(/^(product_amount_|shipping_amount_|point_use_|available_point_|pay_amount_)/.test(reason))return res.status(400).json({ok:false,code:reason});
    console.error('[GM_GPAY_SETTLEMENT_V065] QUOTE_ERROR',reason);
    return res.status(500).json({ok:false,code:'QUOTE_FAILED'});
  }
});
module.exports=router;
