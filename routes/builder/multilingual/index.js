'use strict';
const express=require('express'),router=express.Router();
const {dbFrom}=require('../core');
const flow=require('../../../services/multilingual/finalize');
router.get('/api/gm/builder/multilingual/status',(req,res)=>{res.set('Cache-Control','no-store');res.json({ok:true,...flow.status()});});
router.post('/api/gm/builder/multilingual/finalize',express.json({limit:'4kb'}),async(req,res)=>{
 if(req.get('X-GM-Builder-Reauth')==='verified')return res.status(403).json({ok:false,error:'INTERNAL_HEADER_NOT_AUTHORITY'});
 // Authentication is performed by admin_reauth middleware; it adds the response header, not request header.
 if(res.getHeader('X-GM-Builder-Reauth')!=='verified')return res.status(401).json({ok:false,error:'ADMIN_REAUTH_REQUIRED'});
 const origin=String(req.get('origin')||'');if(origin){try{if(new URL(origin).host!==req.get('host'))return res.status(403).json({ok:false,error:'ORIGIN_MISMATCH'});}catch(_){return res.status(403).json({ok:false,error:'ORIGIN_INVALID'});}}
 try{const r=await flow.launch(dbFrom(req));res.status(r.ok?202:409).json(r);}catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}
});
// V006: explicit administrator application-close signal. Not an idle/visibility timer.
// Global admin session gate protects /api/gm/builder/* before this router.
router.post('/api/gm/builder/multilingual/app-closed', async (req,res)=>{
 res.set('Cache-Control','no-store');
 const origin=String(req.get('origin')||'');
 // Requiring Origin prevents cross-site form posts; do not trust a client ID.
 try{const host=String(req.get('host')||'');const u=new URL(origin);if(!host||u.host!==host||u.protocol!=='https:')return res.status(403).json({ok:false,error:'ORIGIN_REJECTED'});}catch(_){return res.status(403).json({ok:false,error:'ORIGIN_REQUIRED'});}
 try{
  const db=dbFrom(req);
  const gate=require('../../../services/multilingual/close_gate');
  const result=await gate.onClosed(db);
  return res.status(result.started?202:200).json(result);
 }catch(e){return res.status(503).json({ok:false,error:String(e&&e.message||e)});}
});
module.exports=router;
