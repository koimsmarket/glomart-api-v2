'use strict';
// GM_CATEGORY_V039_BUILDER_CATEGORY_UNIT_AUTO
// No CSV upload/master table. Analyze gm_category + gm_product for representative units. Options are used only by recalc.
const express=require('express');
const router=express.Router();
const {recalcCategory}=require('../../services/unit_price');
const {analyzeCategoryUnitRules,applyCategoryUnitRules}=require('../../services/category_unit_analyzer');
const db=req=>req.app.locals.db||req.app.locals.pool;

router.post('/api/gm/builder/category-unit/analyze',express.json({limit:'1mb'}),async(req,res)=>{try{
  const out=await analyzeCategoryUnitRules(db(req),{sampleLimit:Number(req.body&&req.body.sample_limit||200)});
  delete out.allItems;
  res.json({ok:true,mode:'ANALYZE',...out});
}catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}});

router.post('/api/gm/builder/category-unit/apply-auto',express.json({limit:'1mb'}),async(req,res)=>{try{
  const out=await applyCategoryUnitRules(db(req),{sampleLimit:Number(req.body&&req.body.sample_limit||200)});
  res.json({ok:true,mode:'APPLY_AUTO',...out});
}catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}});

router.post('/api/gm/builder/category-unit/recalc',express.json({limit:'1mb'}),async(req,res)=>{try{
  const b=req.body||{};
  const out=await recalcCategory(db(req),{gmCode:String(b.gm_code||'').trim(),all:!!b.all,apply:!!b.apply});
  res.json({ok:true,...out});
}catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}});

module.exports=router;
