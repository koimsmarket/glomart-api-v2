'use strict';
// GM_AI_CATEGORY_CONNECT_V008
// Builder-only semantic category classification test.
// Chooses an existing gm_category by walking the actual category tree with AI.
// Does NOT update gm_category or gm_product.

const OpenAIClient=require('./openai_client');
const AiGuard=require('./ai_guard');
const {recordUsage}=require('./ai_usage');

const S=v=>String(v==null?'':v).trim();
function parseJsonText(s){
  const raw=S(s).replace(/^```(?:json)?\\s*/i,'').replace(/```\\s*$/,'').trim();
  try{return JSON.parse(raw);}catch(_){}
  const a=raw.indexOf('{'),b=raw.lastIndexOf('}');
  if(a>=0&&b>a){try{return JSON.parse(raw.slice(a,b+1));}catch(_){} }
  throw new Error('AI_CLASSIFY_JSON_PARSE_FAILED:'+raw.slice(0,180));
}
function clip(s,n=180){s=S(s);return s.length>n?s.slice(0,n)+'…':s;}
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
  let parent='',best=null,totalUsage={input_tokens:0,output_tokens:0,total_tokens:0},totalCost=0,steps=[];
  for(let depth=0;depth<7;depth++){
    let list=(tree.children.get(parent)||[]).filter(x=>S(x.gm_code));
    if(!list.length)break;
    // Defensive cap. Normal Glomart levels are far below this. If exceeded, keep all shallow candidates up to 180.
    if(list.length>180) list=list.slice(0,180);
    const prompt=`당신은 Glomart 상품 카테고리 분류기입니다. 아래 상품군을 기존 카테고리 후보 중 반드시 가장 적합한 하나로 분류하세요. 상품명 문맥을 우선하고 키워드 다의어에 주의하세요. 후보 중 적합한 것이 정말 없으면 gm_code를 빈 문자열로 반환하세요.\\n\\n분류 키워드: ${item.category_keyword}\\n대표 상품:\\n- ${examples.join('\\n- ')}\\n\\n현재 단계 후보(${list.length}개):\\n${candidateText(list)}\\n\\nJSON 한 줄만 반환: {"gm_code":"후보의 정확한 gm_code 또는 빈 문자열","confidence":0.00,"reason":"한국어 한 문장"}`;
    const out=await guardedCall(db,{prompt,dedupKey:`CAT:${item.category_keyword}:D${depth}:P${parent||'ROOT'}`,maxOutputTokens:180});
    totalUsage.input_tokens+=Number(out.usage?.input_tokens||0);totalUsage.output_tokens+=Number(out.usage?.output_tokens||0);totalUsage.total_tokens+=Number(out.usage?.total_tokens||0);totalCost+=Number(out.estimated_cost||0);
    const j=parseJsonText(out.text); const code=S(j.gm_code); const chosen=list.find(x=>x.gm_code===code);
    if(!chosen){steps.push({depth,parent,candidate_count:list.length,selected:'',confidence:Number(j.confidence||0),reason:S(j.reason)});break;}
    best={node:chosen,confidence:Math.max(0,Math.min(1,Number(j.confidence||0))),reason:S(j.reason)};
    steps.push({depth,parent,candidate_count:list.length,selected:chosen.gm_code,confidence:best.confidence,reason:best.reason});
    if(!(tree.children.get(chosen.gm_code)||[]).length||chosen.leaf)break;
    parent=chosen.gm_code;
  }
  if(!best) return {keyword:item.category_keyword,ok:false,ai_target_gm_code:'',ai_target_path:'',ai_confidence:0,ai_reason:'기존 카테고리 후보를 확정하지 못함',usage:totalUsage,estimated_cost:totalCost,steps};
  return {keyword:item.category_keyword,ok:true,ai_target_gm_code:best.node.gm_code,ai_target_path:tree.path(best.node.gm_code),ai_confidence:Number(best.confidence.toFixed(4)),ai_reason:best.reason,usage:totalUsage,estimated_cost:Number(totalCost.toFixed(8)),steps};
}
async function classifySelected(db,items){
  if(!Array.isArray(items)||!items.length)throw new Error('AI_CLASSIFY_NO_ITEMS');
  if(items.length>10)throw new Error('AI_CLASSIFY_TEST_MAX_10');
  const tree=await loadTree(db),results=[];
  for(const item of items)results.push(await classifyOne(db,item,tree));
  return {results,selected_count:items.length,success_count:results.filter(x=>x.ok).length,total_tokens:results.reduce((s,x)=>s+Number(x.usage?.total_tokens||0),0),estimated_cost:Number(results.reduce((s,x)=>s+Number(x.estimated_cost||0),0).toFixed(8))};
}
module.exports={classifySelected};
