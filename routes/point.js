'use strict';
// GM_POINT_ROUTE_V001
const router=require('express').Router();
const point=require('../services/member_point_service');
function clean(v){return String(v==null?'':v).trim();}
function lim(v,d,max){const n=Number(v);return Number.isFinite(n)?Math.min(max,Math.max(1,Math.trunc(n))):d;}
function db(req){return req.app.locals.db||req.app.locals.pool;}
router.use((req,res,next)=>{res.set('Cache-Control','no-store, no-cache, must-revalidate, private');res.set('Pragma','no-cache');next();});
router.get('/api/gm/point/summary',async(req,res)=>{try{const id=clean(req.query.member_id||req.query.cafe24_member_id||req.query.id);if(!id)return res.status(400).json({ok:false,error:'member_id required'});const p=db(req);if(!p)return res.status(500).json({ok:false,error:'DB pool is not attached'});res.json(await point.getSummary(p,id));}catch(e){res.status(500).json({ok:false,error:String(e&&e.message||e)});}});
router.get('/api/gm/point/transactions',async(req,res)=>{try{const id=clean(req.query.member_id||req.query.cafe24_member_id||req.query.id);if(!id)return res.status(400).json({ok:false,error:'member_id required'});const p=db(req);if(!p)return res.status(500).json({ok:false,error:'DB pool is not attached'});res.json(await point.getTransactions(p,id,lim(req.query.page,1,1000000),lim(req.query.limit,10,100)));}catch(e){res.status(500).json({ok:false,error:String(e&&e.message||e)});}});
router.post('/api/gm/order/point-payment/apply',async(req,res)=>{try{const p=db(req);if(!p)return res.status(500).json({ok:false,error:'DB pool is not attached'});res.json(await point.applyOrderPoint(p,req.body||{}));}catch(e){const m=String(e&&e.message||e);res.status(/required|mismatch|not_delivered|cancelled/.test(m)?400:/not_found/.test(m)?404:500).json({ok:false,error:m});}});
module.exports=router;
