'use strict';
// GM_CATEGORY_V038_CATEGORY_UNIT_ANALYZER
// Derives category comparison units directly from gm_category + gm_product + gm_product_option.
// No CSV/master side table is required. Options enrich the parent product's evidence,
// but each product contributes at most one vote per unit so option-heavy products cannot dominate.

const clean=v=>String(v==null?'':v).replace(/[\u00A0\u200B-\u200D\uFEFF]/g,' ').replace(/\s+/g,' ').trim();

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

function emptyFlags(){
  return {kg:false,g:false,l:false,ml:false,count:false,sheet:false,roll:false,tablet:false,capsule:false,pouch:false,bottle:false,can:false,pair:false,piece:false};
}
function unitFlags(text){
  const s=clean(text), out=emptyFlags();
  for(const [k,re] of Object.entries(UNIT_RX)) out[k]=re.test(s);
  return out;
}
function mergeOptionFlags(dst,src){
  // Product title is primary evidence. Options only fill a family that the product title did not express.
  // This keeps 100g/1kg etc. from being double-counted just because one product has many option variants.
  if(!dst.kg&&!dst.g){dst.kg=src.kg;dst.g=src.g;}
  if(!dst.l&&!dst.ml){dst.l=src.l;dst.ml=src.ml;}
  if(!dst.sheet&&!dst.roll&&!dst.tablet&&!dst.capsule&&!dst.pouch&&!dst.bottle&&!dst.can&&!dst.pair&&!dst.piece){
    for(const k of ['sheet','roll','tablet','capsule','pouch','bottle','can','pair','piece'])dst[k]=src[k];
  }
  if(!dst.count)dst.count=src.count;
  return dst;
}
function pct(n,d){return d>0?n/d:0;}
function confidence(n,score,status){
  if(status==='NO_CPKR'||status==='NO_CATEGORY'||status==='CONFLICT_FALLBACK')return 'LOW';
  if(n>=20&&score>=0.65)return 'HIGH';
  if(n>=5)return 'MEDIUM';
  return 'LOW';
}

// Mirrors the proposal logic used for GM_CATEGORY_UNIT_RULE_V001, with option evidence added.
// Physical units are only auto-selected when the keyword/name actually exists in gm_category.
// Ambiguous weight+volume categories conservatively fall back to 1개 for automatic application.
function chooseRule(e,{categoryMatchCount=0}={}){
  const n=Number(e.coupang_products||0);
  if(!n){return {family:'COUNT',qty:1,unit:'개',status:'NO_CPKR',score:0,confidence:'LOW',reason:'쿠팡 상품 없음 → 1개 기준'};}

  const special=[
    {key:'tablet_products',unit:'정',threshold:0.40,label:'정'},
    {key:'sheet_products',unit:'매',threshold:0.35,label:'매'},
    {key:'roll_products',unit:'롤',threshold:0.35,label:'롤'},
    {key:'pair_products',unit:'켤레',threshold:0.35,label:'켤레'},
  ].map(x=>({...x,ratio:pct(Number(e[x.key]||0),n)})).sort((a,b)=>b.ratio-a.ratio);
  if(special[0].ratio>=special[0].threshold){
    const x=special[0];
    return {family:'COUNT',qty:1,unit:x.unit,status:'AUTO',score:x.ratio,confidence:confidence(n,x.ratio,'AUTO'),reason:`쿠팡 ${x.label} 표기 ${Math.round(x.ratio*100)}%`};
  }

  // The original proposal intentionally did not trust physical-unit inference for an
  // unmatched keyword. Keep that behavior so foreign/dirty keywords do not gain a false rule.
  if(!categoryMatchCount){
    const physical=Math.max(pct(Number(e.kg_products||0)+Number(e.g_products||0),n),pct(Number(e.l_products||0)+Number(e.ml_products||0),n));
    return {family:'COUNT',qty:1,unit:'개',status:'NO_CATEGORY',score:physical,confidence:'LOW',reason:'gm_category 정확매칭 없음 → 1개 기준'};
  }

  const weightRaw=Number(e.kg_products||0)+Number(e.g_products||0);
  const volumeRaw=Number(e.l_products||0)+Number(e.ml_products||0);
  const wr=pct(weightRaw,n), vr=pct(volumeRaw,n);

  if(wr>=0.30&&vr>=0.30){
    const score=Math.max(wr,vr);
    return {family:'COUNT',qty:1,unit:'개',status:'CONFLICT_FALLBACK',score,confidence:'LOW',reason:`중량 ${Math.round(Math.min(1,wr)*100)}% / 용량 ${Math.round(Math.min(1,vr)*100)}% 혼재 → 1개 기준`};
  }
  if(wr>=0.35){
    const kg=Number(e.kg_products||0),g=Number(e.g_products||0);
    const useKg=kg>=g;
    return {family:'WEIGHT',qty:useKg?1:100,unit:useKg?'kg':'g',status:'AUTO',score:wr,confidence:confidence(n,wr,'AUTO'),reason:`쿠팡 중량표기 ${Math.round(Math.min(1,wr)*100)}% (kg ${kg}, g ${g})`};
  }
  if(vr>=0.35){
    const l=Number(e.l_products||0),ml=Number(e.ml_products||0);
    const useL=l>=ml;
    return {family:'VOLUME',qty:useL?1:100,unit:useL?'l':'ml',status:'AUTO',score:vr,confidence:confidence(n,vr,'AUTO'),reason:`쿠팡 용량표기 ${Math.round(Math.min(1,vr)*100)}% (L ${l}, ml ${ml})`};
  }

  const score=Math.max(wr,vr,special[0].ratio||0);
  return {family:'COUNT',qty:1,unit:'개',status:'DEFAULT',score,confidence:confidence(n,score,'DEFAULT'),reason:score>=0.20?'소비단위 근거 부족 → 1개 기준':'내구/일반상품 → 1개 기준'};
}

async function pagedQuery(db,sqlBase,params,onRows,{pageSize=5000,maxRows=2000000}={}){
  let offset=0,total=0;
  for(;;){
    const r=await db.query(`${sqlBase} LIMIT $${params.length+1} OFFSET $${params.length+2}`,[...params,pageSize,offset]);
    if(!r.rows.length)break;
    total+=r.rows.length;
    if(total>maxRows)throw new Error('CATEGORY_UNIT_ANALYZE_MAX_ROWS_EXCEEDED');
    await onRows(r.rows);
    if(r.rows.length<pageSize)break;
    offset+=r.rows.length;
  }
  return total;
}

async function analyzeCategoryUnitRules(db,{sampleLimit=200,includeItems=true}={}){
  const cats=await db.query(`SELECT gm_code,name_ko,keyword,depth,sort_order FROM gm_category ORDER BY depth,sort_order,gm_code`);
  const categoryMap=new Map();
  for(const c of cats.rows){
    for(const key of [clean(c.keyword),clean(c.name_ko)]){
      if(!key)continue;
      if(!categoryMap.has(key))categoryMap.set(key,[]);
      const a=categoryMap.get(key);
      if(!a.some(x=>x.gm_code===c.gm_code))a.push(c);
    }
  }

  const allCounts=new Map();
  const products=new Map(); // CPKR product_uid -> product-level evidence
  await pagedQuery(db,`SELECT product_uid,mall_code,product_id,category_keyword,keyword,product_name,mall_product_name
    FROM gm_product
    WHERE COALESCE(category_keyword,'')<>''
    ORDER BY product_uid`,[],async rows=>{
    for(const p of rows){
      const kw=clean(p.category_keyword||p.keyword); if(!kw)continue;
      allCounts.set(kw,(allCounts.get(kw)||0)+1);
      if(clean(p.mall_code).toUpperCase()!=='CPKR')continue;
      products.set(String(p.product_uid),{
        product_uid:String(p.product_uid),product_id:String(p.product_id||''),keyword:kw,
        flags:unitFlags(`${p.product_name||''} ${p.mall_product_name||''}`)
      });
    }
  });

  // Add option evidence to its parent product. One product still contributes only one vote/unit.
  await pagedQuery(db,`SELECT p.product_uid,o.option_name
    FROM gm_product_option o
    JOIN gm_product p ON p.mall_code=o.mall_code AND p.product_id=o.product_id
    WHERE p.mall_code='CPKR' AND COALESCE(p.category_keyword,'')<>''
    ORDER BY p.product_uid,o.pi_ii_vi`,[],async rows=>{
    for(const o of rows){
      const p=products.get(String(o.product_uid)); if(!p)continue;
      mergeOptionFlags(p.flags,unitFlags(o.option_name||''));
    }
  });

  const ev=new Map();
  function E(kw){
    if(!ev.has(kw))ev.set(kw,{category_keyword:kw,coupang_products:0,kg_products:0,g_products:0,l_products:0,ml_products:0,count_products:0,sheet_products:0,roll_products:0,tablet_products:0,capsule_products:0,pouch_products:0,bottle_products:0,can_products:0,pair_products:0,piece_products:0});
    return ev.get(kw);
  }
  for(const p of products.values()){
    const x=E(p.keyword); x.coupang_products++;
    for(const k of Object.keys(p.flags)) if(p.flags[k]) x[`${k}_products`]++;
  }

  const keywords=new Set([...allCounts.keys(),...ev.keys()]);
  const items=[];
  const summary={keywords:0,category_rows:cats.rowCount||cats.rows.length,all_products:[...allCounts.values()].reduce((a,b)=>a+b,0),coupang_products:products.size,matched_keywords:0,no_category_keywords:0,auto_weight:0,auto_volume:0,auto_count_special:0,default_count:0,conflict_fallback:0,no_coupang:0,target_category_rows:0};
  for(const kw of [...keywords].sort((a,b)=>a.localeCompare(b,'ko'))){
    const x=ev.get(kw)||E(kw), matches=categoryMap.get(kw)||[];
    const rule=chooseRule(x,{categoryMatchCount:matches.length});
    summary.keywords++;
    if(matches.length){summary.matched_keywords++;summary.target_category_rows+=matches.length;} else summary.no_category_keywords++;
    if(rule.status==='NO_CPKR')summary.no_coupang++;
    else if(rule.status==='CONFLICT_FALLBACK')summary.conflict_fallback++;
    else if(rule.family==='WEIGHT')summary.auto_weight++;
    else if(rule.family==='VOLUME')summary.auto_volume++;
    else if(rule.status==='AUTO')summary.auto_count_special++;
    else summary.default_count++;
    items.push({
      category_keyword:kw,total_products:allCounts.get(kw)||0,coupang_products:x.coupang_products,
      category_match_count:matches.length,gm_codes:matches.map(m=>m.gm_code),
      unit_family:rule.family,unit_rule_qty:rule.qty,unit_rule_unit:rule.unit,status:rule.status,
      confidence:rule.confidence,score:Number(rule.score.toFixed(3)),reason:rule.reason,
      kg_products:x.kg_products,g_products:x.g_products,l_products:x.l_products,ml_products:x.ml_products,
      count_products:x.count_products,sheet_products:x.sheet_products,roll_products:x.roll_products,tablet_products:x.tablet_products,
      capsule_products:x.capsule_products,pouch_products:x.pouch_products,bottle_products:x.bottle_products,can_products:x.can_products,
      pair_products:x.pair_products,piece_products:x.piece_products
    });
  }
  return {summary,items:includeItems?items.slice(0,Math.max(0,Number(sampleLimit)||0)):[],allItems:items};
}

async function applyCategoryUnitRules(db,{sampleLimit=200}={}){
  const analyzed=await analyzeCategoryUnitRules(db,{sampleLimit,includeItems:true});
  const client=await db.connect();
  let changed=0,unchanged=0,skippedNoCategory=0;
  try{
    await client.query('BEGIN');
    for(const item of analyzed.allItems){
      if(!item.gm_codes.length){skippedNoCategory++;continue;}
      for(const code of item.gm_codes){
        const r=await client.query(`UPDATE gm_category
          SET unit_rule_qty=$2,unit_rule_unit=$3,updated_at=NOW()
          WHERE gm_code=$1
            AND (COALESCE(unit_rule_qty,0)<>$2 OR COALESCE(unit_rule_unit,'')<>$3)
          RETURNING gm_code`,[code,item.unit_rule_qty,item.unit_rule_unit]);
        if(r.rowCount)changed++; else unchanged++;
      }
    }
    await client.query('COMMIT');
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{}); throw e;
  }finally{client.release();}
  return {summary:analyzed.summary,items:analyzed.items,changed,unchanged,skipped_no_category:skippedNoCategory};
}

module.exports={unitFlags,chooseRule,analyzeCategoryUnitRules,applyCategoryUnitRules};
