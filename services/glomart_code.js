'use strict';
// GM_GLOMART_CODE_SERVICE_V010
// Single server-side source of truth for gm_product.glomart_code classification.

const GM_CODE_RE=/^[A-Z]{2}-\d{2}-\d{3}-\d{4}-\d{4}-\d{4}$/i;
const MULTI_MAX=8;
const CACHE_TTL_MS=5*60*1000;
const cacheByDb=new WeakMap();

function norm(v){return String(v==null?'':v).normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();}
function raw(v){return String(v==null?'':v).trim();}
function splitCodes(v){return [...new Set(raw(v).split('|').map(x=>raw(x)).filter(Boolean))];}
function mergeCodes(...values){return [...new Set(values.flatMap(splitCodes).filter(Boolean))].sort().join('|');}
function joinCodes(rows){return [...new Set((rows||[]).map(x=>raw(x.gm_code||x)).filter(Boolean))].sort().join('|');}
function addMulti(map,key,row){if(!key)return;let a=map.get(key);if(!a){a=[];map.set(key,a);}if(!a.some(x=>x.gm_code===row.gm_code))a.push(row);}
function splitKeyword(v){const s=raw(v);if(!s)return [];const out=[norm(s)];for(const p of s.split(/[,;\n\r|/〉>·ㆍ&()+]+/g)){const n=norm(p);if(n)out.push(n);}return [...new Set(out.filter(Boolean))];}
function addHistory(map,key,code){if(!key||!code)return;let x=map.get(key);if(!x){x={total:0,codes:new Map()};map.set(key,x);}x.total++;x.codes.set(code,(x.codes.get(code)||0)+1);}
function historyWinner(map,key,minCount){const x=map.get(norm(key));if(!x||x.total<minCount||x.codes.size!==1)return null;const code=[...x.codes.keys()][0];return {code,count:x.total};}
function uniqueHit(map,value){const k=norm(value);if(!k)return null;const a=map.get(k)||[];if(a.length===1)return {row:a[0],ambiguous:false,count:1,key:k,rows:a};if(a.length>1)return {row:null,ambiguous:true,count:a.length,key:k,rows:a};return null;}
function categoryNames(rows){return (rows||[]).map(x=>x.name_ko).filter(Boolean).join(' | ');}

async function loadMaps(db){
  const r=await db.query(`SELECT gm_code,cp_code,depth,sort_order,name_ko,keyword,keyword_seed,display_yn FROM gm_category WHERE COALESCE(gm_code,'')<>''`);
  const gm=new Map(),cp=new Map(),full=new Map(),token=new Map();
  for(const x of r.rows){
    const row={gm_code:raw(x.gm_code),cp_code:raw(x.cp_code),depth:Number(x.depth||0),sort_order:Number(x.sort_order||0),name_ko:raw(x.name_ko)};
    gm.set(norm(row.gm_code),row);
    if(row.cp_code)addMulti(cp,norm(row.cp_code),row);
    for(const source of [x.keyword,x.keyword_seed,x.name_ko]){
      const sourceNorm=norm(source);if(sourceNorm)addMulti(full,sourceNorm,row);
      for(const k of splitKeyword(source))addMulti(token,k,row);
    }
  }
  return {gm,cp,full,token,category_count:r.rows.length};
}

async function loadHistory(db,maps){
  const pair=new Map(),keyword=new Map(),category=new Map();
  const r=await db.query(`SELECT glomart_code,category_keyword,keyword FROM gm_product WHERE COALESCE(glomart_code,'')<>''`);
  let learned=0,skippedMulti=0,skippedUnknown=0;
  for(const p of r.rows){
    const codes=splitCodes(p.glomart_code);
    if(codes.length!==1){if(codes.length>1)skippedMulti++;continue;}
    const code=codes[0];
    if(!maps.gm.has(norm(code))){skippedUnknown++;continue;}
    const ck=norm(p.category_keyword),kw=norm(p.keyword);
    if(ck&&kw)addHistory(pair,ck+'\u0001'+kw,code);
    if(kw)addHistory(keyword,kw,code);
    if(ck)addHistory(category,ck,code);
    learned++;
  }
  return {pair,keyword,category,learned,skippedMulti,skippedUnknown};
}

function classify(p,m,h){
  const directSources=[['cp_fix_code',p.cp_fix_code],['cp_selected_code',p.cp_selected_code],['category_code',p.category_code]];
  for(const [field,v] of directSources){const s=raw(v);if(!s||!GM_CODE_RE.test(s))continue;const hit=m.gm.get(norm(s));if(hit)return {gm_code:hit.gm_code,match_by:'DIRECT_GM_CODE',source_field:field,source_value:s,category_name:hit.name_ko,history_count:0,candidate_count:1};}

  const cpSources=[['mall_category',p.mall_category],['cp_fix_code',p.cp_fix_code],['cp_selected_code',p.cp_selected_code],['category_code',p.category_code]];
  let firstAmbiguous=null;
  for(const [field,v] of cpSources){
    const s=raw(v);if(!s||GM_CODE_RE.test(s))continue;const hit=uniqueHit(m.cp,s);
    if(hit&&hit.row)return {gm_code:hit.row.gm_code,match_by:field==='mall_category'?'MALL_CATEGORY_CP':'CP_CODE',source_field:field,source_value:s,category_name:hit.row.name_ko,history_count:0,candidate_count:1};
    if(hit&&hit.ambiguous&&!firstAmbiguous)firstAmbiguous={match_by:'AMBIGUOUS_CP_CODE',source_field:field,source_value:s,candidate_count:hit.count};
  }

  const ck=norm(p.category_keyword),kw=norm(p.keyword);
  if(ck&&kw){const z=historyWinner(h.pair,ck+'\u0001'+kw,2);if(z){const c=m.gm.get(norm(z.code));return {gm_code:z.code,match_by:'HISTORY_PAIR',source_field:'category_keyword+keyword',source_value:`${raw(p.category_keyword)} | ${raw(p.keyword)}`,category_name:c?c.name_ko:'',history_count:z.count,candidate_count:1};}}
  if(kw){const z=historyWinner(h.keyword,kw,2);if(z){const c=m.gm.get(norm(z.code));return {gm_code:z.code,match_by:'HISTORY_KEYWORD',source_field:'keyword',source_value:raw(p.keyword),category_name:c?c.name_ko:'',history_count:z.count,candidate_count:1};}}
  if(ck){const z=historyWinner(h.category,ck,5);if(z){const c=m.gm.get(norm(z.code));return {gm_code:z.code,match_by:'HISTORY_CATEGORY',source_field:'category_keyword',source_value:raw(p.category_keyword),category_name:c?c.name_ko:'',history_count:z.count,candidate_count:1};}}

  const kwSources=[['category_keyword',p.category_keyword],['keyword',p.keyword],['cp_selected_code',p.cp_selected_code],['cp_fix_code',p.cp_fix_code],['category_code',p.category_code]];
  for(const [field,v] of kwSources){
    const s=raw(v);if(!s||GM_CODE_RE.test(s))continue;const hit=uniqueHit(m.full,s);
    if(hit&&hit.row)return {gm_code:hit.row.gm_code,match_by:'KEYWORD_FULL_EXACT',source_field:field,source_value:s,category_name:hit.row.name_ko,history_count:0,candidate_count:1};
    if(hit&&hit.ambiguous){
      const code=joinCodes(hit.rows);
      if(code&&hit.count<=MULTI_MAX)return {gm_code:code,match_by:'KEYWORD_FULL_MULTI',source_field:field,source_value:s,category_name:categoryNames(hit.rows),history_count:0,candidate_count:hit.count};
      if(!firstAmbiguous)firstAmbiguous={match_by:'AMBIGUOUS_KEYWORD_FULL',source_field:field,source_value:s,candidate_count:hit.count};
    }
  }

  for(const [field,v] of kwSources){
    const s=raw(v);if(!s||GM_CODE_RE.test(s))continue;const hit=uniqueHit(m.token,s);
    if(hit&&hit.row)return {gm_code:hit.row.gm_code,match_by:'KEYWORD_TOKEN_UNIQUE',source_field:field,source_value:s,category_name:hit.row.name_ko,history_count:0,candidate_count:1};
    if(hit&&hit.ambiguous){
      const code=joinCodes(hit.rows);
      if(code&&hit.count<=MULTI_MAX)return {gm_code:code,match_by:'KEYWORD_TOKEN_MULTI',source_field:field,source_value:s,category_name:categoryNames(hit.rows),history_count:0,candidate_count:hit.count};
      if(!firstAmbiguous)firstAmbiguous={match_by:'AMBIGUOUS_KEYWORD_TOKEN',source_field:field,source_value:s,candidate_count:hit.count};
    }
  }
  if(firstAmbiguous)return {...firstAmbiguous,gm_code:'',category_name:'',history_count:0};
  return {gm_code:'',match_by:'NO_MATCH',source_field:'',source_value:'',category_name:'',history_count:0,candidate_count:0};
}

async function buildContext(db){const maps=await loadMaps(db);const history=await loadHistory(db,maps);return {maps,history,built_at:Date.now()};}
async function getContext(db,{fresh=false}={}){
  if(fresh)return buildContext(db);
  let c=cacheByDb.get(db);
  const now=Date.now();
  if(c&&c.value&&now-c.value.built_at<CACHE_TTL_MS)return c.value;
  if(c&&c.promise)return c.promise;
  const promise=buildContext(db).then(value=>{cacheByDb.set(db,{value,promise:null});return value;}).catch(err=>{cacheByDb.delete(db);throw err;});
  cacheByDb.set(db,{value:c&&c.value||null,promise});
  return promise;
}
function invalidateContext(db){if(db&&typeof db==='object')cacheByDb.delete(db);}
async function classifyProduct(db,p,{fresh=false}={}){const ctx=await getContext(db,{fresh});return classify(p,ctx.maps,ctx.history);}

module.exports={GM_CODE_RE,MULTI_MAX,norm,raw,splitCodes,mergeCodes,loadMaps,loadHistory,classify,getContext,invalidateContext,classifyProduct};
