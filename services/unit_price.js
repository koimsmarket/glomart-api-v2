'use strict';
// GM_CATEGORY_V036_UNIT_PRICE_ENGINE
// One category keyword = one comparison unit. Product and option use the same calculator.
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

function parseExplicitUnitPrice(text){
  const re=/(\d+(?:\.\d+)?)\s*(kg|킬로그램|g|그램|l|리터|ml|㎖|밀리리터|개입|개|매|롤|정|캡슐|포|병|캔|켤레|족|장|권)\s*당\s*([0-9,]+(?:\.\d+)?)\s*원?/ig;
  let m,last=null;
  while((m=re.exec(clean(text)))) last={qty:number(m[1]),unit:normUnit(m[2]),price:number(m[3]),raw:m[0]};
  return last;
}
function parseTotal(text,ruleUnit){
  text=clean(text); const ru=normUnit(ruleUnit); const hits=[]; let m;
  const direct=/(\d+(?:\.\d+)?)\s*(kg|킬로그램|g|그램|l|리터|ml|㎖|밀리리터|개입|개|매|롤|정|캡슐|포|병|캔|켤레|족|장|권)\s*(?:[xX×*]\s*(\d+(?:\.\d+)?))?/ig;
  while((m=direct.exec(text))){const q=number(m[1]),u=normUnit(m[2]),mul=number(m[3])||1;if(q&&compatible(u,ru))hits.push({qty:q*mul,unit:u,raw:m[0],score:(m[3]?50:10)+(u===ru?5:0)});}
  const qtyPack=/(\d+(?:\.\d+)?)\s*(kg|g|l|ml|㎖)\s*[,/]?\s*(\d+(?:\.\d+)?)\s*(?:개|봉|팩|병|캔|포)/ig;
  while((m=qtyPack.exec(text))){const q=number(m[1]),u=normUnit(m[2]),mul=number(m[3]);if(q&&mul&&compatible(u,ru))hits.push({qty:q*mul,unit:u,raw:m[0],score:70});}
  const reverse=/(\d+(?:\.\d+)?)\s*(?:개|봉|팩|병|캔|포)\s*(?:[xX×*]\s*)?(\d+(?:\.\d+)?)\s*(kg|g|l|ml|㎖)/ig;
  while((m=reverse.exec(text))){const mul=number(m[1]),q=number(m[2]),u=normUnit(m[3]);if(q&&mul&&compatible(u,ru))hits.push({qty:q*mul,unit:u,raw:m[0],score:70});}
  // 500g+500g / 1L+500ml style, only when all terms are same physical family as rule.
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
      return {ok:true,unit_price_value:explicit.price*targetBase/sourceBase,unit_base_qty:rq,unit_base_unit:ru,total_unit_qty:totalBase,total_unit_unit:totalBase==null?null:canonicalBaseUnit(ru),unit_calc_basis:`UNIT_TEXT:${explicit.raw}${total?` | TOTAL:${total.raw}`:''}`};
    }
  }
  if(total&&p>0){
    const totalBase=total.alreadyBase?total.qty:baseQty(total.qty,total.unit);
    if(totalBase>0)return {ok:true,unit_price_value:p*targetBase/totalBase,unit_base_qty:rq,unit_base_unit:ru,total_unit_qty:totalBase,total_unit_unit:canonicalBaseUnit(ru),unit_calc_basis:`PARSE:${total.raw} => ${totalBase}${canonicalBaseUnit(ru)}`};
  }
  return {ok:false,reason:'UNIT_PARSE_FAILED'};
}
async function findRule(db,keyword){
  const k=clean(keyword); if(!k)return null;
  const r=await db.query(`SELECT gm_code,keyword,name_ko,unit_rule_qty,unit_rule_unit FROM gm_category WHERE COALESCE(unit_rule_qty,0)>0 AND COALESCE(unit_rule_unit,'')<>'' AND (keyword=$1 OR name_ko=$1) ORDER BY CASE WHEN keyword=$1 THEN 0 ELSE 1 END, depth DESC NULLS LAST LIMIT 1`,[k]);
  return r.rows[0]||null;
}
function productPrice(p){return p.final_supply_price||p.mall_discount_price||p.discount_price||p.mall_sale_price||0;}
async function recalcProductUnitByUid(db,uid){
  const pr=await db.query(`SELECT * FROM gm_product WHERE product_uid=$1 LIMIT 1`,[uid]);
  if(!pr.rows.length)return {ok:false,reason:'NO_PRODUCT'};
  const p=pr.rows[0], rule=await findRule(db,p.category_keyword||p.keyword);
  if(!rule)return {ok:false,reason:'NO_RULE'};
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
  return {ok:x.ok,product:x.ok,options,option_ok,rule:{gm_code:rule.gm_code,qty:rule.unit_rule_qty,unit:normUnit(rule.unit_rule_unit)}};
}
async function recalcCategory(db,{gmCode='',all=false,apply=false}){
  let rr;
  if(all) rr=await db.query(`SELECT gm_code,keyword,name_ko,unit_rule_qty,unit_rule_unit FROM gm_category WHERE COALESCE(unit_rule_qty,0)>0 AND COALESCE(unit_rule_unit,'')<>'' ORDER BY gm_code`);
  else rr=await db.query(`SELECT gm_code,keyword,name_ko,unit_rule_qty,unit_rule_unit FROM gm_category WHERE gm_code=$1`,[gmCode]);
  const out={rules:rr.rowCount,products:0,product_ok:0,options:0,option_ok:0,apply}; const seen=new Set();
  for(const r of rr.rows){
    const kw=clean(r.keyword)||clean(r.name_ko); if(!kw)continue;
    const ps=await db.query(`SELECT product_uid,mall_code,product_id,product_name,mall_product_name,option_json,unit_price_text,final_supply_price,mall_discount_price,discount_price,mall_sale_price FROM gm_product WHERE category_keyword=$1`,[kw]);
    for(const p of ps.rows){
      if(seen.has(p.product_uid))continue; seen.add(p.product_uid); out.products++;
      if(apply){const z=await recalcProductUnitByUid(db,p.product_uid);if(z.product)out.product_ok++;out.options+=z.options||0;out.option_ok+=z.option_ok||0;}
      else{
        const x=calculate({ruleQty:r.unit_rule_qty,ruleUnit:r.unit_rule_unit,price:productPrice(p),unitPriceText:p.unit_price_text,texts:[p.product_name,p.mall_product_name,JSON.stringify(p.option_json||'')]}); if(x.ok)out.product_ok++;
        const oc=await db.query(`SELECT count(*)::int AS n FROM gm_product_option WHERE mall_code=$1 AND product_id=$2`,[p.mall_code,p.product_id]); out.options+=Number(oc.rows[0]&&oc.rows[0].n||0);
      }
    }
  }
  return out;
}
module.exports={calculate,recalcProductUnitByUid,recalcCategory,normUnit};
