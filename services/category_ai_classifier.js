'use strict';
// GM_AI_CATEGORY_CONNECT_V012
// Builder-stage AI category classification + persistent decision cache.
// Stage 1 only: classify and save decision in gm_category_keyword_map.
// Does NOT create categories or update gm_product yet.

const OpenAIClient=require('./openai_client');
const AiGuard=require('./ai_guard');
const {recordUsage}=require('./ai_usage');
const crypto=require('crypto');

const S=v=>String(v==null?'':v).trim();
function parseJsonText(s){
  const raw=S(s).replace(/^```(?:json)?\\s*/i,'').replace(/```\\s*$/,'').trim();
  try{return JSON.parse(raw);}catch(_){}
  const a=raw.indexOf('{'),b=raw.lastIndexOf('}');
  if(a>=0&&b>a){try{return JSON.parse(raw.slice(a,b+1));}catch(_){} }
  throw new Error('AI_CLASSIFY_JSON_PARSE_FAILED:'+raw.slice(0,180));
}
function clip(s,n=180){s=S(s);return s.length>n?s.slice(0,n)+'…':s;}

function normalizeKeyword(v){return S(v).normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();}
function normalizeContextText(v){return S(v).normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();}
function makeContextHash(item){
  const keyword=normalizeKeyword(item&&item.category_keyword);
  const examples=(Array.isArray(item&&item.examples)?item.examples:[]).map(normalizeContextText).filter(Boolean).sort().slice(0,12);
  const candidates=(Array.isArray(item&&item.candidate_gm_codes)?item.candidate_gm_codes:[]).map(S).filter(Boolean).sort().slice(0,30);
  return crypto.createHash('sha256').update(JSON.stringify({keyword,examples,candidates})).digest('hex');
}
async function saveDecision(db,item,result){
  const keyword=S(item&&item.category_keyword);
  const keywordNormalized=normalizeKeyword(keyword);
  const contextHash=makeContextHash(item);
  const samples=Array.isArray(item&&item.examples)?item.examples.slice(0,20):[];
  const candidateJson={
    gm_codes:Array.isArray(item&&item.candidate_gm_codes)?item.candidate_gm_codes:[],
    names:Array.isArray(item&&item.candidate_names)?item.candidate_names:[],
    steps:Array.isArray(result&&result.steps)?result.steps:[]
  };
  const target=S(result&&result.ai_target_gm_code);
  const isLeaf=!!(result&&result.ai_target_leaf_yn==='Y');
  const selectionType=!result||!result.ok?'REVIEW_REQUIRED':(isLeaf?'EXISTING_LEAF':'EXISTING_PARENT');
  const status=!result||!result.ok?'AI_REVIEW_REQUIRED':(isLeaf?'AI_EXISTING_LEAF_DECIDED':'AI_PARENT_MATCH_PENDING');
  const finalCode=isLeaf?target:'';
  const parentCode=isLeaf?'':target;
  const usage=result&&result.usage||{};
  const vals=[
    'CPKR',keyword,keywordNormalized,contextHash,JSON.stringify(samples),JSON.stringify(candidateJson),
    Number((result&&result.steps&&result.steps.length)||0),target||null,finalCode||null,parentCode||null,
    selectionType,Number(result&&result.ai_confidence||0),S(result&&result.ai_reason)||null,S(result&&result.ai_model)||null,
    Number(usage.input_tokens||0),Number(usage.output_tokens||0),Number(usage.total_tokens||0),status
  ];
  const q=await db.query(`INSERT INTO gm_category_keyword_map (
    mall_code,category_keyword,keyword_normalized,context_hash,sample_products,candidate_json,candidate_round,
    ai_target_gm_code,final_gm_code,parent_gm_code,selection_type,ai_confidence,ai_reason,ai_model,
    prompt_tokens,completion_tokens,total_tokens,classification_source,status,is_current,classified_at,updated_at
  ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'AI',$18,'Y',now(),now())
  ON CONFLICT (mall_code,keyword_normalized,context_hash) WHERE is_current='Y'
  DO UPDATE SET category_keyword=EXCLUDED.category_keyword,sample_products=EXCLUDED.sample_products,candidate_json=EXCLUDED.candidate_json,
    candidate_round=EXCLUDED.candidate_round,ai_target_gm_code=EXCLUDED.ai_target_gm_code,final_gm_code=EXCLUDED.final_gm_code,
    parent_gm_code=EXCLUDED.parent_gm_code,selection_type=EXCLUDED.selection_type,ai_confidence=EXCLUDED.ai_confidence,
    ai_reason=EXCLUDED.ai_reason,ai_model=EXCLUDED.ai_model,prompt_tokens=EXCLUDED.prompt_tokens,
    completion_tokens=EXCLUDED.completion_tokens,total_tokens=EXCLUDED.total_tokens,status=EXCLUDED.status,
    classification_source='AI',classified_at=now(),updated_at=now()
  RETURNING id,status,selection_type,final_gm_code,parent_gm_code,context_hash`,vals);
  return q.rows&&q.rows[0]||null;
}


async function registerPending(db,items){
  const list=Array.isArray(items)?items:[];
  let inserted=0,refreshed=0,preserved=0,failed=0;
  const errors=[];
  for(const item of list){
    const keyword=S(item&&item.category_keyword);
    if(!keyword) continue;
    const keywordNormalized=normalizeKeyword(keyword);
    const contextHash=makeContextHash(item);
    const samples=Array.isArray(item&&item.examples)?item.examples.slice(0,20):[];
    const candidateJson={
      gm_codes:Array.isArray(item&&item.candidate_gm_codes)?item.candidate_gm_codes:[],
      names:Array.isArray(item&&item.candidate_names)?item.candidate_names:[]
    };
    try{
      const q=await db.query(`INSERT INTO gm_category_keyword_map (
        mall_code,category_keyword,keyword_normalized,context_hash,sample_products,candidate_json,candidate_round,
        selection_type,classification_source,status,is_current,created_at,updated_at
      ) VALUES ('CPKR',$1,$2,$3,$4::jsonb,$5::jsonb,0,'PENDING','AI','AI_PENDING','Y',now(),now())
      ON CONFLICT (mall_code,keyword_normalized,context_hash) WHERE is_current='Y'
      DO UPDATE SET category_keyword=EXCLUDED.category_keyword,
        sample_products=EXCLUDED.sample_products,candidate_json=EXCLUDED.candidate_json,updated_at=now()
      WHERE gm_category_keyword_map.status IN ('PENDING','AI_PENDING')
      RETURNING id,status,(xmax=0) AS inserted`,[
        keyword,keywordNormalized,contextHash,JSON.stringify(samples),JSON.stringify(candidateJson)
      ]);
      if(q.rowCount){
        if(q.rows[0]&&q.rows[0].inserted) inserted++;
        else refreshed++;
      }else{
        // Existing decided/review row is intentionally preserved and must never be downgraded to AI_PENDING.
        preserved++;
      }
    }catch(e){
      failed++;
      if(errors.length<10) errors.push({keyword,error:S(e&&e.message||e)});
    }
  }
  return {requested:list.length,inserted,refreshed,preserved,failed,errors};
}

async function guardedCall(db,{prompt,dedupKey,maxOutputTokens=180}){
  const cfg=OpenAIClient.config();
  const st=await AiGuard.settings(db);
  let lastErr=null;
  for(let attempt=0;attempt<=st.retry_max;attempt++){
    try{
      const gate=await AiGuard.preflight(db,{model:cfg.model,max_output_tokens:maxOutputTokens,dedup_key:`${dedupKey}:try${attempt}`});
      const out=await OpenAIClient.callOpenAI({input:prompt,model:cfg.model,maxOutputTokens:Math.min(maxOutputTokens,gate.max_output_tokens),reasoningEffort:'none'});
      const costInfo=await AiGuard.postSuccess(db,{model:out.model,usage:out.usage||{}});
      await recordUsage(db,{service_group:'CATEGORY',task_type:'CATEGORY_CLASSIFICATION',task_name_ko:'카테고리 분류 작업',provider:'OPENAI',model_name:out.model,prompt_tokens:out.usage?.input_tokens,completion_tokens:out.usage?.output_tokens,total_tokens:out.usage?.total_tokens,estimated_cost:costInfo.estimated_cost,currency:'USD'});
      return {...out,estimated_cost:Number(costInfo.estimated_cost||0)};
    }catch(e){
      lastErr=e;
      const code=S(e&&e.code);
      if(code.startsWith('AI_')||attempt>=st.retry_max) break;
    }
  }
  throw lastErr||new Error('AI_CLASSIFY_CALL_FAILED');
}
async function loadTree(db){
  const r=await db.query(`SELECT gm_code,gm_parent_code,name_ko,keyword,depth,leaf_yn,display_yn,sort_order FROM gm_category ORDER BY depth,sort_order,gm_code`);
  const nodes=new Map(),children=new Map();
  for(const row of r.rows){
    const code=S(row.gm_code); if(!code||nodes.has(code))continue;
    const node={gm_code:code,parent:S(row.gm_parent_code),name:S(row.name_ko)||S(row.keyword)||code,keyword:S(row.keyword),depth:Number(row.depth||0),leaf:S(row.leaf_yn).toUpperCase()==='Y'};
    nodes.set(code,node);
  }
  for(const n of nodes.values()){
    const p=n.parent&&nodes.has(n.parent)?n.parent:'';
    if(!children.has(p))children.set(p,[]);
    children.get(p).push(n);
  }
  for(const arr of children.values()) arr.sort((a,b)=>a.depth-b.depth||a.name.localeCompare(b.name,'ko'));
  function path(code){const out=[],seen=new Set();let cur=nodes.get(code);while(cur&&!seen.has(cur.gm_code)){seen.add(cur.gm_code);out.unshift(cur.name);cur=cur.parent?nodes.get(cur.parent):null;}return out.join(' > ');}
  return {nodes,children,path};
}
function candidateText(list){return list.map((x,i)=>`${i+1}. ${x.gm_code} | ${x.name}${x.keyword&&x.keyword!==x.name?' | keyword:'+x.keyword:''}`).join('\\n');}
async function classifyOne(db,item,tree){
  const examples=(item.examples||[]).slice(0,6).map(x=>clip(x,160));
  let parent='',best=null,totalUsage={input_tokens:0,output_tokens:0,total_tokens:0},totalCost=0,steps=[],lastModel='';
  for(let depth=0;depth<7;depth++){
    let list=(tree.children.get(parent)||[]).filter(x=>S(x.gm_code));
    if(!list.length)break;
    // Defensive cap. Normal Glomart levels are far below this. If exceeded, keep all shallow candidates up to 180.
    if(list.length>180) list=list.slice(0,180);
    const prompt=`당신은 Glomart 상품 카테고리 분류기입니다. 아래 상품군을 기존 카테고리 후보 중 반드시 가장 적합한 하나로 분류하세요. 상품명 문맥을 우선하고 키워드 다의어에 주의하세요. 후보 중 적합한 것이 정말 없으면 gm_code를 빈 문자열로 반환하세요.\\n\\n분류 키워드: ${item.category_keyword}\\n대표 상품:\\n- ${examples.join('\\n- ')}\\n\\n현재 단계 후보(${list.length}개):\\n${candidateText(list)}\\n\\nJSON 한 줄만 반환: {"gm_code":"후보의 정확한 gm_code 또는 빈 문자열","confidence":0.00,"reason":"한국어 한 문장"}`;
    const out=await guardedCall(db,{prompt,dedupKey:`CAT:${item.category_keyword}:D${depth}:P${parent||'ROOT'}`,maxOutputTokens:180});
    lastModel=S(out.model)||lastModel;
    totalUsage.input_tokens+=Number(out.usage?.input_tokens||0);totalUsage.output_tokens+=Number(out.usage?.output_tokens||0);totalUsage.total_tokens+=Number(out.usage?.total_tokens||0);totalCost+=Number(out.estimated_cost||0);
    const j=parseJsonText(out.text); const code=S(j.gm_code); const chosen=list.find(x=>x.gm_code===code);
    if(!chosen){steps.push({depth,parent,candidate_count:list.length,selected:'',confidence:Number(j.confidence||0),reason:S(j.reason)});break;}
    best={node:chosen,confidence:Math.max(0,Math.min(1,Number(j.confidence||0))),reason:S(j.reason)};
    steps.push({depth,parent,candidate_count:list.length,selected:chosen.gm_code,confidence:best.confidence,reason:best.reason});
    if(!(tree.children.get(chosen.gm_code)||[]).length||chosen.leaf)break;
    parent=chosen.gm_code;
  }
  if(!best) return {keyword:item.category_keyword,ok:false,ai_target_gm_code:'',ai_target_path:'',ai_target_leaf_yn:'',ai_confidence:0,ai_reason:'기존 카테고리 후보를 확정하지 못함',ai_model:lastModel,usage:totalUsage,estimated_cost:totalCost,steps};
  return {keyword:item.category_keyword,ok:true,ai_target_gm_code:best.node.gm_code,ai_target_path:tree.path(best.node.gm_code),ai_target_leaf_yn:best.node.leaf?'Y':'N',ai_confidence:Number(best.confidence.toFixed(4)),ai_reason:best.reason,ai_model:lastModel,usage:totalUsage,estimated_cost:Number(totalCost.toFixed(8)),steps};
}
async function classifySelected(db,items){
  if(!Array.isArray(items)||!items.length)throw new Error('AI_CLASSIFY_NO_ITEMS');
  const tree=await loadTree(db),results=[];
  for(let i=0;i<items.length;i++){
    const item=items[i];
    try{
      const result=await classifyOne(db,item,tree);
      try{result.saved=await saveDecision(db,item,result);}catch(se){
        result.save_error=S(se&&se.message||se);
      }
      results.push(result);
    }catch(e){
      const code=S(e&&e.code);
      results.push({keyword:S(item&&item.category_keyword),ok:false,ai_target_gm_code:'',ai_target_path:'',ai_target_leaf_yn:'',ai_confidence:0,ai_reason:S(e&&e.message||e),error_code:code,usage:{input_tokens:0,output_tokens:0,total_tokens:0},estimated_cost:0,steps:[]});
      if(code.startsWith('AI_')) break;
    }
  }
  return {results,selected_count:items.length,processed_count:results.length,success_count:results.filter(x=>x.ok).length,total_tokens:results.reduce((s,x)=>s+Number(x.usage?.total_tokens||0),0),estimated_cost:Number(results.reduce((s,x)=>s+Number(x.estimated_cost||0),0).toFixed(8))};
}
module.exports={classifySelected,registerPending};
