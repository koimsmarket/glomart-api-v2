/* routes/order_history.js
 * GM_ORDER_HISTORY_ROUTE_V001
 * 주문 저장/처리 라우터와 분리된 조회 전용 API.
 */
'use strict';
const express=require('express');
const router=express.Router();
const service=require('../services/order_history_service');
function db(req){ return req.app.locals.db || req.app.locals.pool; }
router.get('/api/gm/order-history/list',async(req,res)=>{
  try{
    const result=await service.listOrders(db(req),req.query||{});
    res.json(Object.assign({ok:true,action:'order-history.list'},result));
  }catch(e){
    const status=Number(e&&e.statusCode)||500;
    console.error('[GM_ORDER_HISTORY_LIST_FAIL]',String(e&&e.message||e));
    res.status(status).json({ok:false,error:String(e&&e.message||e)});
  }
});
module.exports=router;
