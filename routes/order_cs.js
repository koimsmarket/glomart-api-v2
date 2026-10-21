/* routes/order_cs.js | GM_ORDER_CS_ROUTE_V001 */
'use strict';
const express=require('express');const router=express.Router();const service=require('../services/order_cs_service');const VERSION='GM_ORDER_CS_ROUTE_V001';
function db(req){return req.app.locals.db||req.app.locals.pool;}
router.post('/api/gm/order-cs/action',async(req,res)=>{try{const result=await service.action(db(req),req.body||{});console.log('[GM_ORDER_CS_OK]',JSON.stringify({order_no:req.body&&req.body.order_no,action:req.body&&req.body.action,cafe24_handoff:!!result.cafe24_handoff}));return res.json({ok:true,version:VERSION,...result});}catch(error){const msg=String(error&&error.message||error);console.error('[GM_ORDER_CS_FAIL]',msg);return res.status(['member_id_required','order_no_required','action_required','action_not_allowed'].includes(msg)?400:500).json({ok:false,version:VERSION,error:msg});}});
console.log('['+VERSION+'] routes/order_cs registered');module.exports=router;
