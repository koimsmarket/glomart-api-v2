'use strict';
// GM_DETAIL_CONTENT_V002: Read-only fallback for HTTP 403.
const express=require('express');
const router=express.Router();
function db(req){return req.app.locals.db||req.app.locals.pool;}
router.get('/api/gm/product/detail-content',async(req,res)=>{
  const mall=String(req.query.mall_code||'').toUpperCase();
  const tbl=mall==='CPKR'?'gm_cpkr_detail_content':mall==='ALKR'?'gm_alkr_detail_content':null;
  const pid=String(req.query.product_id||'').trim();
  if(!tbl||!/^\d{5,30}$/.test(pid))return res.status(400).json({ok:false,error:'invalid mall_code or product_id'});
  const pool=db(req);
  if(!pool)return res.status(500).json({ok:false,error:'DB unavailable'});
  try{
    const r=await pool.query(`SELECT content_json,updated_at FROM ${tbl} WHERE product_id=$1`,[pid]);
    if(!r.rows.length)return res.json({ok:true,found:false,content_json:null});
    return res.json({ok:true,found:true,content_json:r.rows[0].content_json,updated_at:r.rows[0].updated_at});
  }catch(e){
    console.error('[GM_DETAIL_CONTENT_READ_ERROR]',{mall_code:mall,product_id:pid,error:String(e&&e.message||e)});
    return res.status(500).json({ok:false,error:'detail content read failed'});
  }
});
module.exports=router;
