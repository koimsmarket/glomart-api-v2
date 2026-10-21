'use strict';
// GM_BUILDER_PURCHASE_CONFIRM_V001
const router=require('express').Router();
const point=require('../../services/member_point_service');
const svc=require('../../services/purchase_confirm_service');
function db(req){return req.app.locals.db||req.app.locals.pool;}
function clean(v){return String(v==null?'':v).trim();}
function lim(v,d,max){const n=Number(v);return Number.isFinite(n)?Math.min(max,Math.max(1,Math.trunc(n))):d;}
router.get('/api/gm/builder/purchase-confirm/candidates',async(req,res)=>{
  const p=db(req);if(!p)return res.status(500).json({ok:false,error:'DB pool is not attached'});
  try{
    const limit=lim(req.query.limit,100,500);
    const q=await p.query(`SELECT order_no,member_id,total_product_price,total_delivery_fee,extra_area_delivery_fee,COALESCE(point_used_amount,0) AS point_used_amount,payment_status,shipping_status,seller_status,customer_status,delivered_at,ordered_at
      FROM gm_order
      WHERE (delivered_at IS NOT NULL OR UPPER(COALESCE(seller_status,''))='DELIVERED' OR UPPER(COALESCE(shipping_status,'')) IN ('DELIVERED','COMPLETE','COMPLETED'))
        AND COALESCE(purchase_confirmed_yn,'N')<>'Y' AND purchase_confirmed_at IS NULL
        AND UPPER(COALESCE(seller_status,'')) NOT IN ('CANCELLED','CANCELED')
        AND UPPER(COALESCE(customer_status,'')) NOT LIKE 'CANCEL_%'
      ORDER BY COALESCE(delivered_at,ordered_at) ASC NULLS LAST,order_no ASC LIMIT $1`,[limit]);
    const items=q.rows.map(o=>{const product=Number(o.total_product_price||0),used=Number(o.point_used_amount||0),paid=Math.max(0,product-used);return {...o,product_paid_amount:paid,reward_expected:point.rewardForPaidProduct(paid)};});
    res.json({ok:true,count:items.length,items,gpay_api:svc.gpayBase()});
  }catch(e){res.status(500).json({ok:false,error:String(e&&e.message||e)});}
});
router.post('/api/gm/builder/purchase-confirm/confirm',async(req,res)=>{
  const p=db(req);if(!p)return res.status(500).json({ok:false,error:'DB pool is not attached'});
  const list=Array.isArray(req.body&&req.body.order_nos)?req.body.order_nos.map(clean).filter(Boolean):[clean(req.body&&req.body.order_no)].filter(Boolean);
  if(!list.length)return res.status(400).json({ok:false,error:'order_no required'});
  const results=[];
  for(const orderNo of list){try{results.push(await svc.confirmOne(p,orderNo));}catch(e){results.push({ok:false,order_no:orderNo,error:String(e&&e.message||e)});}}
  res.json({ok:results.every(x=>x.ok),processed:results.filter(x=>x.ok).length,failed:results.filter(x=>!x.ok).length,results});
});
module.exports=router;
