'use strict';
// GM_CATEGORY_V040_UNIT_PRICE_ENGINE
// Unit-price command source: FIRST gm_product.glomart_code -> gm_category.gm_code.
// category_keyword is NOT used to decide the unit-price rule.
// No weight<->volume conversion. Count units are not cross-converted.

const WEIGHT={mg:0.001,g:1,kg:1000};
const VOLUME={ml:1,l:1000};
const COUNT=new Set(['개','매','롤','정','캡슐','포','병','캔','켤레','장']);
const clean=v=>String(v==null?'':v).replace(/[\u00A0\u200B-\u200D\uFEFF]/g,' ').replace(/\s+/g,' ').trim();
const number=v=>{const n=Number(String(v==null?'':v).replace(/,/g,''));return Number.isFinite(n)?n:null;};
function normUnit(u){
  u=clean(u).toLowerCase().replace(/㎖/g,'ml');
  return ({킬로그램:'kg',그램:'g',리터:'l',밀리리터:'ml',개입:'개',입:'개',족:'켤레',권:'장'})[u]||u;
}
function family(u){u=normUnit(u);if(WEIGHT[u]!=null)return'WEIGHT';if(VOLUME[u]!=null)return'VOLUME';if(COUNT.has(u))return'COUNT';return'';}
function baseQty(q,u){q=number(q);u=normUnit(u);if(q==null)return null;if(WEIGHT[u]!=null)return q*WEIGHT[u];if(VOLUME[u]!=null)return q*VOLUME[u];if(COUNT.has(u))return q;return null;}
function compatible(a,b){a=normUnit(a);b=normUnit(b);const fa=family(a),fb=family(b);if(!fa||fa!==fb)return false;if(fa==='COUNT')return a===b;return true;}
function canonicalBaseUnit(u){const f=family(u);return f==='WEIGHT'?'g':f==='VOLUME'?'ml':normUnit(u);}
function firstGlomartCode(v){return clean(v).split('|').map(clean).filter(Boolean)[0]||'';}

function parseExplicitUnitPrice(text){
  const re=/(\d+(?:\.\d+)?)\s*(kg|킬로그램|g|그램|l|리터|ml|㎖|밀리리터|개입|개|매|롤|정|캡슐|포|병|캔|켤레|족|장)\s*당\s*([0-9,]+(?:\.\d+)?)\s*원?/ig;
  let m,last=null;
  while((m=re.exec(clean(text)))) last={qty:number(m[1]),unit:normUnit(m[2]),price:number(m[3]),raw:m[0]};
  return last;
}
function parseTotal(text,ruleUnit){
  text=clean(text); const ru=normUnit(ruleUnit); const hits=[]; let m;
  const direct=/(\d+(?:\.\d+)?)\s*(kg|킬로그램|g|그램|l|리터|ml|㎖|밀리리터|개입|개|매|롤|정|캡슐|포|병|캔|켤레|족|장)\s*(?:[xX×*]\s*(\d+(?:\.\d+)?))?/ig;
  while((m=direct.exec(text))){const q=number(m[1]),u=normUnit(m[2]),mul=number(m[3])||1;if(q&&compatible(u,ru))hits.push({qty:q*mul,unit:u,raw:m[0],score:(m[3]?50:10)+(u===ru?5:0)});}
  const qtyPack=/(\d+(?:\.\d+)?)\s*(kg|g|l|ml|㎖)\s*[,/]?\s*(\d+(?:\.\d+)?)\s*(?:개|봉|팩|병|캔|포)/ig;
  while((m=qtyPack.exec(text))){const q=number(m[1]),u=normUnit(m[2]),mul=number(m[3]);if(q&&mul&&compatible(u,ru))hits.push({qty:q*mul,unit:u,raw:m[0],score:70});}
  const reverse=/(\d+(?:\.\d+)?)\s*(?:개|봉|팩|병|캔|포)\s*(?:[xX×*]\s*)?(\d+(?:\.\d+)?)\s*(kg|g|l|ml|㎖)/ig;
  while((m=reverse.exec(text))){const mul=number(m[1]),q=number(m[2]),u=normUnit(m[3]);if(q&&mul&&compatible(u,ru))hits.push({qty:q*mul,unit:u,raw:m[0],score:70});}
  const plus=/((?:\d+(?:\.\d+)?\s*(?:kg|g|l|ml|㎖)\s*\+\s*)+\d+(?:\.\d+)?\s*(?:kg|g|l|ml|㎖))/ig;
  while((m=plus.exec(text))){
    const raw=m[1], terms=[...raw.matchAll(/(\d+(?:\.\d+)?)\s*(kg|g|l|ml|㎖)/ig)];
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
  return {ok:false,reason:'UNIT_PARSE_FAILED'};
}
async function findRuleByGmCode(db,gmCode){
  const code=clean(gmCode); if(!code)return null;
  const r=await db.query(`SELECT gm_code,keyword,name_ko,unit_rule_qty,unit_rule_unit FROM gm_category WHERE gm_code=$1 AND COALESCE(unit_rule_qty,0)>0 AND COALESCE(unit_rule_unit,'')<>'' LIMIT 1`,[code]);
  return r.rows[0]||null;
}
function productPrice(p){return p.final_supply_price||p.mall_discount_price||p.discount_price||p.mall_sale_price||0;}
async function recalcProductUnitByUid(db,uid){
  const pr=await db.query(`SELECT * FROM gm_product WHERE product_uid=$1 LIMIT 1`,[uid]);
  if(!pr.rows.length)return {ok:false,reason:'NO_PRODUCT'};
  const p=pr.rows[0], first_code=firstGlomartCode(p.glomart_code);
  if(!first_code)return {ok:false,reason:'NO_FIRST_GLOMART_CODE'};
  const rule=await findRuleByGmCode(db,first_code);
  if(!rule)return {ok:false,reason:'NO_RULE_FOR_FIRST_GLOMART_CODE',first_code};
  const x=calculate({ruleQty:rule.unit_rule_qty,ruleUnit:rule.unit_rule_unit,price:productPrice(p),unitPriceText:p.unit_price_text,texts:[p.product_name,p.mall_product_name,JSON.stringify(p.option_json||'')]});
  await db.query(`UPDATE gm_product SET unit_price_value=$2,unit_base_qty=$3,unit_base_unit=$4,total_unit_qty=$5,total_unit_unit=$6,unit_calc_basis=$7,updated_at=NOW() WHERE product_uid=$1`,[uid,x.ok?x.unit_price_value:null,rule.unit_rule_qty,normUnit(rule.unit_rule_unit),x.ok?x.total_unit_qty:null,x.ok?x.total_unit_unit:null,x.ok?x.unit_calc_basis:x.reason]);
  const or=await db.query(`SELECT * FROM gm_product_option WHERE mall_code=$1 AND product_id=$2`,[p.mall_code,p.product_id]);
  let options=0,option_ok=0;
  for(const o of or.rows){
    options++;
    const ox=calculate({ruleQty:rule.unit_rule_qty,ruleUnit:rule.unit_rule_unit,price:productPrice(o),texts:[o.option_name,p.product_name,p.mall_product_name]});
    await db.query(`UPDATE gm_product_option SET unit_price_value=$3,unit_base_qty=$4,unit_base_unit=$5,total_unit_qty=$6,total_unit_unit=$7,unit_calc_basis=$8,updated_at=NOW() WHERE mall_code=$1 AND pi_ii_vi=$2`,[o.mall_code,o.pi_ii_vi,ox.ok?ox.unit_price_value:null,rule.unit_rule_qty,normUnit(rule.unit_rule_unit),ox.ok?ox.total_unit_qty:null,ox.ok?ox.total_unit_unit:null,ox.ok?ox.unit_calc_basis:ox.reason]);
    if(ox.ok)option_ok++;
  }
  return {ok:x.ok,product:x.ok,options,option_ok,first_code,rule:{gm_code:rule.gm_code,qty:rule.unit_rule_qty,unit:normUnit(rule.unit_rule_unit)}};
}
async function recalcCategory(db,{gmCode='',all=false,apply=false}){
  const filter=all?'':`AND split_part(COALESCE(p.glomart_code,''),'|',1)=$1`;
  const params=all?[]:[clean(gmCode)];
  const stat=await db.query(`SELECT
      COUNT(*)::int AS products_total,
      COUNT(*) FILTER (WHERE split_part(COALESCE(p.glomart_code,''),'|',1)<>'')::int AS first_code_present,
      COUNT(*) FILTER (WHERE c.gm_code IS NOT NULL)::int AS first_code_category_match,
      COUNT(*) FILTER (WHERE c.gm_code IS NOT NULL AND COALESCE(c.unit_rule_qty,0)>0 AND COALESCE(c.unit_rule_unit,'')<>'')::int AS first_code_rule_match
    FROM gm_product p
    LEFT JOIN gm_category c ON c.gm_code=split_part(COALESCE(p.glomart_code,''),'|',1)
    WHERE 1=1 ${filter}`,params);
  const s=stat.rows[0]||{};
  const out={
    rules:0,products:Number(s.products_total||0),product_ok:0,options:0,option_ok:0,apply,
    first_code_present:Number(s.first_code_present||0),
    first_code_missing:Number(s.products_total||0)-Number(s.first_code_present||0),
    first_code_category_match:Number(s.first_code_category_match||0),
    first_code_category_missing:Number(s.first_code_present||0)-Number(s.first_code_category_match||0),
    first_code_rule_match:Number(s.first_code_rule_match||0),
    first_code_rule_missing:Number(s.first_code_category_match||0)-Number(s.first_code_rule_match||0),
    rule_source:'FIRST_GLOMART_CODE'
  };
  const rc=await db.query(`SELECT COUNT(*)::int AS n FROM gm_category WHERE COALESCE(unit_rule_qty,0)>0 AND COALESCE(unit_rule_unit,'')<>''${all?'':' AND gm_code=$1'}`,params);
  out.rules=Number(rc.rows[0]&&rc.rows[0].n||0);

  const pageSize=500; let lastUid='';
  while(true){
    const qparams=all?[lastUid,pageSize]:[clean(gmCode),lastUid,pageSize];
    const rows=await db.query(`SELECT p.product_uid,p.mall_code,p.product_id,p.product_name,p.mall_product_name,p.option_json,p.unit_price_text,
        p.final_supply_price,p.mall_discount_price,p.discount_price,p.mall_sale_price,p.glomart_code,
        c.gm_code,c.unit_rule_qty,c.unit_rule_unit
      FROM gm_product p
      JOIN gm_category c ON c.gm_code=split_part(COALESCE(p.glomart_code,''),'|',1)
      WHERE COALESCE(c.unit_rule_qty,0)>0 AND COALESCE(c.unit_rule_unit,'')<>''
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
      const x=calculate({ruleQty:p.unit_rule_qty,ruleUnit:p.unit_rule_unit,price:productPrice(p),unitPriceText:p.unit_price_text,texts:[p.product_name,p.mall_product_name,JSON.stringify(p.option_json||'')]});
      if(x.ok)out.product_ok++;
      if(apply){
        await db.query(`UPDATE gm_product SET unit_price_value=$2,unit_base_qty=$3,unit_base_unit=$4,total_unit_qty=$5,total_unit_unit=$6,unit_calc_basis=$7,updated_at=NOW() WHERE product_uid=$1`,[p.product_uid,x.ok?x.unit_price_value:null,p.unit_rule_qty,normUnit(p.unit_rule_unit),x.ok?x.total_unit_qty:null,x.ok?x.total_unit_unit:null,x.ok?x.unit_calc_basis:x.reason]);
      }
      const options=optionMap.get(String(p.mall_code)+'\u0001'+String(p.product_id))||[];
      for(const o of options){
        out.options++;
        const ox=calculate({ruleQty:p.unit_rule_qty,ruleUnit:p.unit_rule_unit,price:productPrice(o),texts:[o.option_name,p.product_name,p.mall_product_name]});
        if(ox.ok)out.option_ok++;
        if(apply)await db.query(`UPDATE gm_product_option SET unit_price_value=$3,unit_base_qty=$4,unit_base_unit=$5,total_unit_qty=$6,total_unit_unit=$7,unit_calc_basis=$8,updated_at=NOW() WHERE mall_code=$1 AND pi_ii_vi=$2`,[o.mall_code,o.pi_ii_vi,ox.ok?ox.unit_price_value:null,p.unit_rule_qty,normUnit(p.unit_rule_unit),ox.ok?ox.total_unit_qty:null,ox.ok?ox.total_unit_unit:null,ox.ok?ox.unit_calc_basis:ox.reason]);
      }
    }
    lastUid=String(products[products.length-1].product_uid||'');
    if(products.length<pageSize)break;
  }
  return out;
}
module.exports={calculate,recalcProductUnitByUid,recalcCategory,normUnit,firstGlomartCode,findRuleByGmCode};
