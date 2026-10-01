'use strict';
// GM_PRODUCT_SPLIT_V003_SEARCH_CATEGORY
const {cleanText,toInt,parseMaybeJsonAny}=require('./shared');
const {normalizeKeywordValue}=require('./keyword');
const {findCpSelectedCodeForKeyword}=require('../category');
function normalizeMallCategoryJson(p){
  p=p||{};
  let src = p.mall_category_json || p.mallCategoryJson || p.mall_category_path_json || p.mallCategoryPathJson ||
            p.cp_category_tree_json || p.cpCategoryTreeJson || p.category_tree_json || p.categoryTreeJson ||
            p.categoryTree || p.category_tree || p.cpCategoryTree || p.cp_category_tree ||
            p.breadcrumbs || p.breadcrumb || p.categoryPathItems || p.category_path_items || [];
  if(typeof src === 'string'){
    const parsed = parseMaybeJsonAny(src);
    if(parsed) src = parsed;
  }
  if(src && !Array.isArray(src) && Array.isArray(src.path)) src = src.path;
  if(src && !Array.isArray(src) && Array.isArray(src.nodes)) src = src.nodes;
  if(src && !Array.isArray(src) && Array.isArray(src.tree)) src = src.tree;
  if(!Array.isArray(src)) src = [];
  const out=[]; const seen=new Set();
  src.forEach((r)=>{
    let id='', name='', href='', depth=out.length+1;
    if(r && typeof r === 'object'){
      id = cleanText(r.cp_code || r.cpCode || r.id || r.category_id || r.categoryId || r.cate_no || r.cateNo || r.code || '');
      name = cleanText(r.name_ko || r.nameKo || r.name || r.category_name || r.categoryName || r.title || r.label || '');
      href = cleanText(r.href || r.url || '');
      depth = toInt(r.depth || r.level || depth, depth);
    }else{
      name = cleanText(r);
    }
    if(!id && !name) return;
    const sig=(id||'')+'|'+name;
    if(seen.has(sig)) return; seen.add(sig);
    out.push({ depth: out.length + 1, id, cp_code:id, name, name_ko:name, href });
  });
  return out;
}
function pickMallCategoryLeaf(p, mallCategoryJson){
  p=p||{};
  const arr = Array.isArray(mallCategoryJson) ? mallCategoryJson : normalizeMallCategoryJson(p);
  const leaf = arr.length ? arr[arr.length-1] : null;
  const leafId = cleanText((leaf && leaf.id) || p.mall_category_id || p.mallCategoryId || '');
  if(leafId) return leafId;
  const direct = cleanText(p.mall_category || p.mallCategory || '');
  if(/^\d+$/.test(direct)) return direct;
  const m = direct.match(/\((\d{3,})\)\s*$/) || direct.match(/(\d{3,})\s*$/);
  if(m) return m[1];
  return direct;
}

function searchCategoryRequestToken(p){
  return cleanText(p.request_id || p.requestId || p.search_request_id || p.searchRequestId || p.search_run_id || p.searchRunId || p.base_request_id || p.baseRequestId || '');
}
async function resolveSearchCategoryOnce(pool, keyword, p){
  const kw = normalizeKeywordValue(keyword);
  if(!kw) return { value:'', cache_hit:false };
  const key = (searchCategoryRequestToken(p) || 'KW') + '::' + kw;
  let promise = __gmSearchCategoryOnce.get(key);
  if(promise) return { value:cleanText(await promise), cache_hit:true };
  promise = (async()=>cleanText(await findCpSelectedCodeForKeyword(pool, keyword)) || cleanText(keyword))();
  __gmSearchCategoryOnce.set(key, promise);
  const timer = setTimeout(()=>{ if(__gmSearchCategoryOnce.get(key) === promise) __gmSearchCategoryOnce.delete(key); }, 90000);
  if(timer && typeof timer.unref === 'function') timer.unref();
  return { value:cleanText(await promise), cache_hit:false };
}


let __gmLightJsonColumnsEnsured = false;

function baseRequestToken(v){return cleanText(v).replace(/_(?:CPKR|ALKR|ALI|COUPANG)_C\d{1,4}$/i,'').replace(/_C\d{1,4}$/i,'');}
async function resolveQueueSearchCategory(pool,keyword,requestId){return resolveSearchCategoryOnce(pool,keyword,{requestId:baseRequestToken(requestId)});}
module.exports={normalizeMallCategoryJson,pickMallCategoryLeaf,resolveSearchCategoryOnce,resolveQueueSearchCategory,baseRequestToken};
