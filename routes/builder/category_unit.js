'use strict';
// GM_AI_CATEGORY_CONNECT_V003 + GM_CATEGORY_V039_BUILDER_CATEGORY_UNIT_AUTO
// No CSV upload/master table. Analyze gm_category + gm_product for representative units. Options are used only by recalc.
const express=require('express');
const router=express.Router();
const {recalcCategory}=require('../../services/unit_price');
const {analyzeCategoryUnitRules,applyCategoryUnitRules}=require('../../services/category_unit_analyzer');
const OpenAIClient=require('../../services/openai_client');
const db=req=>req.app.locals.db||req.app.locals.pool;



// GM_AI_CATEGORY_CONNECT_V001: status exposes no secret; test is one explicit tiny request only.
router.get('/api/gm/builder/category-unit/ai-status',async(req,res)=>{try{
  const c=OpenAIClient.config();
  res.json({ok:true,configured:c.configured,model:c.model,review_model:c.reviewModel,timeout_ms:c.timeoutMs});
}catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}});

async function aiConnectionTestHandler(req,res){
  const started=Date.now();
  console.log('[GM_AI_CATEGORY_CONNECT_V003 AI_TEST_HIT]',JSON.stringify({method:req.method,path:req.path,model:OpenAIClient.config().model}));
  try{
    const out=await OpenAIClient.connectionTest();
    let usage_recorded=false,usage_error='';
    try{
      const {recordUsage}=require('../../services/ai_usage');
      const u=out.usage||{};
      await recordUsage(db(req),{
        service_group:'CATEGORY',task_type:'CATEGORY_CLASSIFICATION',task_name_ko:'카테고리 분류 작업',
        provider:'OPENAI',model_name:out.model,
        prompt_tokens:u.input_tokens,completion_tokens:u.output_tokens,total_tokens:u.total_tokens,
        estimated_cost:0,currency:'USD'
      });
      usage_recorded=true;
    }catch(ue){usage_error=String(ue.message||ue);}
    console.log('[GM_AI_CATEGORY_CONNECT_V003 AI_TEST_OK]',JSON.stringify({model:out.model,ok:!!out.ok,ms:Date.now()-started,usage:out.usage||{}}));
    return res.json({ok:!!out.ok,configured:true,model:out.model,response:out.text,usage:out.usage,usage_recorded,usage_error:usage_recorded?'':usage_error});
  }catch(e){
    const msg=String(e&&e.message||e);
    const status=msg==='OPENAI_API_KEY_NOT_CONFIGURED'?400:502;
    console.error('[GM_AI_CATEGORY_CONNECT_V003 AI_TEST_FAIL]',JSON.stringify({status,error:msg,ms:Date.now()-started}));
    return res.status(status).json({ok:false,error:msg});
  }
}
// GET is used by Builder because status GET is already confirmed through the Cloudtype path.
// POST remains for compatibility/manual testing.
router.get('/api/gm/builder/category-unit/ai-test',aiConnectionTestHandler);
router.post('/api/gm/builder/category-unit/ai-test',express.json({limit:'16kb'}),aiConnectionTestHandler);

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
