'use strict';
// GM_CATEGORY_V040_CATEGORY_UNIT_ANALYZER
// Category representative-unit analysis uses gm_category + gm_product only.
// gm_product_option is deliberately excluded from representative-unit selection.

const clean=v=>String(v==null?'':v).replace(/[\u00A0\u200B-\u200D\uFEFF]/g,' ').replace(/\s+/g,' ').trim();
const norm=v=>clean(v).toLowerCase().replace(/[\s\-_/·.,()[\]{}]+/g,'').replace(/[^0-9a-z가-힣]/gi,'');

const UNIT_RX={
  kg:/(?:^|[^A-Za-z0-9])\d+(?:[.,]\d+)?\s*(?:kg|킬로그램)(?![A-Za-z])/i,
  g:/(?:^|[^A-Za-z0-9])\d+(?:[.,]\d+)?\s*(?:g|그램)(?![A-Za-z])/i,
  l:/(?:^|[^A-Za-z0-9])\d+(?:[.,]\d+)?\s*(?:l|리터)(?![A-Za-z])/i,
  ml:/(?:^|[^A-Za-z0-9])\d+(?:[.,]\d+)?\s*(?:ml|㎖|밀리리터)(?![A-Za-z])/i,
  count:/(?:^|[^0-9])\d+(?:[.,]\d+)?\s*(?:개입|개)(?![A-Za-z가-힣])/i,
  sheet:/(?:^|[^0-9])\d+(?:[.,]\d+)?\s*매(?![A-Za-z가-힣])/i,
  roll:/(?:^|[^0-9])\d+(?:[.,]\d+)?\s*롤(?![A-Za-z가-힣])/i,
  tablet:/(?:^|[^0-9])\d+(?:[.,]\d+)?\s*정(?![A-Za-z가-힣])/i,
  capsule:/(?:^|[^0-9])\d+(?:[.,]\d+)?\s*캡슐(?![A-Za-z가-힣])/i,
  pouch:/(?:^|[^0-9])\d+(?:[.,]\d+)?\s*포(?![A-Za-z가-힣])/i,
  bottle:/(?:^|[^0-9])\d+(?:[.,]\d+)?\s*병(?![A-Za-z가-힣])/i,
  can:/(?:^|[^0-9])\d+(?:[.,]\d+)?\s*캔(?![A-Za-z가-힣])/i,
  pair:/(?:^|[^0-9])\d+(?:[.,]\d+)?\s*(?:켤레|족)(?![A-Za-z가-힣])/i,
  piece:/(?:^|[^0-9])\d+(?:[.,]\d+)?\s*(?:장|권)(?![A-Za-z가-힣])/i,
};
function emptyFlags(){return {kg:false,g:false,l:false,ml:false,count:false,sheet:false,roll:false,tablet:false,capsule:false,pouch:false,bottle:false,can:false,pair:false,piece:false};}
function unitFlags(text){const s=clean(text),out=emptyFlags();for(const [k,re] of Object.entries(UNIT_RX))out[k]=re.test(s);return out;}
function pct(n,d){return d>0?n/d:0;}
function confidence(n,score,status){if(status==='NO_CPKR'||status==='NO_CATEGORY'||status==='MIXED_TIE')return 'LOW';if(n>=20&&score>=0.65)return 'HIGH';if(n>=5)return 'MEDIUM';return 'LOW';}

function chooseRule(e,{categoryMatchCount=0}={}){
  const n=Number(e.coupang_products||0);
  if(!n)return {family:'COUNT',qty:1,unit:'개',status:'NO_CPKR',score:0,confidence:'LOW',reason:'쿠팡 상품 없음 → 1개 기준'};
  const special=[
    {key:'tablet_products',unit:'정',threshold:0.40,label:'정'},{key:'sheet_products',unit:'매',threshold:0.35,label:'매'},
    {key:'roll_products',unit:'롤',threshold:0.35,label:'롤'},{key:'pair_products',unit:'켤레',threshold:0.35,label:'켤레'}
  ].map(x=>({...x,ratio:pct(Number(e[x.key]||0),n)})).sort((a,b)=>b.ratio-a.ratio);
  if(special[0].ratio>=special[0].threshold){const x=special[0];return {family:'COUNT',qty:1,unit:x.unit,status:'AUTO',score:x.ratio,confidence:confidence(n,x.ratio,'AUTO'),reason:`쿠팡 ${x.label} 표기 ${Math.round(x.ratio*100)}%`};}
  if(!categoryMatchCount){const physical=Math.max(pct(Number(e.kg_products||0)+Number(e.g_products||0),n),pct(Number(e.l_products||0)+Number(e.ml_products||0),n));return {family:'COUNT',qty:1,unit:'개',status:'NO_CATEGORY',score:physical,confidence:'LOW',reason:'gm_category 정확매칭 없음'};}

  const weightRaw=Number(e.kg_products||0)+Number(e.g_products||0);
  const volumeRaw=Number(e.l_products||0)+Number(e.ml_products||0);
  const wr=pct(weightRaw,n),vr=pct(volumeRaw,n);

  // Mixed weight/volume: choose the family with more products. Only an exact tie remains exceptional.
  if(wr>=0.30&&vr>=0.30){
    if(weightRaw===volumeRaw){return {family:'COUNT',qty:1,unit:'개',status:'MIXED_TIE',score:wr,confidence:'LOW',reason:`중량 ${weightRaw}건 / 용량 ${volumeRaw}건 동률 → 확인 필요`};}
    if(weightRaw>volumeRaw){const kg=Number(e.kg_products||0),g=Number(e.g_products||0),useKg=kg>=g;return {family:'WEIGHT',qty:useKg?1:100,unit:useKg?'kg':'g',status:'MIXED_MAJORITY_WEIGHT',score:wr,confidence:confidence(n,wr,'AUTO'),reason:`중량 ${weightRaw}건 > 용량 ${volumeRaw}건 → 중량 자동선택 (kg ${kg}, g ${g})`};}
    const l=Number(e.l_products||0),ml=Number(e.ml_products||0),useL=l>=ml;return {family:'VOLUME',qty:useL?1:100,unit:useL?'l':'ml',status:'MIXED_MAJORITY_VOLUME',score:vr,confidence:confidence(n,vr,'AUTO'),reason:`용량 ${volumeRaw}건 > 중량 ${weightRaw}건 → 용량 자동선택 (L ${l}, ml ${ml})`};
  }
  if(wr>=0.35){const kg=Number(e.kg_products||0),g=Number(e.g_products||0),useKg=kg>=g;return {family:'WEIGHT',qty:useKg?1:100,unit:useKg?'kg':'g',status:'AUTO',score:wr,confidence:confidence(n,wr,'AUTO'),reason:`쿠팡 중량표기 ${Math.round(Math.min(1,wr)*100)}% (kg ${kg}, g ${g})`};}
  if(vr>=0.35){const l=Number(e.l_products||0),ml=Number(e.ml_products||0),useL=l>=ml;return {family:'VOLUME',qty:useL?1:100,unit:useL?'l':'ml',status:'AUTO',score:vr,confidence:confidence(n,vr,'AUTO'),reason:`쿠팡 용량표기 ${Math.round(Math.min(1,vr)*100)}% (L ${l}, ml ${ml})`};}
  const score=Math.max(wr,vr,special[0].ratio||0);return {family:'COUNT',qty:1,unit:'개',status:'DEFAULT',score,confidence:confidence(n,score,'DEFAULT'),reason:score>=0.20?'소비단위 근거 부족 → 1개 기준':'내구/일반상품 → 1개 기준'};
}

async function pagedQuery(db,sqlBase,params,onRows,{pageSize=5000,maxRows=2000000}={}){let offset=0,total=0;for(;;){const r=await db.query(`${sqlBase} LIMIT $${params.length+1} OFFSET $${params.length+2}`,[...params,pageSize,offset]);if(!r.rows.length)break;total+=r.rows.length;if(total>maxRows)throw new Error('CATEGORY_UNIT_ANALYZE_MAX_ROWS_EXCEEDED');await onRows(r.rows);if(r.rows.length<pageSize)break;offset+=r.rows.length;}return total;}

async function analyzeCategoryUnitRules(db,{sampleLimit=500,includeItems=true}={}){
  const cats=await db.query(`SELECT gm_code,name_ko,keyword,depth,sort_order FROM gm_category ORDER BY depth,sort_order,gm_code`);
  const byCode=new Map(),normalizedCategoryMap=new Map();
  for(const c of cats.rows){
    const code=clean(c.gm_code);if(code)byCode.set(code,c);
    for(const key of [clean(c.keyword),clean(c.name_ko)]){if(!key)continue;const nk=norm(key);if(!nk)continue;if(!normalizedCategoryMap.has(nk))normalizedCategoryMap.set(nk,[]);const a=normalizedCategoryMap.get(nk);if(!a.some(x=>x.gm_code===c.gm_code))a.push(c);}
  }

  const matched=new Map(),unknownCodes=new Map(),examples=new Map();
  const fresh=()=>({coupang_products:0,kg_products:0,g_products:0,l_products:0,ml_products:0,count_products:0,sheet_products:0,roll_products:0,tablet_products:0,capsule_products:0,pouch_products:0,bottle_products:0,can_products:0,pair_products:0,piece_products:0,total_products:0});
  const E=(map,key)=>{if(!map.has(key))map.set(key,fresh());return map.get(key);};
  function addExample(key,name){if(!name)return;if(!examples.has(key))examples.set(key,[]);const a=examples.get(key);if(a.length<8&&!a.includes(name))a.push(name);}
  let allProducts=0,coupangProducts=0,firstCodePresent=0,firstCodeCategoryMatch=0,firstCodeMissing=0,firstCodeUnknown=0;

  await pagedQuery(db,`SELECT product_uid,mall_code,product_id,glomart_code,category_keyword,keyword,product_name,mall_product_name FROM gm_product ORDER BY product_uid`,[],async rows=>{
    for(const p of rows){
      allProducts++;
      const firstCode=clean(String(p.glomart_code||'').split('|')[0]);
      const kw=clean(p.category_keyword||p.keyword);
      const isCp=clean(p.mall_code).toUpperCase()==='CPKR';
      const name=clean(p.product_name||p.mall_product_name);
      if(firstCode){
        firstCodePresent++;
        const cat=byCode.get(firstCode);
        if(cat){
          firstCodeCategoryMatch++;
          const x=E(matched,firstCode);x.total_products++;
          if(isCp){coupangProducts++;x.coupang_products++;const flags=unitFlags(`${p.product_name||''} ${p.mall_product_name||''}`);for(const k of Object.keys(flags))if(flags[k])x[`${k}_products`]++;addExample(`C:${firstCode}`,name);}
          continue;
        }
        firstCodeUnknown++;
        const key=`UNKNOWN:${firstCode}`;const x=E(unknownCodes,key);x.total_products++;x.first_code=firstCode;x.category_keyword=kw||firstCode;x.unmatched_reason='FIRST_GLOMART_CODE_NOT_IN_GM_CATEGORY';
        if(isCp){coupangProducts++;x.coupang_products++;const flags=unitFlags(`${p.product_name||''} ${p.mall_product_name||''}`);for(const k of Object.keys(flags))if(flags[k])x[`${k}_products`]++;addExample(key,name);}
        continue;
      }
      // glomart_code 미부여 상품은 '카테고리 미매칭'이 아니다.
      // 아직 카테고리 코드가 부여되지 않은 상품이므로 대표단위 카테고리 분석에서는 제외하고 통계만 남긴다.
      firstCodeMissing++;
    }
  });

  const items=[];
  const summary={
    keywords:0,category_rows:cats.rowCount||cats.rows.length,all_products:allProducts,coupang_products:coupangProducts,
    matched_keywords:0,no_category_keywords:0,normalized_candidate_keywords:0,auto_weight:0,auto_volume:0,auto_count_special:0,default_count:0,
    mixed_majority_weight:0,mixed_majority_volume:0,mixed_tie:0,no_coupang:0,target_category_rows:0,
    first_code_present:firstCodePresent,first_code_category_match:firstCodeCategoryMatch,first_code_missing:firstCodeMissing,first_code_unknown:firstCodeUnknown,
    analyzed_categories:matched.size,unmatched_groups:unknownCodes.size,unknown_code_groups:unknownCodes.size
  };

  for(const [code,x] of [...matched.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
    const cat=byCode.get(code);const rule=chooseRule(x,{categoryMatchCount:1});
    summary.keywords++;summary.matched_keywords++;summary.target_category_rows++;
    if(rule.status==='NO_CPKR')summary.no_coupang++;else if(rule.status==='MIXED_TIE')summary.mixed_tie++;else if(rule.status==='MIXED_MAJORITY_WEIGHT')summary.mixed_majority_weight++;else if(rule.status==='MIXED_MAJORITY_VOLUME')summary.mixed_majority_volume++;else if(rule.family==='WEIGHT')summary.auto_weight++;else if(rule.family==='VOLUME')summary.auto_volume++;else if(rule.status==='AUTO')summary.auto_count_special++;else summary.default_count++;
    items.push({category_keyword:clean(cat.keyword||cat.name_ko||code),category_name:clean(cat.name_ko||cat.keyword||''),first_gm_code:code,total_products:x.total_products,coupang_products:x.coupang_products,category_match_count:1,gm_codes:[code],candidate_gm_codes:[],candidate_names:[],unit_family:rule.family,unit_rule_qty:rule.qty,unit_rule_unit:rule.unit,status:rule.status,confidence:rule.confidence,score:Number(rule.score.toFixed(3)),reason:rule.reason,kg_products:x.kg_products,g_products:x.g_products,l_products:x.l_products,ml_products:x.ml_products,count_products:x.count_products,sheet_products:x.sheet_products,roll_products:x.roll_products,tablet_products:x.tablet_products,capsule_products:x.capsule_products,pouch_products:x.pouch_products,bottle_products:x.bottle_products,can_products:x.can_products,pair_products:x.pair_products,piece_products:x.piece_products,examples:examples.get(`C:${code}`)||[]});
  }

  for(const [key,x] of [...unknownCodes.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
    const kw=clean(x.category_keyword||'(EMPTY)'),candidates=normalizedCategoryMap.get(norm(kw))||[];
    const rule=chooseRule(x,{categoryMatchCount:0});
    summary.keywords++;summary.no_category_keywords++;if(candidates.length)summary.normalized_candidate_keywords++;
    if(rule.status==='NO_CPKR')summary.no_coupang++;else summary.default_count++;
    items.push({category_keyword:kw,category_name:'',first_gm_code:clean(x.first_code||''),total_products:x.total_products,coupang_products:x.coupang_products,category_match_count:0,gm_codes:[],candidate_gm_codes:candidates.map(m=>m.gm_code),candidate_names:candidates.map(m=>m.name_ko||m.keyword||''),unit_family:rule.family,unit_rule_qty:rule.qty,unit_rule_unit:rule.unit,status:'NO_CATEGORY',confidence:'LOW',score:Number(rule.score.toFixed(3)),reason:`첫 glomart_code ${clean(x.first_code)} 가 gm_category에 없음`,kg_products:x.kg_products,g_products:x.g_products,l_products:x.l_products,ml_products:x.ml_products,count_products:x.count_products,sheet_products:x.sheet_products,roll_products:x.roll_products,tablet_products:x.tablet_products,capsule_products:x.capsule_products,pouch_products:x.pouch_products,bottle_products:x.bottle_products,can_products:x.can_products,pair_products:x.pair_products,piece_products:x.piece_products,examples:examples.get(key)||[]});
  }

  const reviewItems=items.filter(x=>x.status==='NO_CATEGORY'||x.status==='MIXED_TIE');
  return {summary,items:includeItems?items.slice(0,Math.max(0,Number(sampleLimit)||0)):[],reviewItems:reviewItems.slice(0,Math.max(0,Number(sampleLimit)||0)),allItems:items};
}

async function applyCategoryUnitRules(db,{sampleLimit=500}={}){
  const analyzed=await analyzeCategoryUnitRules(db,{sampleLimit,includeItems:true});const client=await db.connect();let changed=0,unchanged=0,skippedNoCategory=0,skippedTie=0;
  try{await client.query('BEGIN');for(const item of analyzed.allItems){if(!item.gm_codes.length){skippedNoCategory++;continue;}if(item.status==='MIXED_TIE'){skippedTie++;continue;}for(const code of item.gm_codes){const r=await client.query(`UPDATE gm_category SET unit_rule_qty=$2,unit_rule_unit=$3,updated_at=NOW() WHERE gm_code=$1 AND (COALESCE(unit_rule_qty,0)<>$2 OR COALESCE(unit_rule_unit,'')<>$3) RETURNING gm_code`,[code,item.unit_rule_qty,item.unit_rule_unit]);if(r.rowCount)changed++;else unchanged++;}}await client.query('COMMIT');}catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
  return {summary:analyzed.summary,items:analyzed.items,reviewItems:analyzed.reviewItems,changed,unchanged,skipped_no_category:skippedNoCategory,skipped_mixed_tie:skippedTie};
}
module.exports={unitFlags,chooseRule,analyzeCategoryUnitRules,applyCategoryUnitRules};
