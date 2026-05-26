const express = require('express');
const router = express.Router();
function db(req){ return req.app.locals.db || req.app.locals.pool; }
function s(v,d=null){ return v===undefined||v===null||v==='' ? d : String(v).trim(); }
function n(v,d=null){ if(v===undefined||v===null||v==='') return d; const x=Number(String(v).replace(/,/g,'')); return Number.isFinite(x)?x:d; }
router.post('/api/cart/add', async (req,res)=>{
  const pool=db(req), b=req.body||{};
  if(!pool) return res.status(500).json({ok:false,error:'DB pool is not attached'});
  if(!b.pi_ii_vi) return res.status(400).json({ok:false,error:'pi_ii_vi is required'});
  const sql=`INSERT INTO gm_cart (member_id,guest_key,pi_ii_vi,product_name,option_name,option_value,quantity,amount,amount_type,delivery_type,delivery_fee,created_at,updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW()) RETURNING *`;
  const p=[s(b.member_id),s(b.guest_key),s(b.pi_ii_vi),s(b.product_name,''),s(b.option_name),s(b.option_value),n(b.quantity,1),n(b.amount??b.price,0),s(b.amount_type,'unit'),s(b.delivery_type),n(b.delivery_fee)];
  try{ const r=await pool.query(sql,p); res.json({ok:true,cart:r.rows[0]}); }
  catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
router.get('/api/cart', async (req,res)=>{
  const pool=db(req), key=s(req.query.member_id)||s(req.query.guest_key);
  if(!pool) return res.status(500).json({ok:false,error:'DB pool is not attached'});
  if(!key) return res.status(400).json({ok:false,error:'member_id or guest_key is required'});
  const col=s(req.query.member_id)?'member_id':'guest_key';
  try{ const r=await pool.query(`SELECT * FROM gm_cart WHERE ${col}=$1 ORDER BY created_at DESC`,[key]); res.json({ok:true,items:r.rows}); }
  catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
module.exports=router;
