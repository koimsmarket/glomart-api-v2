'use strict';

const express = require('express');
const router = express.Router();
const clients = require('../services/client_registry');
const queue = require('../services/auto_order_queue');

const VERSION = 'GM_AUTO_ORDER_RUNTIME_API_V001';

function pool(req){
  return req.app.locals.pool || req.app.locals.db;
}
function ok(res,data){ return res.json({ok:true,version:VERSION,...data}); }
function fail(res,status,error,e){
  return res.status(status).json({
    ok:false,version:VERSION,error,
    detail:e ? String(e && e.message || e) : undefined
  });
}

router.post('/api/auto-order/clients/register', async (req,res)=>{
  try{
    const item = await clients.register(pool(req), {
      ...(req.body||{}),
      user_agent:req.headers['user-agent']||''
    });
    return ok(res,{item});
  }catch(e){ return fail(res,400,'client register failed',e); }
});

router.post('/api/auto-order/clients/heartbeat', async (req,res)=>{
  try{
    const item = await clients.heartbeat(pool(req),req.body||{});
    return ok(res,{item});
  }catch(e){ return fail(res,400,'client heartbeat failed',e); }
});

router.get('/api/auto-order/clients', async (req,res)=>{
  try{ return ok(res,{items:await clients.list(pool(req))}); }
  catch(e){ return fail(res,500,'client list failed',e); }
});

router.post('/api/auto-order/jobs/create-for-order', async (req,res)=>{
  try{
    const orderNo = req.body && (req.body.order_no || req.body.orderNo);
    const data = await queue.createPendingForOrder(pool(req),orderNo,{source:'manual-api'});
    return ok(res,data);
  }catch(e){ return fail(res,400,'job create failed',e); }
});

router.post('/api/auto-order/jobs/claim', async (req,res)=>{
  try{
    const data = await queue.claim(pool(req),req.body||{});
    return ok(res,data);
  }catch(e){ return fail(res,409,'job claim failed',e); }
});

router.post('/api/auto-order/jobs/:job_id/heartbeat', async (req,res)=>{
  try{
    const b=req.body||{};
    const item=await queue.heartbeat(
      pool(req),req.params.job_id,
      b.client_id||b.clientId,
      b.lock_token||b.lockToken
    );
    return ok(res,{item});
  }catch(e){ return fail(res,409,'job heartbeat failed',e); }
});

router.post('/api/auto-order/jobs/:job_id/state', async (req,res)=>{
  try{
    const b=req.body||{};
    const item=await queue.updateState(
      pool(req),req.params.job_id,
      b.client_id||b.clientId,
      b.lock_token||b.lockToken,
      b.status,
      b.detail||b.result||{}
    );
    return ok(res,{item});
  }catch(e){ return fail(res,409,'job state update failed',e); }
});

router.get('/api/auto-order/jobs', async (req,res)=>{
  try{ return ok(res,{items:await queue.list(pool(req),req.query||{})}); }
  catch(e){ return fail(res,500,'job list failed',e); }
});

router.get('/api/auto-order/jobs/:job_id', async (req,res)=>{
  try{
    const item=await queue.get(pool(req),req.params.job_id);
    if(!item) return fail(res,404,'job not found');
    return ok(res,{item});
  }catch(e){ return fail(res,500,'job get failed',e); }
});

module.exports = router;
