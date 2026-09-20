'use strict';
// GM_AI_CATEGORY_CONNECT_V001
// Minimal OpenAI Responses API client for Builder verification.
// No batch classification here. One explicit test request only.

const API_URL='https://api.openai.com/v1/responses';

function clean(v){ return String(v==null?'':v).trim(); }
function int(v,d,min,max){ const n=Number(v); return Number.isFinite(n)?Math.max(min,Math.min(max,Math.floor(n))):d; }

function config(){
  return {
    configured: !!clean(process.env.OPENAI_API_KEY),
    model: clean(process.env.GM_AI_DEFAULT_MODEL)||'gpt-5.6-luna',
    reviewModel: clean(process.env.GM_AI_REVIEW_MODEL)||'gpt-5.6-sol',
    timeoutMs: int(process.env.GM_AI_HTTP_TIMEOUT_MS,20000,3000,60000)
  };
}

function extractText(j){
  if(clean(j&&j.output_text)) return clean(j.output_text);
  const out=[];
  for(const item of (j&&Array.isArray(j.output)?j.output:[])){
    for(const c of (item&&Array.isArray(item.content)?item.content:[])){
      if(typeof c?.text==='string') out.push(c.text);
      else if(typeof c?.output_text==='string') out.push(c.output_text);
    }
  }
  return clean(out.join('\n'));
}

async function callOpenAI({input,model,maxOutputTokens=64,reasoningEffort='none'}={}){
  const cfg=config();
  if(!cfg.configured) throw new Error('OPENAI_API_KEY_NOT_CONFIGURED');
  const selected=clean(model)||cfg.model;
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),cfg.timeoutMs);
  try{
    const r=await fetch(API_URL,{
      method:'POST',
      headers:{
        'authorization':`Bearer ${clean(process.env.OPENAI_API_KEY)}`,
        'content-type':'application/json'
      },
      body:JSON.stringify({
        model:selected,
        input:clean(input),
        max_output_tokens:int(maxOutputTokens,64,16,256),
        reasoning:{effort:clean(reasoningEffort)||'none'}
      }),
      signal:ctrl.signal
    });
    const raw=await r.text();
    let j={}; try{ j=raw?JSON.parse(raw):{}; }catch(_){ j={raw}; }
    if(!r.ok){
      const msg=clean(j?.error?.message)||clean(j?.message)||`OPENAI_HTTP_${r.status}`;
      const e=new Error(msg); e.status=r.status; e.body=j; throw e;
    }
    const u=j?.usage||{};
    return {
      id:clean(j?.id),
      model:clean(j?.model)||selected,
      text:extractText(j),
      usage:{
        input_tokens:Number(u.input_tokens||0),
        output_tokens:Number(u.output_tokens||0),
        total_tokens:Number(u.total_tokens||0)
      }
    };
  }finally{ clearTimeout(timer); }
}

async function connectionTest(){
  const out=await callOpenAI({
    input:'Glomart Builder API connection test. Reply with exactly: GLOMART_AI_OK',
    maxOutputTokens:32,
    reasoningEffort:'none'
  });
  return {...out,ok:/GLOMART_AI_OK/i.test(out.text)};
}

module.exports={config,callOpenAI,connectionTest};
