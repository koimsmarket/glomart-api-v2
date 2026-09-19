'use strict';
// GM_CATEGORY_V036_BUILDER_UNIT_RULE
const express=require('express');
const router=express.Router();
const {recalcCategory,normUnit}=require('../../services/unit_price');
const db=req=>req.app.locals.db||req.app.locals.pool;
router.get('/api/gm/builder/category-unit/list',async(req,res)=>{try{
  const q=String(req.query.q||'').trim(),p=[];let w="COALESCE(unit_rule_qty,0)>0 OR COALESCE(unit_rule_unit,'')<>''";
  if(q){p.push('%'+q+'%');w=`(gm_code ILIKE $1 OR name_ko ILIKE $1 OR keyword ILIKE $1)`;}
  const r=await db(req).query(`SELECT gm_code,name_ko,keyword,unit_rule_qty,unit_rule_unit FROM gm_category WHERE ${w} ORDER BY depth,sort_order,gm_code LIMIT 1000`,p);
  res.json({ok:true,count:r.rowCount,items:r.rows});
}catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}});
router.post('/api/gm/builder/category-unit/save',express.json({limit:'1mb'}),async(req,res)=>{try{
  const b=req.body||{},code=String(b.gm_code||'').trim(),qty=Number(b.unit_rule_qty),unit=normUnit(b.unit_rule_unit||'');
  if(!code||!Number.isFinite(qty)||qty<=0||!unit)return res.status(400).json({ok:false,error:'gm_code/unit_rule_qty/unit_rule_unit required'});
  const r=await db(req).query(`UPDATE gm_category SET unit_rule_qty=$2,unit_rule_unit=$3,updated_at=NOW() WHERE gm_code=$1 RETURNING gm_code,name_ko,keyword,unit_rule_qty,unit_rule_unit`,[code,qty,unit]);
  res.json({ok:true,item:r.rows[0]||null});
}catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}});
router.post('/api/gm/builder/category-unit/recalc',express.json({limit:'1mb'}),async(req,res)=>{try{
  const b=req.body||{}; const out=await recalcCategory(db(req),{gmCode:String(b.gm_code||'').trim(),all:!!b.all,apply:!!b.apply}); res.json({ok:true,...out});
}catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}});
module.exports=router;
