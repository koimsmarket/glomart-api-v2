'use strict';
// GM_AI_CATEGORY_CONNECT_V013 + GM_CATEGORY_V039_COUNT_AMBIGUOUS_GUARD
// No CSV upload/master table. Analyze gm_category + gm_product for representative units. Options are used only by recalc.
const express=require('express');
const crypto=require('crypto');
const router=express.Router();
const {recalcCategory,recalcMissingCountBatch,cleanupAmbiguousCountFallback}=require('../../services/unit_price');
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


// GM_BUILDER_V028: admin manual category repair for the very small set of true unknown gm_codes.
// Search only existing gm_category rows; never creates a new category.
router.get('/api/gm/builder/category-unit/category-search',async(req,res)=>{try{
  const q=S(req.query&&req.query.q);
  if(!q)return res.json({ok:true,items:[]});
  const like='%'+q.replace(/[\\%_]/g,m=>'\\'+m)+'%';
  const r=await db(req).query(`SELECT gm_code,name_ko,keyword,gm_parent_code,parent_name_ko,depth,leaf_yn,unit_rule_qty,unit_rule_unit
    FROM gm_category
    WHERE gm_code ILIKE $1 ESCAPE '\\' OR COALESCE(name_ko,'') ILIKE $1 ESCAPE '\\' OR COALESCE(keyword,'') ILIKE $1 ESCAPE '\\'
    ORDER BY CASE WHEN COALESCE(name_ko,'')=$2 OR COALESCE(keyword,'')=$2 THEN 0 WHEN COALESCE(name_ko,'') ILIKE $3 OR COALESCE(keyword,'') ILIKE $3 THEN 1 ELSE 2 END,
      depth DESC,sort_order,gm_code
    LIMIT 30`,[like,q,q+'%']);
  res.json({ok:true,items:r.rows||[]});
}catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}});

router.post('/api/gm/builder/category-unit/manual-map',express.json({limit:'32kb'}),async(req,res)=>{try{
  const oldCode=S(req.body&&req.body.old_gm_code);
  const newCode=S(req.body&&req.body.new_gm_code);
  const keyword=S(req.body&&req.body.category_keyword);
  if(!oldCode||!newCode||!keyword)return res.status(400).json({ok:false,error:'old_gm_code, new_gm_code, category_keyword가 필요합니다.'});
  const target=await db(req).query(`SELECT gm_code,name_ko,keyword,depth,leaf_yn,unit_rule_qty,unit_rule_unit FROM gm_category WHERE gm_code=$1 LIMIT 1`,[newCode]);
  if(!target.rowCount)return res.status(404).json({ok:false,error:'선택한 gm_category를 찾을 수 없습니다: '+newCode});
  const t=target.rows[0];
  const addKeyword=S(t.keyword||t.name_ko||'');
  if(!addKeyword)return res.status(400).json({ok:false,error:'선택 카테고리에 추가할 keyword/name_ko가 없습니다.'});

  // Preserve the original classification. Add the selected valid gm_code and keyword as extra tokens.
  // Only products whose CURRENT FIRST token is the unresolved oldCode are touched.
  const upd=await db(req).query(`UPDATE gm_product p SET
      glomart_code = CASE
        WHEN $2 = ANY(string_to_array(COALESCE(p.glomart_code,''),'|')) THEN p.glomart_code
        WHEN COALESCE(NULLIF(trim(p.glomart_code),''),'')='' THEN $2
        ELSE trim(BOTH '|' FROM p.glomart_code)||'|'||$2 END,
      category_keyword = CASE
        WHEN $3 = ANY(string_to_array(COALESCE(p.category_keyword,''),'|')) THEN p.category_keyword
        WHEN COALESCE(NULLIF(trim(p.category_keyword),''),'')='' THEN $3
        ELSE trim(BOTH '|' FROM p.category_keyword)||'|'||$3 END,
      updated_at=NOW()
    WHERE split_part(COALESCE(p.glomart_code,''),'|',1)=$1
    RETURNING product_uid`,[oldCode,newCode,addKeyword]);

  // Keep an audit row only. This is not used as a unit-price fallback.
  const keywordNormalized=normalizeKeyword(keyword);
  const contextHash=crypto.createHash('sha256').update('ADMIN_CATEGORY_AUGMENT:'+keywordNormalized+':'+newCode).digest('hex');
  const note=`기존 분류 보존 + gm_code/keyword 추가. old=${oldCode}, add=${newCode}, keyword=${addKeyword}, products=${upd.rowCount}`;
  let mapping=null;
  try{
    const q=await db(req).query(`INSERT INTO gm_category_keyword_map (
        mall_code,category_keyword,keyword_normalized,context_hash,final_gm_code,selection_type,classification_source,status,is_current,reviewed_by,review_note,reviewed_at,updated_at
      ) VALUES ('CPKR',$1,$2,$3,$4,'CATEGORY_AUGMENT','ADMIN','ADMIN_CATEGORY_AUGMENTED','Y','BUILDER',$5,now(),now())
      ON CONFLICT (mall_code,keyword_normalized,context_hash) WHERE is_current='Y'
      DO UPDATE SET final_gm_code=EXCLUDED.final_gm_code,selection_type='CATEGORY_AUGMENT',classification_source='ADMIN',status='ADMIN_CATEGORY_AUGMENTED',reviewed_by='BUILDER',review_note=EXCLUDED.review_note,reviewed_at=now(),updated_at=now()
      RETURNING id,category_keyword,final_gm_code,status,updated_at`,[keyword,keywordNormalized,contextHash,newCode,note]);
    mapping=q.rows[0]||null;
  }catch(e){console.warn('[GM_BUILDER_V031 CATEGORY_AUGMENT_AUDIT_FAIL]',String(e&&e.message||e));}

  res.json({ok:true,old_gm_code:oldCode,added_gm_code:newCode,added_keyword:addKeyword,updated_products:upd.rowCount,product_data_changed:true,target:t,mapping});
}catch(e){res.status(400).json({ok:false,error:String(e.message||e)});}});

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

router.post('/api/gm/builder/category-unit/cleanup-ambiguous-count',express.json({limit:'1mb'}),async(req,res)=>{try{
  const out=await cleanupAmbiguousCountFallback(db(req),{apply:req.body?.apply!==false});
  res.json({ok:true,...out});
}catch(e){res.status(500).json({ok:false,error:String(e&&e.message||e)});}});

router.post('/api/gm/builder/category-unit/recalc-missing-count',express.json({limit:'1mb'}),async(req,res)=>{try{
  const b=req.body||{};
  const out=await recalcMissingCountBatch(db(req),{
    afterUid:String(b.after_uid||'').trim(),
    maxProducts:Number(b.max_products||100),
    apply:b.apply!==false
  });
  res.json({ok:true,...out});
}catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}});

router.post('/api/gm/builder/category-unit/recalc',express.json({limit:'1mb'}),async(req,res)=>{try{
  const b=req.body||{};
  const out=await recalcCategory(db(req),{
    gmCode:String(b.gm_code||'').trim(),
    all:!!b.all,
    apply:!!b.apply,
    afterUid:String(b.after_uid||'').trim(),
    maxProducts:Number(b.max_products||0)
  });
  res.json({ok:true,...out});
}catch(e){res.status(500).json({ok:false,error:String(e.message||e)});}});

module.exports=router;
