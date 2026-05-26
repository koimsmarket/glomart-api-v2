const express = require('express');
const router = express.Router();
function db(req){ return req.app.locals.db || req.app.locals.pool; }
function s(v,d=null){ return v===undefined||v===null||v==='' ? d : String(v).trim(); }
function csno(){ const d=new Date(); const p=x=>String(x).padStart(2,'0'); return `CS${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; }
router.post('/api/cs/create', async (req,res)=>{
  const pool=db(req), b=req.body||{}; if(!pool) return res.status(500).json({ok:false,error:'DB pool is not attached'});
  if(!b.order_no) return res.status(400).json({ok:false,error:'order_no is required'});
  const sql=`INSERT INTO gm_cs (cs_no,request_at,order_no,pi_ii_vi,cs_type,cs_status,message_summary,return_at,return_carrier,return_invoice_no,return_received_at,return_confirm_yn,reship_at,reship_carrier,reship_invoice_no,reship_received_at,created_at,updated_at)
    VALUES ($1,COALESCE($2,NOW()),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW()) RETURNING *`;
  const p=[s(b.cs_no,csno()),b.request_at||null,s(b.order_no),s(b.pi_ii_vi),s(b.cs_type,'cs'),s(b.cs_status,'requested'),s(b.message_summary),b.return_at||null,s(b.return_carrier),s(b.return_invoice_no),b.return_received_at||null,s(b.return_confirm_yn,'N'),b.reship_at||null,s(b.reship_carrier),s(b.reship_invoice_no),b.reship_received_at||null];
  try{ const r=await pool.query(sql,p); await pool.query(`UPDATE gm_order SET cs_status='open', updated_at=NOW() WHERE order_no=$1`,[s(b.order_no)]); res.json({ok:true,cs:r.rows[0]}); }
  catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
router.post('/api/cs/message', async (req,res)=>{
  const pool=db(req), b=req.body||{}; if(!pool) return res.status(500).json({ok:false,error:'DB pool is not attached'});
  if(!b.cs_no||!b.order_no) return res.status(400).json({ok:false,error:'cs_no and order_no are required'});
  try{ const r=await pool.query(`INSERT INTO gm_cs_message (cs_no,order_no,sender_type,message_type,message_text,file_url,file_name,read_yn,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING *`,[s(b.cs_no),s(b.order_no),s(b.sender_type,'customer'),s(b.message_type,'text'),s(b.message_text),s(b.file_url),s(b.file_name),s(b.read_yn,'N')]); res.json({ok:true,message:r.rows[0]}); }
  catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
router.get('/api/cs/:cs_no', async (req,res)=>{
  const pool=db(req); if(!pool) return res.status(500).json({ok:false,error:'DB pool is not attached'});
  try{ const c=await pool.query('SELECT * FROM gm_cs WHERE cs_no=$1',[req.params.cs_no]); const m=await pool.query('SELECT * FROM gm_cs_message WHERE cs_no=$1 ORDER BY created_at ASC',[req.params.cs_no]); res.json({ok:true,cs:c.rows[0]||null,messages:m.rows}); }
  catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
module.exports=router;
