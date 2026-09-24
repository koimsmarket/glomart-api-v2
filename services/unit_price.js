'use strict';
// GM_CATEGORY_V041_UNIT_PRICE_ENGINE
// Unit-price command source: ordered gm_product.glomart_code tokens -> first code that exists in gm_category.
// Stale/nonexistent codes are preserved but skipped. category_keyword is not used to choose the rule.
// No weight<->volume conversion. Count units are not cross-converted.

const WEIGHT={mg:0.001,g:1,kg:1000};
const VOLUME={ml:1,l:1000};
const COUNT=new Set(['개','매','롤','정','캡슐','포','병','캔','켤레','장']);
const MIXED_UNIT='mixed';
const clean=v=>String(v==null?'':v).replace(/[\u00A0\u200B-\u200D\uFEFF]/g,' ').replace(/\s+/g,' ').trim();
const number=v=>{const n=Number(String(v==null?'':v).replace(/,/g,''));return Number.isFinite(n)?n:null;};
function normUnit(u){
  u=clean(u).toLowerCase().replace(/㎖/g,'ml');
  return ({킬로그램:'kg',그램:'g',리터:'l',밀리리터:'ml',개입:'개',입:'개',족:'켤레',권:'장'})[u]||u;
}
function family(u){u=normUnit(u);if(u===MIXED_UNIT)return'MIXED';if(WEIGHT[u]!=null)return'WEIGHT';if(VOLUME[u]!=null)return'VOLUME';if(COUNT.has(u))return'COUNT';return'';}
function baseQty(q,u){q=number(q);u=normUnit(u);if(q==null)return null;if(WEIGHT[u]!=null)return q*WEIGHT[u];if(VOLUME[u]!=null)return q*VOLUME[u];if(COUNT.has(u))return q;return null;}
function compatible(a,b){a=normUnit(a);b=normUnit(b);const fa=family(a),fb=family(b);if(!fa||fa!==fb)return false;if(fa==='COUNT')return a===b;return true;}
function canonicalBaseUnit(u){const f=family(u);return f==='WEIGHT'?'g':f==='VOLUME'?'ml':normUnit(u);}
function glomartCodes(v){return clean(v).split('|').map(clean).filter(Boolean);}
function firstGlomartCode(v){return glomartCodes(v)[0]||'';}

function parseExplicitUnitPrice(text){
  const re=/([0-9][0-9,]*(?:\.\d+)?)\s*(kg|킬로그램|g|그램|l|리터|ml|㎖|밀리리터|개입|개|매|롤|정|캡슐|포|병|캔|켤레|족|장)\s*당\s*([0-9,]+(?:\.\d+)?)\s*원?/ig;
  let m,last=null;
  while((m=re.exec(clean(text)))) last={qty:number(m[1]),unit:normUnit(m[2]),price:number(m[3]),raw:m[0]};
  return last;
}

function detectPhysicalFamilies(text){
  const s=clean(text);
  const weight=/(?:^|[^A-Za-z0-9])[0-9][0-9,]*(?:\.\d+)?\s*(?:kg|킬로그램|g|그램)(?![A-Za-z])/i.test(s);
  const volume=/(?:^|[^A-Za-z0-9])[0-9][0-9,]*(?:\.\d+)?\s*(?:l|리터|ml|㎖|밀리리터)(?![A-Za-z])/i.test(s);
  return {weight,volume};
}
function calculateMixed({price,unitPriceText='',texts=[]}){
  const p=number(price), joined=(texts||[]).filter(Boolean).join(' ');
  const explicit=parseExplicitUnitPrice(unitPriceText);
  if(explicit){
    const ef=family(explicit.unit);
    if(ef==='WEIGHT'||ef==='VOLUME'){
      const rq=100,ru=ef==='WEIGHT'?'g':'ml';
      const sourceBase=baseQty(explicit.qty,explicit.unit),targetBase=baseQty(rq,ru);
      const total=parseTotal(joined,ru);
      const totalBase=total?(total.alreadyBase?total.qty:baseQty(total.qty,total.unit)):null;
      return {ok:true,unit_price_value:explicit.price*targetBase/sourceBase,unit_base_qty:rq,unit_base_unit:ru,total_unit_qty:totalBase,total_unit_unit:totalBase==null?null:ru,unit_calc_basis:`FIRST_GM_CODE | MIXED | UNIT_TEXT:${explicit.raw}${total?` | TOTAL:${total.raw}`:''}`,mixed_family:ef};
    }
  }
  const f=detectPhysicalFamilies(joined);
  if(f.weight&&f.volume)return {ok:false,reason:'MIXED_PRODUCT_AMBIGUOUS'};
  if(!f.weight&&!f.volume)return {ok:false,reason:'MIXED_UNIT_NOT_FOUND'};
  const ru=f.weight?'g':'ml',rq=100,total=parseTotal(joined,ru);
  if(total&&p>0){
    const totalBase=total.alreadyBase?total.qty:baseQty(total.qty,total.unit);
    if(totalBase>0)return {ok:true,unit_price_value:p*baseQty(rq,ru)/totalBase,unit_base_qty:rq,unit_base_unit:ru,total_unit_qty:totalBase,total_unit_unit:ru,unit_calc_basis:`FIRST_GM_CODE | MIXED | PARSE:${total.raw} => ${totalBase}${ru}`,mixed_family:f.weight?'WEIGHT':'VOLUME'};
  }
  return {ok:false,reason:'MIXED_UNIT_PARSE_FAILED'};
}
function parseTotal(text,ruleUnit){
  text=clean(text); const ru=normUnit(ruleUnit); const hits=[]; let m;
  const direct=/([0-9][0-9,]*(?:\.\d+)?)\s*(kg|킬로그램|g|그램|l|리터|ml|㎖|밀리리터|개입|개|매|롤|정|캡슐|포|병|캔|켤레|족|장)\s*(?:[xX×*]\s*([0-9][0-9,]*(?:\.\d+)?))?/ig;
  while((m=direct.exec(text))){const q=number(m[1]),u=normUnit(m[2]),mul=number(m[3])||1;if(q&&compatible(u,ru))hits.push({qty:q*mul,unit:u,raw:m[0],score:(m[3]?50:10)+(u===ru?5:0)});}
  const qtyPack=/(\d+(?:\.\d+)?)\s*(kg|g|l|ml|㎖)\s*[,/]?\s*(\d+(?:\.\d+)?)\s*(?:개|봉|팩|병|캔|포)/ig;
  while((m=qtyPack.exec(text))){const q=number(m[1]),u=normUnit(m[2]),mul=number(m[3]);if(q&&mul&&compatible(u,ru))hits.push({qty:q*mul,unit:u,raw:m[0],score:70});}
  const reverse=/([0-9][0-9,]*(?:\.\d+)?)\s*(?:개|봉|팩|병|캔|포)\s*(?:[xX×*]\s*)?([0-9][0-9,]*(?:\.\d+)?)\s*(kg|g|l|ml|㎖)/ig;
  while((m=reverse.exec(text))){const mul=number(m[1]),q=number(m[2]),u=normUnit(m[3]);if(q&&mul&&compatible(u,ru))hits.push({qty:q*mul,unit:u,raw:m[0],score:70});}
  const plus=/((?:[0-9][0-9,]*(?:\.\d+)?\s*(?:kg|g|l|ml|㎖)\s*\+\s*)+[0-9][0-9,]*(?:\.\d+)?\s*(?:kg|g|l|ml|㎖))/ig;
  while((m=plus.exec(text))){
    const raw=m[1], terms=[...raw.matchAll(/([0-9][0-9,]*(?:\.\d+)?)\s*(kg|g|l|ml|㎖)/ig)];
    if(terms.length<2)continue;
    let sum=0,ok=true;
    for(const t of terms){const q=number(t[1]),u=normUnit(t[2]);if(!q||!compatible(u,ru)){ok=false;break;}sum+=baseQty(q,u);}
    if(ok&&sum>0)hits.push({qty:sum,unit:canonicalBaseUnit(ru),raw,score:80,alreadyBase:true});
  }
  if(!hits.length)return null;
  hits.sort((a,b)=>b.score-a.score);
  return hits[0];
}
function calculate({ruleQty,ruleUnit,price,unitPriceText='',texts=[]}){
  const rq=number(ruleQty), ru=normUnit(ruleUnit), p=number(price);
  if(ru===MIXED_UNIT)return calculateMixed({price:p,unitPriceText,texts});
  if(!rq||!ru)return {ok:false,reason:'NO_RULE'};
  const targetBase=baseQty(rq,ru); if(!targetBase)return {ok:false,reason:'BAD_RULE'};
  const explicit=parseExplicitUnitPrice(unitPriceText);
  const total=parseTotal((texts||[]).filter(Boolean).join(' '),ru);
  if(explicit&&compatible(explicit.unit,ru)){
    const sourceBase=baseQty(explicit.qty,explicit.unit);
    if(sourceBase>0){
      const totalBase=total?(total.alreadyBase?total.qty:baseQty(total.qty,total.unit)):null;
      return {ok:true,unit_price_value:explicit.price*targetBase/sourceBase,unit_base_qty:rq,unit_base_unit:ru,total_unit_qty:totalBase,total_unit_unit:totalBase==null?null:canonicalBaseUnit(ru),unit_calc_basis:`FIRST_GM_CODE | UNIT_TEXT:${explicit.raw}${total?` | TOTAL:${total.raw}`:''}`};
    }
  }
  if(total&&p>0){
    const totalBase=total.alreadyBase?total.qty:baseQty(total.qty,total.unit);
    if(totalBase>0)return {ok:true,unit_price_value:p*targetBase/totalBase,unit_base_qty:rq,unit_base_unit:ru,total_unit_qty:totalBase,total_unit_unit:canonicalBaseUnit(ru),unit_calc_basis:`FIRST_GM_CODE | PARSE:${total.raw} => ${totalBase}${canonicalBaseUnit(ru)}`};
  }
  // COUNT categories: when no explicit pack/count is written, one sale unit is the default.
  // Explicit 10개/20매/etc. is still handled by parseTotal above.
  if(family(ru)==='COUNT'&&p>0){
    const totalBase=baseQty(1,ru);
    return {ok:true,unit_price_value:p*targetBase/totalBase,unit_base_qty:rq,unit_base_unit:ru,total_unit_qty:1,total_unit_unit:ru,unit_calc_basis:'FIRST_GM_CODE | COUNT_DEFAULT:1'};
  }
  return {ok:false,reason:'UNIT_PARSE_FAILED'};
}

function inheritParentCalculation({ruleQty,ruleUnit,price,parentCalc}){
  const rq=number(ruleQty),ru=normUnit(ruleUnit),p=number(price);
  if(!parentCalc||!parentCalc.ok||!(p>0)||!(parentCalc.total_unit_qty>0))return null;
  const pf=family(parentCalc.unit_base_unit),rf=family(ru);
  if(ru===MIXED_UNIT){
    if(pf!=='WEIGHT'&&pf!=='VOLUME')return null;
    const baseUnit=pf==='WEIGHT'?'g':'ml',targetQty=100,targetBase=baseQty(targetQty,baseUnit);
    return {ok:true,unit_price_value:p*targetBase/parentCalc.total_unit_qty,unit_base_qty:targetQty,unit_base_unit:baseUnit,total_unit_qty:parentCalc.total_unit_qty,total_unit_unit:baseUnit,unit_calc_basis:'FIRST_GM_CODE | OPTION_INHERIT_PARENT_TOTAL',mixed_family:pf};
  }
  if(!rq||!ru||rf!==pf)return null;
  const targetBase=baseQty(rq,ru);if(!targetBase)return null;
  return {ok:true,unit_price_value:p*targetBase/parentCalc.total_unit_qty,unit_base_qty:rq,unit_base_unit:ru,total_unit_qty:parentCalc.total_unit_qty,total_unit_unit:canonicalBaseUnit(ru),unit_calc_basis:'FIRST_GM_CODE | OPTION_INHERIT_PARENT_TOTAL'};
}

async function findRuleByGmCode(db,gmCode){
  const code=clean(gmCode); if(!code)return null;
  const r=await db.query(`SELECT gm_code,keyword,name_ko,unit_rule_qty,unit_rule_unit FROM gm_category WHERE gm_code=$1 AND COALESCE(unit_rule_qty,0)>0 AND COALESCE(unit_rule_unit,'')<>'' LIMIT 1`,[code]);
  return r.rows[0]||null;
}
async function findFirstValidRule(db,glomartCode){
  const codes=glomartCodes(glomartCode);if(!codes.length)return null;
  const r=await db.query(`SELECT c.gm_code,c.keyword,c.name_ko,c.unit_rule_qty,c.unit_rule_unit,u.ord
    FROM unnest($1::text[]) WITH ORDINALITY AS u(code,ord)
    JOIN gm_category c ON c.gm_code=btrim(u.code)
    WHERE COALESCE(c.unit_rule_qty,0)>0 AND COALESCE(c.unit_rule_unit,'')<>''
    ORDER BY u.ord LIMIT 1`,[codes]);
  return r.rows[0]||null;
}
function withRuleSource(x,source){if(!x||!x.ok||!x.unit_calc_basis||source==='FIRST_GM_CODE')return x;return {...x,unit_calc_basis:String(x.unit_calc_basis).replace(/^FIRST_GM_CODE/,source)};}
function productPrice(p){return p.final_supply_price||p.mall_discount_price||p.discount_price||p.mall_sale_price||0;}

function failureReason(x,{ruleUnit='',price=0,unitPriceText='',texts=[]}={}){
  if(x&&x.ok)return '';
  const raw=clean(x&&x.reason||'UNIT_PARSE_FAILED');
  if(raw&&raw!=='UNIT_PARSE_FAILED')return raw;
  const ru=normUnit(ruleUnit), fam=family(ru), p=number(price);
  const explicit=parseExplicitUnitPrice(unitPriceText);
  if(explicit&&!compatible(explicit.unit,ru))return 'UNIT_PRICE_TEXT_INCOMPATIBLE';
  if((p==null||p<=0)&&!explicit)return 'PRICE_MISSING_OR_ZERO';
  if(fam==='COUNT')return 'COUNT_UNIT_PARSE_FAILED';
  const f=detectPhysicalFamilies((texts||[]).filter(Boolean).join(' '));
  if(fam==='WEIGHT'&&!f.weight)return 'WEIGHT_UNIT_NOT_FOUND';
  if(fam==='VOLUME'&&!f.volume)return 'VOLUME_UNIT_NOT_FOUND';
  return raw||'UNIT_PARSE_FAILED';
}
function addFailure(out,kind,reason,sample){
  const key=kind==='option'?'option_failures':'product_failures';
  if(!out[key])out[key]={};
  if(!out[key][reason])out[key][reason]={count:0,samples:[]};
  const b=out[key][reason]; b.count++;
  if(b.samples.length<5)b.samples.push(sample);
}
function addFailureCount(out,kind,reason,count,samples=[]){
  const key=kind==='option'?'option_failures':'product_failures';
  if(!out[key])out[key]={};
  if(!out[key][reason])out[key][reason]={count:0,samples:[]};
  const b=out[key][reason]; b.count+=Number(count||0);
  for(const sample of (samples||[])){if(b.samples.length>=5)break;b.samples.push(sample);}
}
async function recalcProductUnitByUid(db,uid){
  const pr=await db.query(`SELECT * FROM gm_product WHERE product_uid=$1 LIMIT 1`,[uid]);
  if(!pr.rows.length)return {ok:false,reason:'NO_PRODUCT'};
  const p=pr.rows[0], first_code=firstGlomartCode(p.glomart_code);
  if(!first_code)return {ok:false,reason:'NO_GLOMART_CODE'};
  const rule=await findFirstValidRule(db,p.glomart_code),ruleSource='FIRST_VALID_GM_CODE';
  if(!rule)return {ok:false,reason:'NO_VALID_GM_CATEGORY_RULE',first_code};
  const x=withRuleSource(calculate({ruleQty:rule.unit_rule_qty,ruleUnit:rule.unit_rule_unit,price:productPrice(p),unitPriceText:p.unit_price_text,texts:[p.product_name,p.mall_product_name,JSON.stringify(p.option_json||'')]}),ruleSource);
  await db.query(`UPDATE gm_product SET unit_price_value=$2,unit_base_qty=$3,unit_base_unit=$4,total_unit_qty=$5,total_unit_unit=$6,unit_calc_basis=$7,updated_at=NOW() WHERE product_uid=$1`,[uid,x.ok?x.unit_price_value:null,x.ok?x.unit_base_qty:rule.unit_rule_qty,x.ok?x.unit_base_unit:normUnit(rule.unit_rule_unit),x.ok?x.total_unit_qty:null,x.ok?x.total_unit_unit:null,x.ok?x.unit_calc_basis:x.reason]);
  const or=await db.query(`SELECT * FROM gm_product_option WHERE mall_code=$1 AND product_id=$2`,[p.mall_code,p.product_id]);
  let options=0,option_ok=0;
  for(const o of or.rows){
    options++;
    let ox=withRuleSource(calculate({ruleQty:rule.unit_rule_qty,ruleUnit:rule.unit_rule_unit,price:productPrice(o),texts:[o.option_name,p.product_name,p.mall_product_name]}),ruleSource);
    if(!ox.ok){
      const inherited=inheritParentCalculation({ruleQty:rule.unit_rule_qty,ruleUnit:rule.unit_rule_unit,price:productPrice(o),parentCalc:x});
      if(inherited)ox=withRuleSource(inherited,ruleSource);
    }
    await db.query(`UPDATE gm_product_option SET unit_price_value=$3,unit_base_qty=$4,unit_base_unit=$5,total_unit_qty=$6,total_unit_unit=$7,unit_calc_basis=$8,updated_at=NOW() WHERE mall_code=$1 AND pi_ii_vi=$2`,[o.mall_code,o.pi_ii_vi,ox.ok?ox.unit_price_value:null,ox.ok?ox.unit_base_qty:rule.unit_rule_qty,ox.ok?ox.unit_base_unit:normUnit(rule.unit_rule_unit),ox.ok?ox.total_unit_qty:null,ox.ok?ox.total_unit_unit:null,ox.ok?ox.unit_calc_basis:ox.reason]);
    if(ox.ok)option_ok++;
  }
  return {ok:x.ok,product:x.ok,options,option_ok,first_code,rule_source:ruleSource,rule:{gm_code:rule.gm_code,qty:rule.unit_rule_qty,unit:normUnit(rule.unit_rule_unit)},resolved_unit:x.ok?{qty:x.unit_base_qty,unit:x.unit_base_unit}:null};
}
async function recalcCategory(db,{gmCode='',all=false,apply=false,afterUid='',maxProducts=0}){
  const joins=`
    LEFT JOIN LATERAL (
      SELECT c.gm_code,c.unit_rule_qty,c.unit_rule_unit,u.ord
      FROM unnest(string_to_array(COALESCE(p.glomart_code,''),'|')) WITH ORDINALITY AS u(code,ord)
      JOIN gm_category c ON c.gm_code=btrim(u.code)
      ORDER BY u.ord LIMIT 1
    ) c ON true`;
  const filter=all?'':`AND c.gm_code=$1`;
  const params=all?[]:[clean(gmCode)];
  const pageSize=Math.max(1,Math.min(500,Number(maxProducts||500)));
  let lastUid=clean(afterUid);
  let processedProducts=0;
  const batchMode=!!(all&&apply&&Number(maxProducts||0)>0);
  const continuationBatch=!!(batchMode&&lastUid);
  let s={};
  if(!continuationBatch){
    const stat=await db.query(`SELECT
        COUNT(*)::int AS products_total,
        COUNT(*) FILTER (WHERE split_part(COALESCE(p.glomart_code,''),'|',1)<>'')::int AS first_code_present,
        COUNT(*) FILTER (WHERE c.gm_code IS NOT NULL)::int AS first_code_category_match,
        0::int AS admin_unit_reference_match,
        COUNT(*) FILTER (WHERE c.gm_code IS NOT NULL)::int AS resolved_category_match,
        COUNT(*) FILTER (WHERE c.gm_code IS NOT NULL AND COALESCE(c.unit_rule_qty,0)>0 AND COALESCE(c.unit_rule_unit,'')<>'')::int AS resolved_rule_match
      FROM gm_product p ${joins}
      WHERE 1=1 ${filter}`,params);
    s=stat.rows[0]||{};
  }
  const out={
    rules:0,products:Number(s.products_total||0),product_ok:0,options:0,option_ok:0,apply,
    first_code_present:Number(s.first_code_present||0),
    first_code_missing:Number(s.products_total||0)-Number(s.first_code_present||0),
    first_code_category_match:Number(s.first_code_category_match||0),
    first_code_category_missing:Number(s.first_code_present||0)-Number(s.first_code_category_match||0),
    unresolved_first_code_category_missing:Math.max(0,Number(s.first_code_present||0)-Number(s.first_code_category_match||0)),
    admin_unit_reference_match:0,
    resolved_category_match:Number(s.resolved_category_match||0),
    first_code_rule_match:Number(s.resolved_rule_match||0),
    first_code_rule_missing:Number(s.resolved_category_match||0)-Number(s.resolved_rule_match||0),
    rule_source:'FIRST_VALID_GM_CODE',
    product_failures:{},option_failures:{}
  };
  if(!continuationBatch){
    const rc=await db.query(`SELECT COUNT(*)::int AS n FROM gm_category WHERE COALESCE(unit_rule_qty,0)>0 AND COALESCE(unit_rule_unit,'')<>''${all?'':' AND gm_code=$1'}`,params);
    out.rules=Number(rc.rows[0]&&rc.rows[0].n||0);
  }

  if(all&&(!batchMode||!clean(afterUid))&&out.first_code_missing>0){
    const miss=await db.query(`SELECT product_uid,product_name,mall_product_name,glomart_code,category_keyword,unit_price_text,final_supply_price,mall_discount_price,discount_price,mall_sale_price
      FROM gm_product WHERE COALESCE(NULLIF(trim(glomart_code),''),'')='' ORDER BY product_uid LIMIT 5`);
    addFailureCount(out,'product','NO_GLOMART_CODE',out.first_code_missing,(miss.rows||[]).map(p=>({product_uid:p.product_uid,gm_code:'',rule_qty:'',rule_unit:'',price:productPrice(p),unit_price_text:clean(p.unit_price_text),product_name:clean(p.product_name||p.mall_product_name),glomart_code:clean(p.glomart_code)})));
  }
  if(all&&(!batchMode||!clean(afterUid))&&out.unresolved_first_code_category_missing>0)addFailureCount(out,'product','NO_VALID_GM_CATEGORY',out.unresolved_first_code_category_missing,[]);
  if(all&&(!batchMode||!clean(afterUid))&&out.first_code_rule_missing>0)addFailureCount(out,'product','NO_CATEGORY_UNIT_RULE',out.first_code_rule_missing,[]);

  while(true){
    const qparams=all?[lastUid,pageSize]:[clean(gmCode),lastUid,pageSize];
    const rows=await db.query(`SELECT p.product_uid,p.mall_code,p.product_id,p.product_name,p.mall_product_name,p.option_json,p.unit_price_text,
        p.final_supply_price,p.mall_discount_price,p.discount_price,p.mall_sale_price,p.glomart_code,p.category_keyword,p.keyword,
        c.gm_code,c.unit_rule_qty,c.unit_rule_unit,
        'FIRST_VALID_GM_CODE' AS rule_source
      FROM gm_product p ${joins}
      WHERE c.gm_code IS NOT NULL AND COALESCE(c.unit_rule_qty,0)>0 AND COALESCE(c.unit_rule_unit,'')<>''
        ${all?'':`AND c.gm_code=$1`}
        AND p.product_uid>${all?'$1':'$2'}
      ORDER BY p.product_uid ASC
      LIMIT ${all?'$2':'$3'}`,qparams);
    if(!rows.rows.length)break;

    const products=rows.rows;
    const keys=products.filter(p=>p.mall_code!=null&&p.product_id!=null);
    const optionMap=new Map();
    if(keys.length){
      const vals=[];const tuples=[];let n=1;
      for(const p of keys){tuples.push(`($${n++}::text,$${n++}::text)`);vals.push(String(p.mall_code),String(p.product_id));}
      const oq=await db.query(`WITH k(mall_code,product_id) AS (VALUES ${tuples.join(',')})
        SELECT o.* FROM gm_product_option o JOIN k ON o.mall_code::text=k.mall_code AND o.product_id::text=k.product_id`,vals);
      for(const o of oq.rows){const k=String(o.mall_code)+'\u0001'+String(o.product_id);if(!optionMap.has(k))optionMap.set(k,[]);optionMap.get(k).push(o);}
    }

    for(const p of products){
      const source=clean(p.rule_source)||'FIRST_GM_CODE';
      const pTexts=[p.product_name,p.mall_product_name,JSON.stringify(p.option_json||'')];
      const pPrice=productPrice(p);
      const x=withRuleSource(calculate({ruleQty:p.unit_rule_qty,ruleUnit:p.unit_rule_unit,price:pPrice,unitPriceText:p.unit_price_text,texts:pTexts}),source);
      if(x.ok)out.product_ok++;
      else {
        const reason=failureReason(x,{ruleUnit:p.unit_rule_unit,price:pPrice,unitPriceText:p.unit_price_text,texts:pTexts});
        addFailure(out,'product',reason,{product_uid:p.product_uid,gm_code:p.gm_code,rule_qty:p.unit_rule_qty,rule_unit:normUnit(p.unit_rule_unit),price:pPrice,unit_price_text:clean(p.unit_price_text),product_name:clean(p.product_name||p.mall_product_name),glomart_code:clean(p.glomart_code)});
      }
      if(apply){
        await db.query(`UPDATE gm_product SET unit_price_value=$2,unit_base_qty=$3,unit_base_unit=$4,total_unit_qty=$5,total_unit_unit=$6,unit_calc_basis=$7,updated_at=NOW() WHERE product_uid=$1`,[p.product_uid,x.ok?x.unit_price_value:null,x.ok?x.unit_base_qty:p.unit_rule_qty,x.ok?x.unit_base_unit:normUnit(p.unit_rule_unit),x.ok?x.total_unit_qty:null,x.ok?x.total_unit_unit:null,x.ok?x.unit_calc_basis:x.reason]);
      }
      const options=optionMap.get(String(p.mall_code)+'\u0001'+String(p.product_id))||[];
      for(const o of options){
        out.options++;
        const oTexts=[o.option_name,p.product_name,p.mall_product_name];
        const oPrice=productPrice(o);
        let ox=withRuleSource(calculate({ruleQty:p.unit_rule_qty,ruleUnit:p.unit_rule_unit,price:oPrice,texts:oTexts}),source);
        if(!ox.ok){
          const inherited=inheritParentCalculation({ruleQty:p.unit_rule_qty,ruleUnit:p.unit_rule_unit,price:oPrice,parentCalc:x});
          if(inherited)ox=withRuleSource(inherited,source);
        }
        if(ox.ok)out.option_ok++;
        else {
          const reason=failureReason(ox,{ruleUnit:p.unit_rule_unit,price:oPrice,texts:oTexts});
          addFailure(out,'option',reason,{mall_code:o.mall_code,pi_ii_vi:o.pi_ii_vi,gm_code:p.gm_code,rule_qty:p.unit_rule_qty,rule_unit:normUnit(p.unit_rule_unit),price:oPrice,option_name:clean(o.option_name),product_name:clean(p.product_name||p.mall_product_name)});
        }
        if(apply)await db.query(`UPDATE gm_product_option SET unit_price_value=$3,unit_base_qty=$4,unit_base_unit=$5,total_unit_qty=$6,total_unit_unit=$7,unit_calc_basis=$8,updated_at=NOW() WHERE mall_code=$1 AND pi_ii_vi=$2`,[o.mall_code,o.pi_ii_vi,ox.ok?ox.unit_price_value:null,ox.ok?ox.unit_base_qty:p.unit_rule_qty,ox.ok?ox.unit_base_unit:normUnit(p.unit_rule_unit),ox.ok?ox.total_unit_qty:null,ox.ok?ox.total_unit_unit:null,ox.ok?ox.unit_calc_basis:ox.reason]);
      }
    }
    lastUid=String(products[products.length-1].product_uid||'');
    processedProducts+=products.length;
    if(batchMode || products.length<pageSize)break;
  }
  out.processed_products=processedProducts;
  out.next_cursor=lastUid||'';
  out.done=!batchMode || processedProducts<pageSize;
  out.product_failed=Math.max(0,out.products-out.product_ok);
  out.option_failed=Math.max(0,out.options-out.option_ok);
  return out;
}

module.exports={calculate,calculateMixed,inheritParentCalculation,recalcProductUnitByUid,recalcCategory,normUnit,glomartCodes,firstGlomartCode,findRuleByGmCode,findFirstValidRule};
