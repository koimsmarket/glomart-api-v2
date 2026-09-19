'use strict';
// GM_CATEGORY_V035_UNIT_PRICE_ENGINE
const W={mg:.001,g:1,kg:1000}; const V={ml:1,l:1000};
const CNT=new Set(['개','매','롤','정','캡슐','포','병','캔','켤레','장']);
const c=v=>String(v==null?'':v).replace(/\s+/g,' ').trim();
const num=v=>{const n=Number(String(v==null?'':v).replace(/,/g,''));return Number.isFinite(n)?n:null;};
function unit(u){u=c(u).toLowerCase().replace(/㎖/g,'ml'); return ({킬로그램:'kg',그램:'g',리터:'l',밀리리터:'ml',개입:'개',입:'개',족:'켤레',권:'장'})[u]||u;}
function fam(u){u=unit(u); if(W[u]!=null)return'W'; if(V[u]!=null)return'V'; if(CNT.has(u))return'C'; return'';}
function base(q,u){q=num(q);u=unit(u);if(q==null)return null;if(W[u]!=null)return q*W[u];if(V[u]!=null)return q*V[u];if(CNT.has(u))return q;return null;}
function compatible(a,b){a=unit(a);b=unit(b);const fa=fam(a),fb=fam(b);return !!fa&&fa===fb&&(fa!=='C'||a===b||a==='개'||b==='개');}
function parseExplicit(text){const r=/(\d+(?:\.\d+)?)\s*(kg|킬로그램|g|그램|l|리터|ml|㎖|밀리리터|개입|개|매|롤|정|캡슐|포|병|캔|켤레|족|장|권)\s*당\s*([0-9,]+(?:\.\d+)?)\s*원?/ig;let m,last=null;while((m=r.exec(c(text))))last={qty:num(m[1]),u:unit(m[2]),price:num(m[3]),raw:m[0]};return last;}
function parseTotal(text,ruleUnit){text=c(text);const ru=unit(ruleUnit);const hits=[];let m;
  const direct=/(\d+(?:\.\d+)?)\s*(kg|킬로그램|g|그램|l|리터|ml|㎖|밀리리터|개입|개|매|롤|정|캡슐|포|병|캔|켤레|족|장|권)\s*(?:[xX×*]\s*(\d+(?:\.\d+)?))?/ig;
  while((m=direct.exec(text))){const q=num(m[1]),u=unit(m[2]),mul=num(m[3])||1;if(q&&compatible(u,ru))hits.push({q:q*mul,u,raw:m[0],score:(m[3]?30:10)+(u===ru?5:0)});}
  const comma=/(\d+(?:\.\d+)?)\s*(kg|g|l|ml|㎖)\s*[,/]?\s*(\d+(?:\.\d+)?)\s*(?:개|봉|팩|병|캔|포)/ig;
  while((m=comma.exec(text))){const q=num(m[1]),u=unit(m[2]),mul=num(m[3]);if(q&&mul&&compatible(u,ru))hits.push({q:q*mul,u,raw:m[0],score:40});}
  const reverse=/(\d+(?:\.\d+)?)\s*(?:개|봉|팩|병|캔|포)\s*(?:[xX×*]\s*)?(\d+(?:\.\d+)?)\s*(kg|g|l|ml|㎖)/ig;
  while((m=reverse.exec(text))){const mul=num(m[1]),q=num(m[2]),u=unit(m[3]);if(q&&mul&&compatible(u,ru))hits.push({q:q*mul,u,raw:m[0],score:40});}
  if(!hits.length)return null;hits.sort((a,b)=>b.score-a.score);return hits[0];
}
function calc({ruleQty,ruleUnit,price,unitPriceText='',texts=[]}){const rq=num(ruleQty),ru=unit(ruleUnit),p=num(price);if(!rq||!ru)return {ok:false,reason:'NO_RULE'};const target=base(rq,ru);if(!target)return {ok:false,reason:'BAD_RULE'};
  const explicit=parseExplicit(unitPriceText); const total=parseTotal(texts.join(' '),ru);
  if(explicit&&compatible(explicit.u,ru)){const sb=base(explicit.qty,explicit.u);return {ok:true,unit_price_value:explicit.price*target/sb,unit_base_qty:rq,unit_base_unit:ru,total_unit_qty:total?base(total.q,total.u):null,total_unit_unit:total?(fam(ru)==='W'?'g':fam(ru)==='V'?'ml':unit(total.u)):null,unit_calc_basis:`UNIT_TEXT:${explicit.raw}${total?` | TOTAL:${total.raw}`:''}`};}
  if(total&&p>0){const tb=base(total.q,total.u);return {ok:true,unit_price_value:p*target/tb,unit_base_qty:rq,unit_base_unit:ru,total_unit_qty:tb,total_unit_unit:fam(ru)==='W'?'g':fam(ru)==='V'?'ml':unit(total.u),unit_calc_basis:`PARSE:${total.raw} => ${tb}${fam(ru)==='W'?'g':fam(ru)==='V'?'ml':unit(total.u)}`};}
  return {ok:false,reason:'UNIT_PARSE_FAILED'};
}
async function findRule(db,keyword){const r=await db.query(`SELECT gm_code,keyword,name_ko,unit_rule_qty,unit_rule_unit FROM gm_category WHERE COALESCE(unit_rule_qty,0)>0 AND COALESCE(unit_rule_unit,'')<>'' AND (keyword=$1 OR name_ko=$1) ORDER BY CASE WHEN keyword=$1 THEN 0 ELSE 1 END, depth DESC NULLS LAST LIMIT 1`,[c(keyword)]);return r.rows[0]||null;}
async function recalcProductUnitByUid(db,uid){const pr=await db.query(`SELECT * FROM gm_product WHERE product_uid=$1 LIMIT 1`,[uid]);if(!pr.rows.length)return {ok:false,reason:'NO_PRODUCT'};const p=pr.rows[0],rule=await findRule(db,p.category_keyword||p.keyword);if(!rule)return {ok:false,reason:'NO_RULE'};const price=p.final_supply_price||p.mall_discount_price||p.discount_price||p.mall_sale_price;const x=calc({ruleQty:rule.unit_rule_qty,ruleUnit:rule.unit_rule_unit,price,unitPriceText:p.unit_price_text,texts:[p.product_name,p.mall_product_name,JSON.stringify(p.option_json||'')]});
  await db.query(`UPDATE gm_product SET unit_price_value=$2,unit_base_qty=$3,unit_base_unit=$4,total_unit_qty=$5,total_unit_unit=$6,unit_calc_basis=$7,updated_at=NOW() WHERE product_uid=$1`,[uid,x.ok?x.unit_price_value:null,rule.unit_rule_qty,unit(rule.unit_rule_unit),x.ok?x.total_unit_qty:null,x.ok?x.total_unit_unit:null,x.ok?x.unit_calc_basis:x.reason]);
  const or=await db.query(`SELECT * FROM gm_product_option WHERE mall_code=$1 AND product_id=$2`,[p.mall_code,p.product_id]);let options=0,ok=0;
  for(const o of or.rows){options++;const op=o.final_supply_price||o.mall_discount_price||o.discount_price||o.mall_sale_price;const ox=calc({ruleQty:rule.unit_rule_qty,ruleUnit:rule.unit_rule_unit,price:op,texts:[o.option_name,p.product_name]});await db.query(`UPDATE gm_product_option SET unit_price_value=$3,unit_base_qty=$4,unit_base_unit=$5,total_unit_qty=$6,total_unit_unit=$7,unit_calc_basis=$8,updated_at=NOW() WHERE mall_code=$1 AND pi_ii_vi=$2`,[o.mall_code,o.pi_ii_vi,ox.ok?ox.unit_price_value:null,rule.unit_rule_qty,unit(rule.unit_rule_unit),ox.ok?ox.total_unit_qty:null,ox.ok?ox.total_unit_unit:null,ox.ok?ox.unit_calc_basis:ox.reason]);if(ox.ok)ok++;}
  return {ok:x.ok,product:x.ok,options,option_ok:ok,rule:{qty:rule.unit_rule_qty,unit:rule.unit_rule_unit}};
}
async function recalcCategory(db,{gmCode='',all=false,apply=false}){let rr;if(all)rr=await db.query(`SELECT gm_code,keyword,name_ko,unit_rule_qty,unit_rule_unit FROM gm_category WHERE COALESCE(unit_rule_qty,0)>0 AND COALESCE(unit_rule_unit,'')<>'' ORDER BY gm_code`);else rr=await db.query(`SELECT gm_code,keyword,name_ko,unit_rule_qty,unit_rule_unit FROM gm_category WHERE gm_code=$1`,[gmCode]);const out={rules:rr.rowCount,products:0,product_ok:0,options:0,option_ok:0,apply};const seen=new Set();for(const r of rr.rows){const kw=c(r.keyword)||c(r.name_ko);if(!kw)continue;const ps=await db.query(`SELECT product_uid FROM gm_product WHERE category_keyword=$1`,[kw]);for(const p of ps.rows){if(seen.has(p.product_uid))continue;seen.add(p.product_uid);out.products++;if(apply){const z=await recalcProductUnitByUid(db,p.product_uid);if(z.product)out.product_ok++;out.options+=z.options||0;out.option_ok+=z.option_ok||0;}else{const z=await db.query(`SELECT p.*, (SELECT count(*) FROM gm_product_option o WHERE o.mall_code=p.mall_code AND o.product_id=p.product_id) option_count2 FROM gm_product p WHERE p.product_uid=$1`,[p.product_uid]);if(z.rows.length){const x=z.rows[0];const cx=calc({ruleQty:r.unit_rule_qty,ruleUnit:r.unit_rule_unit,price:x.final_supply_price||x.mall_discount_price||x.discount_price||x.mall_sale_price,unitPriceText:x.unit_price_text,texts:[x.product_name,x.mall_product_name,JSON.stringify(x.option_json||'')]});if(cx.ok)out.product_ok++;out.options+=Number(x.option_count2||0);}}}}return out;}
module.exports={calc,recalcProductUnitByUid,recalcCategory};
