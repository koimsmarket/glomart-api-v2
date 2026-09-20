'use strict';
// GM_PRODUCT_GLOMART_CODE_V012_CLEANUP_OPTION_KEY_FIX
const express=require('express');
const router=express.Router();
const {dbFrom,ok,fail}=require('./core');
const {
  MULTI_MAX, raw, loadMaps, loadHistory, classify, invalidateContext
}=require('../../services/glomart_code');
const {normalizeProductKeywords}=require('../../services/product_keyword_normalizer');

const APPLY_BATCH=250;
function statNorm(v){return String(v==null?'':v).normalize('NFKC').trim().toLowerCase().replace(/\s+/g,'');}
async function status(db){const r=await db.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE COALESCE(glomart_code,'')<>'')::int filled,COUNT(*) FILTER(WHERE COALESCE(glomart_code,'')='')::int empty,COUNT(*) FILTER(WHERE POSITION('|' IN COALESCE(glomart_code,''))>0)::int multi FROM gm_product`);return {...(r.rows[0]||{})};}
async function loadProducts(db,limit){const params=[];let lim='';if(limit){params.push(limit);lim=' LIMIT $1';}const r=await db.query(`SELECT product_uid,glomart_code,cp_selected_code,cp_fix_code,category_code,category_keyword,keyword,product_name,mall_code,mall_category FROM gm_product WHERE COALESCE(glomart_code,'')='' ORDER BY product_uid${lim}`,params);return r.rows;}
function summarize(items){const s={matched:0,matched_single:0,matched_multi:0,unmatched:0,ambiguous:0,by:{}};for(const x of items){s.by[x.match_by]=(s.by[x.match_by]||0)+1;if(x.gm_code){s.matched++;if(String(x.gm_code).includes('|'))s.matched_multi++;else s.matched_single++;}else{s.unmatched++;if(String(x.match_by).startsWith('AMBIGUOUS_'))s.ambiguous++;}}return s;}

function protectState(row){
  const orderCounter=Number(row.order_count||0)>0 || Number(row.sales_qty||0)>0 || Number(row.sales_amount||0)>0;
  const basketCounter=Number(row.cart_count||0)>0;
  const wishCounter=Number(row.wish_count||0)>0;
  const orderRef=!!row.order_exists;
  const basketRef=!!row.basket_exists;
  const protectedYn=orderCounter||basketCounter||wishCounter||orderRef||basketRef;
  return {protected:protectedYn,order:orderCounter||orderRef,basket:basketCounter||basketRef,wish:wishCounter,sales:orderCounter};
}
async function loadUnclassifiedKeywordProducts(db){
  const r=await db.query(`
    SELECT p.product_uid,p.product_name,p.category_keyword,p.keyword,p.mall_code,p.pi_ii_vi,
           COALESCE(p.order_count,0)::int AS order_count,
           COALESCE(p.sales_qty,0)::numeric AS sales_qty,
           COALESCE(p.sales_amount,0)::numeric AS sales_amount,
           COALESCE(p.cart_count,0)::int AS cart_count,
           COALESCE(p.wish_count,0)::int AS wish_count,
           EXISTS(SELECT 1 FROM gm_basket b WHERE b.mall_code=p.mall_code AND b.pi_ii_vi=p.pi_ii_vi) AS basket_exists,
           EXISTS(SELECT 1 FROM gm_order_item oi WHERE oi.source_uid=p.product_uid OR (oi.mall_code=p.mall_code AND oi.pi_ii_vi=p.pi_ii_vi)) AS order_exists
      FROM gm_product p
     WHERE COALESCE(p.glomart_code,'')=''
       AND (COALESCE(p.category_keyword,'')<>'' OR COALESCE(p.keyword,'')<>'')
     ORDER BY p.product_uid`);
  return r.rows;
}
async function loadCleanupCandidates(db,limit){
  const rows=await loadUnclassifiedKeywordProducts(db);
  const grouped=new Map();
  function add(field,value,row){
    const v=raw(value); if(!v)return;
    let x=grouped.get(v);
    if(!x){x={value:v,fields:new Set(),products:new Map(),samples:[]};grouped.set(v,x);}
    x.fields.add(field); x.products.set(raw(row.product_uid),row);
    if(x.samples.length<3&&row.product_name)x.samples.push(raw(row.product_name));
  }
  for(const row of rows){add('category_keyword',row.category_keyword,row);add('keyword',row.keyword,row);}
  const norms=[...new Set([...grouped.values()].map(x=>statNorm(x.value)).filter(Boolean))];
  const stats=new Map();
  if(norms.length){
    const sr=await db.query(`SELECT keyword_normalized,COALESCE(SUM(search_count),0)::int AS search_count,MIN(first_search_at) AS first_search_at,MAX(last_search_at) AS last_search_at FROM gm_search_keyword_stat WHERE keyword_normalized=ANY($1::text[]) GROUP BY keyword_normalized`,[norms]);
    for(const row of sr.rows)stats.set(raw(row.keyword_normalized),row);
  }
  const out=[];
  for(const x of grouped.values()){
    const st=stats.get(statNorm(x.value))||{}; const sc=Number(st.search_count||0); if(sc>1)continue;
    let deletable=0,protectedCount=0,protectedOrder=0,protectedBasket=0,protectedWish=0;
    for(const row of x.products.values()){
      const ps=protectState(row);
      if(ps.protected){protectedCount++;if(ps.order)protectedOrder++;if(ps.basket)protectedBasket++;if(ps.wish)protectedWish++;}
      else deletable++;
    }
    out.push({value:x.value,fields:[...x.fields].sort(),product_count:x.products.size,deletable_count:deletable,protected_count:protectedCount,protected_order:protectedOrder,protected_basket:protectedBasket,protected_wish:protectedWish,search_count:sc,first_search_at:st.first_search_at||null,last_search_at:st.last_search_at||null,samples:x.samples});
  }
  out.sort((a,b)=>a.search_count-b.search_count||b.deletable_count-a.deletable_count||b.product_count-a.product_count||a.value.localeCompare(b.value,'ko'));
  return out.slice(0,Math.max(1,Math.min(Number(limit||500),2000)));
}
function selectedFieldMaps(items){
  const cat=new Set(),kw=new Set();
  for(const item of items){const value=raw(item&&item.value);if(!value)continue;const fields=Array.isArray(item&&item.fields)?item.fields:[];if(fields.includes('category_keyword'))cat.add(value);if(fields.includes('keyword'))kw.add(value);}
  return {cat:[...cat],kw:[...kw]};
}
async function tableExists(db,name){const r=await db.query('SELECT to_regclass($1) AS t',[`public.${name}`]);return !!(r.rows[0]&&r.rows[0].t);}
router.get('/api/gm/builder/product-gm-code/status',async(req,res)=>{const db=dbFrom(req);if(!db)return fail(res,500,'DB_NOT_READY');try{ok(res,{action:'product-gm-code.status',...(await status(db))});}catch(e){fail(res,500,'PRODUCT_GM_CODE_STATUS_FAILED',{detail:String(e&&e.message||e)});}});
router.get('/api/gm/builder/product-gm-code/preview',async(req,res)=>{const db=dbFrom(req);if(!db)return fail(res,500,'DB_NOT_READY');try{const limit=Math.min(Math.max(Number(req.query.limit||300),1),2000);const maps=await loadMaps(db),history=await loadHistory(db,maps),products=await loadProducts(db,limit);const items=products.map(p=>({product_uid:p.product_uid,product_name:p.product_name,mall_code:p.mall_code,mall_category:p.mall_category,cp_selected_code:p.cp_selected_code,cp_fix_code:p.cp_fix_code,category_code:p.category_code,category_keyword:p.category_keyword,keyword:p.keyword,...classify(p,maps,history)}));ok(res,{action:'product-gm-code.preview',limit,category_count:maps.category_count,history:{learned:history.learned,skipped_multi:history.skippedMulti,skipped_unknown:history.skippedUnknown},summary:summarize(items),items});}catch(e){fail(res,500,'PRODUCT_GM_CODE_PREVIEW_FAILED',{detail:String(e&&e.message||e)});}});
router.post('/api/gm/builder/product-gm-code/normalize-keywords',async(req,res)=>{const db=dbFrom(req);if(!db)return fail(res,500,'DB_NOT_READY');try{const normalization=await normalizeProductKeywords(db,{apply:true});invalidateContext(db);ok(res,{action:'product-gm-code.normalize-keywords',normalization});}catch(e){fail(res,500,'PRODUCT_KEYWORD_NORMALIZE_FAILED',{detail:String(e&&e.message||e)});}});
router.get('/api/gm/builder/product-gm-code/analyze',async(req,res)=>{const db=dbFrom(req);if(!db)return fail(res,500,'DB_NOT_READY');try{const normalization=await normalizeProductKeywords(db,{apply:true});invalidateContext(db);const maps=await loadMaps(db),history=await loadHistory(db,maps),products=await loadProducts(db,0);const classified=products.map(p=>classify(p,maps,history));ok(res,{action:'product-gm-code.analyze',normalization,category_count:maps.category_count,history:{learned:history.learned,skipped_multi:history.skippedMulti,skipped_unknown:history.skippedUnknown},scanned:products.length,summary:summarize(classified),multi_max:MULTI_MAX});}catch(e){fail(res,500,'PRODUCT_GM_CODE_ANALYZE_FAILED',{detail:String(e&&e.message||e)});}});
router.post('/api/gm/builder/product-gm-code/apply',async(req,res)=>{const db=dbFrom(req);if(!db)return fail(res,500,'DB_NOT_READY');if(String(req.query.confirm||req.body&&req.body.confirm||'').toUpperCase()!=='YES')return fail(res,400,'CONFIRM_REQUIRED',{hint:'confirm=YES'});let client=null,release=false;try{const normalization=await normalizeProductKeywords(db,{apply:true});invalidateContext(db);const maps=await loadMaps(db),history=await loadHistory(db,maps),products=await loadProducts(db,0);const matched=[],classified=[];for(const p of products){const c=classify(p,maps,history);classified.push(c);if(c.gm_code)matched.push({product_uid:p.product_uid,...c});}client=typeof db.connect==='function'?await db.connect():db;release=client!==db&&typeof client.release==='function';await client.query('BEGIN');let updated=0;for(let i=0;i<matched.length;i+=APPLY_BATCH){const batch=matched.slice(i,i+APPLY_BATCH),vals=[],rows=[];let n=1;for(const x of batch){rows.push(`($${n++}::text,$${n++}::text)`);vals.push(x.product_uid,x.gm_code);}const q=await client.query(`UPDATE gm_product p SET glomart_code=v.gm_code,updated_at=COALESCE(p.updated_at,NOW()) FROM (VALUES ${rows.join(',')}) AS v(product_uid,gm_code) WHERE p.product_uid=v.product_uid AND COALESCE(p.glomart_code,'')=''`,vals);updated+=q.rowCount||0;}await client.query('COMMIT');invalidateContext(db);const summary=summarize(classified);console.log(`[GM_PRODUCT_GLOMART_CODE_V010] apply scanned=${products.length} matched=${summary.matched} single=${summary.matched_single} multi=${summary.matched_multi} ambiguous=${summary.ambiguous} unmatched=${summary.unmatched} updated=${updated} by=${JSON.stringify(summary.by)}`);ok(res,{action:'product-gm-code.apply',normalization,category_count:maps.category_count,history:{learned:history.learned},scanned:products.length,updated,summary});}catch(e){try{if(client)await client.query('ROLLBACK');}catch(_){}fail(res,500,'PRODUCT_GM_CODE_APPLY_FAILED',{detail:String(e&&e.message||e)});}finally{if(release)client.release();}});

router.get('/api/gm/builder/product-gm-code/cleanup-candidates',async(req,res)=>{const db=dbFrom(req);if(!db)return fail(res,500,'DB_NOT_READY');try{const limit=Math.min(Math.max(Number(req.query.limit||500),1),2000);const items=await loadCleanupCandidates(db,limit);ok(res,{action:'product-gm-code.cleanup-candidates',items,count:items.length,rule:'unclassified + search_count<=1; manual keyword selection; order/cart/wish/sales protected'});}catch(e){fail(res,500,'PRODUCT_GM_CODE_CLEANUP_CANDIDATES_FAILED',{detail:String(e&&e.message||e)});}});
router.post('/api/gm/builder/product-gm-code/cleanup-delete',async(req,res)=>{
  const db=dbFrom(req);if(!db)return fail(res,500,'DB_NOT_READY');
  const selected=Array.isArray(req.body&&req.body.items)?req.body.items:[];if(!selected.length)return fail(res,400,'NO_SELECTION');
  const confirmText=String(req.body&&req.body.confirm||'');if(confirmText!=='DELETE UNCLASSIFIED PRODUCTS')return fail(res,400,'CONFIRM_REQUIRED');
  const maps=selectedFieldMaps(selected);if(!maps.cat.length&&!maps.kw.length)return fail(res,400,'NO_VALID_SELECTION');
  let client=null,release=false,inTx=false;
  try{
    client=typeof db.connect==='function'?await db.connect():db;release=client!==db&&typeof client.release==='function';
    await client.query('BEGIN');inTx=true;
    const q=await client.query(`
      SELECT p.product_uid,p.product_name,p.category_keyword,p.keyword,p.mall_code,p.pi_ii_vi,
             COALESCE(p.order_count,0)::int AS order_count,
             COALESCE(p.sales_qty,0)::numeric AS sales_qty,
             COALESCE(p.sales_amount,0)::numeric AS sales_amount,
             COALESCE(p.cart_count,0)::int AS cart_count,
             COALESCE(p.wish_count,0)::int AS wish_count,
             EXISTS(SELECT 1 FROM gm_basket b WHERE b.mall_code=p.mall_code AND b.pi_ii_vi=p.pi_ii_vi) AS basket_exists,
             EXISTS(SELECT 1 FROM gm_order_item oi WHERE oi.source_uid=p.product_uid OR (oi.mall_code=p.mall_code AND oi.pi_ii_vi=p.pi_ii_vi)) AS order_exists
        FROM gm_product p
       WHERE COALESCE(p.glomart_code,'')=''
         AND (($1::text[] <> ARRAY[]::text[] AND p.category_keyword=ANY($1::text[])) OR ($2::text[] <> ARRAY[]::text[] AND p.keyword=ANY($2::text[])))
       FOR UPDATE`,[maps.cat,maps.kw]);
    const deletable=[],protectedRows=[];
    for(const row of q.rows){const ps=protectState(row);if(ps.protected)protectedRows.push({product_uid:row.product_uid,product_name:row.product_name,order:ps.order,basket:ps.basket,wish:ps.wish});else deletable.push(row);}
    const ids=[...new Set(deletable.map(x=>raw(x.product_uid)).filter(Boolean))];
    let vectorDeleted=0,pendingDeleted=0,optionDeleted=0,embeddingDeleted=0,deleted=0;
    if(ids.length){
      if(await tableExists(client,'gm_product_image_vector')){const d=await client.query('DELETE FROM gm_product_image_vector WHERE product_uid=ANY($1::text[])',[ids]);vectorDeleted=d.rowCount||0;}
      if(await tableExists(client,'gm_image_vector_pending')){const d=await client.query('DELETE FROM gm_image_vector_pending WHERE product_uid=ANY($1::text[])',[ids]);pendingDeleted=d.rowCount||0;}
      if(await tableExists(client,'gm_product_image_embedding_v1')){const d=await client.query('DELETE FROM gm_product_image_embedding_v1 WHERE product_uid=ANY($1::text[])',[ids]);embeddingDeleted=d.rowCount||0;}
      if(await tableExists(client,'gm_product_option')){
        // gm_product_option has no product_uid column. Its real key is (mall_code, pi_ii_vi).
        // Delete only option rows belonging to the exact product rows being removed.
        const pairs=deletable.map(x=>({mall_code:raw(x.mall_code),pi_ii_vi:raw(x.pi_ii_vi)})).filter(x=>x.mall_code&&x.pi_ii_vi);
        if(pairs.length){
          const malls=pairs.map(x=>x.mall_code), pivs=pairs.map(x=>x.pi_ii_vi);
          const d=await client.query(`DELETE FROM gm_product_option o
             USING unnest($1::text[],$2::text[]) AS x(mall_code,pi_ii_vi)
             WHERE o.mall_code=x.mall_code AND o.pi_ii_vi=x.pi_ii_vi`,[malls,pivs]);
          optionDeleted=d.rowCount||0;
        }
      }
      const d=await client.query(`DELETE FROM gm_product WHERE product_uid=ANY($1::text[]) AND COALESCE(glomart_code,'')=''`,[ids]);deleted=d.rowCount||0;
      if(deleted!==ids.length)throw new Error(`DELETE_COUNT_MISMATCH expected=${ids.length} actual=${deleted}`);
    }
    await client.query('COMMIT');inTx=false;invalidateContext(db);
    console.log(`[GM_PRODUCT_GLOMART_CODE_V012] cleanup_products selected_keywords=${selected.length} candidates=${q.rows.length} deleted=${deleted} protected=${protectedRows.length} vector=${vectorDeleted} pending=${pendingDeleted} embedding=${embeddingDeleted} option=${optionDeleted}`);
    ok(res,{action:'product-gm-code.cleanup-delete',selected_keywords:selected.length,candidate_products:q.rows.length,deleted_products:deleted,protected_products:protectedRows.length,protected_samples:protectedRows.slice(0,20),dependent_deleted:{image_vector:vectorDeleted,pending:pendingDeleted,embedding:embeddingDeleted,option:optionDeleted}});
  }catch(e){if(client&&inTx){try{await client.query('ROLLBACK');}catch(_){}}console.error('[GM_PRODUCT_GLOMART_CODE_V012] cleanup_delete_failed',String(e&&e.stack||e));fail(res,500,'PRODUCT_GM_CODE_CLEANUP_DELETE_FAILED',{detail:String(e&&e.message||e)});}finally{if(release)client.release();}
});

function csvCell(v){if(v===null||v===undefined)return '';const x=String(v);return /[",\r\n]/.test(x)?'"'+x.replace(/"/g,'""')+'"':x;}
router.get('/api/gm/builder/product-gm-code/unmatched.csv',async(req,res)=>{const db=dbFrom(req);if(!db)return fail(res,500,'DB_NOT_READY');try{const maps=await loadMaps(db),history=await loadHistory(db,maps);const cols=['product_uid','mall_code','product_name','cp_selected_code','cp_fix_code','mall_category','category_code','category_keyword','keyword','match_by','source_field','source_value','candidate_count','history_count','resolved_gm_code','category_name'];res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="gm_product_glomart_code_unmatched_${Date.now()}.csv"`);res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');res.setHeader('X-Content-Type-Options','nosniff');const writeChunk=async chunk=>{if(res.write(chunk))return;if(res.destroyed)throw new Error('client disconnected');await new Promise(resolve=>res.once('drain',resolve));};await writeChunk('\ufeff'+cols.join(',')+'\n');const pageSize=1000;let lastUid='',sent=0;while(true){const r=await db.query(`SELECT product_uid,glomart_code,cp_selected_code,cp_fix_code,mall_category,category_code,category_keyword,keyword,product_name,mall_code FROM gm_product WHERE COALESCE(glomart_code,'')='' AND product_uid>$1 ORDER BY product_uid ASC LIMIT $2`,[lastUid,pageSize]);if(!r.rows.length)break;for(const row of r.rows){const c=classify(row,maps,history);if(c.gm_code)continue;const out={...row,...c,resolved_gm_code:c.gm_code};await writeChunk(cols.map(k=>csvCell(out[k])).join(',')+'\n');sent++;}lastUid=String(r.rows[r.rows.length-1].product_uid||'');if(r.rows.length<pageSize)break;}console.log(`[GM_PRODUCT_GLOMART_CODE_V011] unmatched export sent=${sent}`);res.end();}catch(e){if(!res.headersSent)return fail(res,500,'PRODUCT_GM_CODE_UNMATCHED_EXPORT_FAILED',{detail:String(e&&e.message||e)});try{res.end();}catch(_){}}});

module.exports=router;
