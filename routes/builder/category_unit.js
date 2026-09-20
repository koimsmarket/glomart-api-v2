'use strict';
// GM_AI_CATEGORY_CONNECT_V013 + GM_CATEGORY_V039_BUILDER_CATEGORY_UNIT_AUTO
// No CSV upload/master table. Analyze gm_category + gm_product for representative units. Options are used only by recalc.
const express=require('express');
const router=express.Router();
const {recalcCategory}=require('../../services/unit_price');
const {analyzeCategoryUnitRules,applyCategoryUnitRules}=require('../../services/category_unit_analyzer');
const OpenAIClient=require('../../services/openai_client');
const AiGuard=require('../../services/ai_guard');
const CategoryAiClassifier=require('../../services/category_ai_classifier');
const {normalizeProductKeywords}=require('../../services/product_keyword_normalizer');
const db=req=>req.app.locals.db||req.app.locals.pool;

const S=v=>String(v==null?'':v).trim();
const normalizeKeyword=v=>S(v).normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
async function attachAiStatus(pool,out){
  const items=Array.isArray(out&&out.reviewItems)?out.reviewItems:[];
  if(!items.length)return out;
  const keys=[...new Set(items.map(x=>normalizeKeyword(x.category_keyword)).filter(Boolean))];
  if(!keys.length)return out;
  try{
    const r=await pool.query(`SELECT DISTINCT ON (keyword_normalized)
      id,category_keyword,keyword_normalized,context_hash,ai_target_gm_code,final_gm_code,parent_gm_code,
      selection_type,ai_confidence,ai_reason,ai_model,total_tokens,status,classified_at,updated_at
      FROM gm_category_keyword_map
      WHERE is_current='Y' AND keyword_normalized = ANY($1::text[])
      ORDER BY keyword_normalized,updated_at DESC,id DESC`,[keys]);
    const map=new Map((r.rows||[]).map(x=>[S(x.keyword_normalized),x]));
    for(const item of items){item.ai_map=map.get(normalizeKeyword(item.category_keyword))||null;}
  }catch(e){
    console.warn('[GM_AI_CATEGORY_CONNECT_V011 AI_STATUS_ATTACH_FAIL]',String(e&&e.message||e));
  }
  return out;
}
function csvCell(v){
  if(v==null)return '';
  const s=typeof v==='object'?JSON.stringify(v):String(v);
  return /[",\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}





router.get('/api/gm/builder/category-unit/ai-guard-settings',async(req,res)=>{try{
  const out=await AiGuard.status(db(req));
  res.json({ok:true,...out});
}catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}});

router.post('/api/gm/builder/category-unit/ai-guard-settings',express.json({limit:'32kb'}),async(req,res)=>{try{
  const saved=await AiGuard.saveSettings(db(req),req.body||{});
  const out=await AiGuard.status(db(req));
  res.json({ok:true,settings:saved,month:out.month,state:out.state});
}catch(e){res.status(400).json({ok:false,error:String(e.message||e)});}});

// GM_AI_CATEGORY_CONNECT_V001: status exposes no secret; test is one explicit tiny request only.
router.get('/api/gm/builder/category-unit/ai-status',async(req,res)=>{try{
  const c=OpenAIClient.config();
  res.json({ok:true,configured:c.configured,model:c.model,review_model:c.reviewModel,timeout_ms:c.timeoutMs});
}catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}});

async function aiConnectionTestHandler(req,res){
  const started=Date.now();
  console.log('[GM_AI_CATEGORY_CONNECT_V004 AI_TEST_HIT]',JSON.stringify({method:req.method,path:req.path,model:OpenAIClient.config().model}));
  try{
    const cfg=OpenAIClient.config();
    const gate=await AiGuard.preflight(db(req),{model:cfg.model,max_output_tokens:32,dedup_key:''});
    const out=await OpenAIClient.callOpenAI({input:'Glomart Builder API connection test. Reply with exactly: GLOMART_AI_OK',model:cfg.model,maxOutputTokens:Math.min(32,gate.max_output_tokens),reasoningEffort:'none'});
    out.ok=/GLOMART_AI_OK/i.test(out.text||'');
    let usage_recorded=false,usage_error='',estimated_cost=0;
    try{
      const costInfo=await AiGuard.postSuccess(db(req),{model:out.model,usage:out.usage||{}});
      estimated_cost=Number(costInfo.estimated_cost||0);
      const {recordUsage}=require('../../services/ai_usage');
      const u=out.usage||{};
      await recordUsage(db(req),{
        service_group:'CATEGORY',task_type:'CATEGORY_CLASSIFICATION',task_name_ko:'카테고리 분류 작업',
        provider:'OPENAI',model_name:out.model,
        prompt_tokens:u.input_tokens,completion_tokens:u.output_tokens,total_tokens:u.total_tokens,
        estimated_cost,currency:'USD'
      });
      usage_recorded=true;
    }catch(ue){usage_error=String(ue.message||ue);}
    console.log('[GM_AI_CATEGORY_CONNECT_V004 AI_TEST_OK]',JSON.stringify({model:out.model,ok:!!out.ok,ms:Date.now()-started,usage:out.usage||{}}));
    return res.json({ok:!!out.ok,configured:true,model:out.model,response:out.text,usage:out.usage,estimated_cost,usage_recorded,usage_error:usage_recorded?'':usage_error});
  }catch(e){
    const msg=String(e&&e.message||e);
    const code=String(e&&e.code||'');
    const status=msg==='OPENAI_API_KEY_NOT_CONFIGURED'?400:(code.startsWith('AI_')?429:502);
    console.error('[GM_AI_CATEGORY_CONNECT_V004 AI_TEST_FAIL]',JSON.stringify({status,error:msg,ms:Date.now()-started}));
    return res.status(status).json({ok:false,error:msg});
  }
}
// GET is used by Builder because status GET is already confirmed through the Cloudtype path.
// POST remains for compatibility/manual testing.
router.get('/api/gm/builder/category-unit/ai-test',aiConnectionTestHandler);
router.post('/api/gm/builder/category-unit/ai-test',express.json({limit:'16kb'}),aiConnectionTestHandler);


router.post('/api/gm/builder/category-unit/ai-classify-selected',express.json({limit:'64kb'}),async(req,res)=>{try{
  const keywords=[...new Set((Array.isArray(req.body&&req.body.keywords)?req.body.keywords:[]).map(x=>String(x||'').trim()).filter(Boolean))];
  if(!keywords.length)return res.status(400).json({ok:false,error:'선택된 키워드가 없습니다.'});
  const analyzed=await analyzeCategoryUnitRules(db(req),{sampleLimit:2000,includeItems:false});
  const map=new Map((analyzed.reviewItems||[]).map(x=>[String(x.category_keyword||'').trim(),x]));
  const missing=keywords.filter(k=>!map.has(k));
  if(missing.length)return res.status(400).json({ok:false,error:'현재 자동분석 예외목록에서 찾을 수 없는 키워드: '+missing.join(', ')});
  const items=keywords.map(k=>map.get(k));
  const out=await CategoryAiClassifier.classifySelected(db(req),items);
  res.json({ok:true,...out});
}catch(e){
  const code=String(e&&e.code||'');
  const status=code.startsWith('AI_')?429:500;
  console.error('[GM_AI_CATEGORY_CONNECT_V008 CLASSIFY_FAIL]',JSON.stringify({error:String(e.message||e),code}));
  res.status(status).json({ok:false,error:String(e.message||e),code});
}});


router.get('/api/gm/builder/category-unit/ai-results.csv',async(req,res)=>{try{
  const r=await db(req).query(`SELECT id,mall_code,category_keyword,keyword_normalized,status,selection_type,
    ai_target_gm_code,final_gm_code,parent_gm_code,ai_confidence,ai_reason,ai_model,
    candidate_round,prompt_tokens,completion_tokens,total_tokens,classified_at,updated_at,
    sample_products,candidate_json,context_hash
    FROM gm_category_keyword_map WHERE is_current='Y' ORDER BY updated_at DESC,id DESC`);
  const cols=['id','mall_code','category_keyword','keyword_normalized','status','selection_type','ai_target_gm_code','final_gm_code','parent_gm_code','ai_confidence','ai_reason','ai_model','candidate_round','prompt_tokens','completion_tokens','total_tokens','classified_at','updated_at','sample_products','candidate_json','context_hash'];
  const lines=[cols.join(',')];
  for(const row of (r.rows||[]))lines.push(cols.map(c=>csvCell(row[c])).join(','));
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="gm_category_ai_results.csv"');
  res.send('\ufeff'+lines.join('\r\n'));
}catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}});

router.post('/api/gm/builder/category-unit/analyze',express.json({limit:'1mb'}),async(req,res)=>{try{
  // V013: legacy multilingual product keywords are normalized to Korean first.
  // Search logs are never updated here; only gm_product.keyword/category_keyword are cleaned.
  const normalization=await normalizeProductKeywords(db(req),{apply:true});
  const out=await analyzeCategoryUnitRules(db(req),{sampleLimit:Number(req.body&&req.body.sample_limit||200)});
  // Rebuild only unresolved AI request rows. Already decided/reviewed rows are preserved.
  const aiPendingClear=await CategoryAiClassifier.clearPending(db(req));
  const aiPendingItems=(Array.isArray(out&&out.reviewItems)?out.reviewItems:[]).filter(x=>String(x&&x.status||'').trim().toUpperCase()==='NO_CATEGORY');
  const aiPendingSync=await CategoryAiClassifier.registerPending(db(req),aiPendingItems);
  await attachAiStatus(db(req),out);
  delete out.allItems;
  res.json({ok:true,mode:'ANALYZE',keyword_normalization:normalization,ai_pending_clear:aiPendingClear,ai_pending_sync:aiPendingSync,...out});
}catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}});

router.post('/api/gm/builder/category-unit/apply-auto',express.json({limit:'1mb'}),async(req,res)=>{try{
  const out=await applyCategoryUnitRules(db(req),{sampleLimit:Number(req.body&&req.body.sample_limit||200)});
  await attachAiStatus(db(req),out);
  res.json({ok:true,mode:'APPLY_AUTO',...out});
}catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}});

router.post('/api/gm/builder/category-unit/recalc',express.json({limit:'1mb'}),async(req,res)=>{try{
  const b=req.body||{};
  const out=await recalcCategory(db(req),{gmCode:String(b.gm_code||'').trim(),all:!!b.all,apply:!!b.apply});
  res.json({ok:true,...out});
}catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}});

module.exports=router;
