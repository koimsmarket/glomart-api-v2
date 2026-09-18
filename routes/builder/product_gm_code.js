// GM_BUILDER_PRODUCT_GLOMART_CODE_V002
// Builder-only category reconciliation.
// Purpose: derive gm_product.glomart_code from gm_category using exact Coupang-code
// mappings first, then exact/unique category-keyword mappings.
// Existing non-empty glomart_code is never overwritten.
'use strict';
const express=require('express');
const router=express.Router();
const {dbFrom,ok,fail}=require('./core');

const GM_CODE_RE=/^[A-Z]{2}-\d{2}-\d{3}-\d{4}-\d{4}-\d{4}$/i;
const APPLY_BATCH=250;

function norm(v){
  return String(v==null?'':v).normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
}
function raw(v){return String(v==null?'':v).trim();}
function addMulti(map,key,row){
  if(!key)return;
  let a=map.get(key); if(!a){a=[];map.set(key,a);} 
  if(!a.some(x=>x.gm_code===row.gm_code)) a.push(row);
}
function splitKeyword(v){
  const s=raw(v); if(!s)return [];
  const out=[norm(s)];
  for(const p of s.split(/[,;\n\r|]+/g)){const n=norm(p);if(n)out.push(n);}
  return [...new Set(out.filter(Boolean))];
}
async function loadMaps(db){
  const r=await db.query(`SELECT gm_code,cp_code,depth,sort_order,name_ko,keyword,keyword_seed,display_yn FROM gm_category WHERE COALESCE(gm_code,'')<>''`);
  const gm=new Map(), cp=new Map(), full=new Map(), token=new Map();
  for(const x of r.rows){
    const row={gm_code:raw(x.gm_code),cp_code:raw(x.cp_code),depth:Number(x.depth||0),sort_order:Number(x.sort_order||0),name_ko:raw(x.name_ko)};
    gm.set(norm(row.gm_code),row);
    if(row.cp_code) addMulti(cp,norm(row.cp_code),row);
    for(const source of [x.keyword,x.keyword_seed]){
      const sourceNorm=norm(source); if(sourceNorm)addMulti(full,sourceNorm,row);
      for(const k of splitKeyword(source)) addMulti(token,k,row);
    }
  }
  return {gm,cp,full,token,category_count:r.rows.length};
}
function uniqueHit(map,value){
  const k=norm(value); if(!k)return null;
  const a=map.get(k)||[];
  if(a.length===1)return {row:a[0],ambiguous:false,count:1,key:k};
  if(a.length>1)return {row:null,ambiguous:true,count:a.length,key:k};
  return null;
}
function classify(p,m){
  const directSources=[['cp_fix_code',p.cp_fix_code],['cp_selected_code',p.cp_selected_code],['category_code',p.category_code]];
  for(const [field,v] of directSources){
    const s=raw(v); if(!s || !GM_CODE_RE.test(s))continue;
    const hit=m.gm.get(norm(s)); if(hit)return {gm_code:hit.gm_code,match_by:'DIRECT_GM_CODE',source_field:field,source_value:s,category_name:hit.name_ko};
  }
  const cpSources=[['cp_fix_code',p.cp_fix_code],['cp_selected_code',p.cp_selected_code],['category_code',p.category_code]];
  let firstAmbiguous=null;
  for(const [field,v] of cpSources){
    const s=raw(v); if(!s || GM_CODE_RE.test(s))continue;
    const h=uniqueHit(m.cp,s);
    if(h && h.row)return {gm_code:h.row.gm_code,match_by:'CP_CODE',source_field:field,source_value:s,category_name:h.row.name_ko};
    if(h && h.ambiguous && !firstAmbiguous) firstAmbiguous={match_by:'AMBIGUOUS_CP_CODE',source_field:field,source_value:s,candidate_count:h.count};
  }
  const kwSources=[['category_keyword',p.category_keyword],['keyword',p.keyword],['cp_selected_code',p.cp_selected_code],['cp_fix_code',p.cp_fix_code],['category_code',p.category_code]];
  for(const [field,v] of kwSources){
    const s=raw(v); if(!s || GM_CODE_RE.test(s))continue;
    const h=uniqueHit(m.full,s);
    if(h && h.row)return {gm_code:h.row.gm_code,match_by:'KEYWORD_FULL_EXACT',source_field:field,source_value:s,category_name:h.row.name_ko};
    if(h && h.ambiguous && !firstAmbiguous) firstAmbiguous={match_by:'AMBIGUOUS_KEYWORD_FULL',source_field:field,source_value:s,candidate_count:h.count};
  }
  for(const [field,v] of kwSources){
    const s=raw(v); if(!s || GM_CODE_RE.test(s))continue;
    const h=uniqueHit(m.token,s);
    if(h && h.row)return {gm_code:h.row.gm_code,match_by:'KEYWORD_TOKEN_UNIQUE',source_field:field,source_value:s,category_name:h.row.name_ko};
    if(h && h.ambiguous && !firstAmbiguous) firstAmbiguous={match_by:'AMBIGUOUS_KEYWORD_TOKEN',source_field:field,source_value:s,candidate_count:h.count};
  }
  if(firstAmbiguous)return {...firstAmbiguous,gm_code:'',category_name:''};
  return {gm_code:'',match_by:'NO_MATCH',source_field:'',source_value:'',category_name:''};
}
async function status(db){
  const r=await db.query(`SELECT COUNT(*)::int total, COUNT(*) FILTER(WHERE COALESCE(glomart_code,'')<>'')::int filled, COUNT(*) FILTER(WHERE COALESCE(glomart_code,'')='')::int empty FROM gm_product`);
  return {...(r.rows[0]||{})};
}
async function loadProducts(db,limit){
  const params=[]; let lim='';
  if(limit){params.push(limit);lim=' LIMIT $1';}
  const r=await db.query(`SELECT product_uid,glomart_code,cp_selected_code,cp_fix_code,category_code,category_keyword,keyword,product_name,mall_code FROM gm_product WHERE COALESCE(glomart_code,'')='' ORDER BY product_uid${lim}`,params);
  return r.rows;
}
function summarize(items){
  const s={matched:0,unmatched:0,ambiguous:0,by:{}};
  for(const x of items){s.by[x.match_by]=(s.by[x.match_by]||0)+1;if(x.gm_code)s.matched++;else{s.unmatched++;if(String(x.match_by).startsWith('AMBIGUOUS_'))s.ambiguous++;}}
  return s;
}
router.get('/api/gm/builder/product-gm-code/status',async(req,res)=>{
  const db=dbFrom(req);if(!db)return fail(res,500,'DB_NOT_READY');
  try{ok(res,{action:'product-gm-code.status',...(await status(db))});}catch(e){fail(res,500,'PRODUCT_GM_CODE_STATUS_FAILED',{detail:String(e&&e.message||e)});}
});
router.get('/api/gm/builder/product-gm-code/preview',async(req,res)=>{
  const db=dbFrom(req);if(!db)return fail(res,500,'DB_NOT_READY');
  try{
    const limit=Math.min(Math.max(Number(req.query.limit||300),1),2000);
    const maps=await loadMaps(db), products=await loadProducts(db,limit);
    const items=products.map(p=>({product_uid:p.product_uid,product_name:p.product_name,mall_code:p.mall_code,cp_selected_code:p.cp_selected_code,cp_fix_code:p.cp_fix_code,category_code:p.category_code,category_keyword:p.category_keyword,keyword:p.keyword,...classify(p,maps)}));
    ok(res,{action:'product-gm-code.preview',limit,category_count:maps.category_count,summary:summarize(items),items});
  }catch(e){fail(res,500,'PRODUCT_GM_CODE_PREVIEW_FAILED',{detail:String(e&&e.message||e)});}
});
router.post('/api/gm/builder/product-gm-code/apply',async(req,res)=>{
  const db=dbFrom(req);if(!db)return fail(res,500,'DB_NOT_READY');
  if(String(req.query.confirm||req.body&&req.body.confirm||'').toUpperCase()!=='YES')return fail(res,400,'CONFIRM_REQUIRED',{hint:'confirm=YES'});
  let client=null,release=false;
  try{
    const maps=await loadMaps(db), products=await loadProducts(db,0);
    const matched=[]; const classified=[];
    for(const p of products){const c=classify(p,maps);classified.push(c);if(c.gm_code)matched.push({product_uid:p.product_uid,...c});}
    client=typeof db.connect==='function'?await db.connect():db;release=client!==db&&typeof client.release==='function';
    await client.query('BEGIN');
    let updated=0;
    for(let i=0;i<matched.length;i+=APPLY_BATCH){
      const batch=matched.slice(i,i+APPLY_BATCH); const vals=[]; const rows=[]; let n=1;
      for(const x of batch){rows.push(`($${n++}::text,$${n++}::text)`);vals.push(x.product_uid,x.gm_code);}
      const q=await client.query(`UPDATE gm_product p SET glomart_code=v.gm_code, updated_at=COALESCE(p.updated_at,NOW()) FROM (VALUES ${rows.join(',')}) AS v(product_uid,gm_code) WHERE p.product_uid=v.product_uid AND COALESCE(p.glomart_code,'')='' `,vals);
      updated+=q.rowCount||0;
    }
    await client.query('COMMIT');
    const summary=summarize(classified);
    console.log(`[GM_PRODUCT_GLOMART_CODE_V002] apply scanned=${products.length} matched=${summary.matched} ambiguous=${summary.ambiguous} unmatched=${summary.unmatched} updated=${updated} by=${JSON.stringify(summary.by)}`);
    ok(res,{action:'product-gm-code.apply',category_count:maps.category_count,scanned:products.length,updated,summary});
  }catch(e){try{if(client)await client.query('ROLLBACK');}catch(_){} fail(res,500,'PRODUCT_GM_CODE_APPLY_FAILED',{detail:String(e&&e.message||e)});
  }finally{if(release)client.release();}
});
module.exports=router;
