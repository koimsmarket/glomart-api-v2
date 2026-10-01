'use strict';
// GM_PRODUCT_SPLIT_V002_ROUTE_ONLY
const express=require('express');
const router=express.Router();
const product=require('../../services/product/upsert');
const shared=require('../../services/product/shared');
const keyword=require('../../services/product/keyword');

function db(req){ return req.app.locals.db || req.app.locals.pool; }
function ok(res,data){ return res.json(Object.assign({ok:true},data||{})); }
function fail(res,status,message,extra){ return res.status(status).json(Object.assign({ok:false,error:message},extra||{})); }
const {cleanText,toInt,parseIncomingPayloadBody,collectPayloadContainers,ids,compactError}=shared;
const {parseMaybeJsonObject}=require('../../services/product/option');

router.post('/api/gm/keyword/relation/status', async (req,res)=>{
  const pool=db(req), p=req.body||{}; if(!pool) return fail(res,500,'DB pool is not attached');
  try{
    await keyword.ensureKeywordRelationSchema(pool);
    const meta=keyword.pickKeywordMeta(p);
    const keywordKo=cleanText(p.keyword_ko||p.keywordKo||meta.mainKeyword||p.mainKeyword||p.keyword||'');
    const related=keyword.uniqClean(p.relatedKeywords||p.related_keywords||meta.relatedKeywords||[]);
    if(!keywordKo||!related.length) return ok(res,{mainKeyword:keywordKo,related_count:related.length,pending:[],complete:[],missing:[],reason:'empty_keyword_or_related'});
    const r=await pool.query(`SELECT v.related_keyword_ko, CASE WHEN gr.related_keyword_ko IS NULL THEN 'F' ELSE 'T' END AS saved FROM unnest($2::text[]) AS v(related_keyword_ko) LEFT JOIN gm_keyword_relation gr ON gr.keyword_ko=$1 AND gr.related_keyword_ko=v.related_keyword_ko`,[keywordKo,related]);
    const pending=[],complete=[],missing=[];
    for(const row of (r.rows||[])){ const rk=cleanText(row.related_keyword_ko); if(cleanText(row.saved).toUpperCase()==='T') complete.push(rk); else {pending.push(rk);missing.push({related_keyword_ko:rk,saved:'F'});} }
    return ok(res,{mainKeyword:keywordKo,keyword_ko:keywordKo,related_count:related.length,pending,complete,pending_count:pending.length,complete_count:complete.length,missing,mode:'three-fields'});
  }catch(e){ return fail(res,500,'keyword relation status failed',{detail:String(e&&e.message||e)}); }
});

router.post('/api/gm/keyword/translate', async (req,res)=>{
  const pool=db(req), p=req.body||{}; if(!pool) return fail(res,500,'DB pool is not attached');
  try{return ok(res,await keyword.saveKeywordTranslatePayload(pool,p));}
  catch(e){return fail(res,500,'keyword translate save failed',{detail:String(e&&e.message||e)});}
});

router.get('/api/gm/keyword/lookup', async (req,res)=>{
  const pool=db(req); if(!pool) return fail(res,500,'DB pool is not attached');
  try{
    await keyword.ensureKeywordTranslateTable(pool);
    const input=cleanText(req.query.input_keyword||req.query.keyword||req.query.q||'');
    const lang=cleanText(req.query.lang||req.query.gm_lang||'').toLowerCase();
    if(!input) return fail(res,400,'input_keyword required');
    let r;
    if(lang){ r=await pool.query('SELECT lang,input_keyword,main_keyword_ko,hit_count,updated_at FROM gm_keyword_translate WHERE lang=$1 AND input_keyword=$2',[lang,input]); if(r.rows[0]) return ok(res,{found:true,item:r.rows[0]}); }
    r=await pool.query('SELECT lang,input_keyword,main_keyword_ko,hit_count,updated_at FROM gm_keyword_translate WHERE input_keyword=$1 ORDER BY hit_count DESC, updated_at DESC LIMIT 1',[input]);
    return ok(res,{found:!!r.rows[0],item:r.rows[0]||null});
  }catch(e){return fail(res,500,'keyword lookup failed',{detail:String(e&&e.message||e)});}
});

router.post(['/api/gm/product/upsert','/api/product/upsert'], async (req,res)=>{
  const pool=db(req), p=parseIncomingPayloadBody(req.body||{}); if(!pool) return fail(res,500,'DB pool is not attached');
  try{
    const id0=ids(p), oj0=parseMaybeJsonObject(p.option_json||p.optionJson);
    console.log('[GM_PRODUCT_UPSERT_ROUTE_IN]',{mall_code:cleanText(p.mall_code||p.mallCode||id0.mallCode),product_id:cleanText(p.product_id||p.productId||id0.productId),pi_ii_vi:cleanText(p.pi_ii_vi||p.piIiVi||id0.pi),optionRows:Array.isArray(p.optionRows)?p.optionRows.length:0,optionCombos:Array.isArray(p.optionCombos)?p.optionCombos.length:0,option_json_rows:oj0&&Array.isArray(oj0.rows)?oj0.rows.length:0,keys:Object.keys(p).slice(0,60)});
  }catch(_){ }
  const items=Array.isArray(p.items)?p.items:(Array.isArray(p.products)?p.products:(p.payload&&Array.isArray(p.payload.items)?p.payload.items:(p.payload&&Array.isArray(p.payload.products)?p.payload.products:null)));
  try{
    if(items){
      const results=[]; for(const item of items){ try{results.push(await product.upsertProduct(pool,item,p));}catch(e){results.push({ok:false,error:String(e&&e.message||e),error_detail:compactError(e)});} }
      const saved=results.filter(x=>x&&x.ok).length, skipped=results.length-saved;
      const inserted=results.filter(x=>x&&x.ok&&x.action==='inserted').length, updated=results.filter(x=>x&&x.ok&&x.action!=='inserted').length;
      const optionAudit=results.reduce((a,x)=>{const o=x&&x.item&&x.item.option_result||{};a.received+=Number(o.received||0);a.inserted+=Number(o.inserted||0);a.updated+=Number(o.updated||0);a.skipped+=Number(o.skipped||0);a.nonactive+=Number(o.nonactive||0);if(o.balance_ok===false)a.balance_ok=false;return a;},{received:0,inserted:0,updated:0,skipped:0,nonactive:0,balance_ok:true});
      optionAudit.balance_ok=optionAudit.balance_ok&&optionAudit.received===(optionAudit.inserted+optionAudit.updated+optionAudit.skipped);
      const audit={search_result_count:items.length,product_inserted:inserted,product_updated:updated,product_skipped:skipped,product_balance_ok:items.length===(inserted+updated+skipped),option_received:optionAudit.received,option_inserted:optionAudit.inserted,option_updated:optionAudit.updated,option_skipped:optionAudit.skipped,option_nonactive:optionAudit.nonactive,option_balance_ok:optionAudit.balance_ok};
      return ok(res,{mode:'batch',received:items.length,saved,skipped,audit,option_audit:optionAudit,results:results.slice(0,20),errors:results.filter(x=>x&&!x.ok).slice(0,30)});
    }
    const result=await product.upsertProduct(pool,p,p);
    if(!result.ok) return fail(res,400,result.reason||'product upsert validation failed',result);
    return ok(res,{mode:'single',item:result.item,option_result:result.item&&result.item.option_result,detail_patch:result.item&&result.item.detail_patch,detail_stats:result.item&&result.item.detail_stats});
  }catch(e){return fail(res,500,'product upsert failed',{detail:String(e&&e.message||e),error_detail:compactError(e)});}
});

router.post('/api/gm/product/event', async (req,res)=>{
  const pool=db(req),p=req.body||{}; if(!pool) return fail(res,500,'DB pool is not attached');
  const id=ids(p),type=cleanText(p.type||p.event_type||p.eventType).toLowerCase(),qty=Math.max(1,toInt(p.quantity||p.qty,1));
  if(!id.uid&&(!id.mallCode||!id.pi)) return fail(res,400,'product_uid or mall_code+pi_ii_vi required');
  const where=id.uid?'product_uid=$1':'mall_code=$1 AND pi_ii_vi=$2', vals=id.uid?[id.uid]:[id.mallCode,id.pi];
  let setSql='';
  if(type==='detail'||type==='view') setSql="detail_view_count=COALESCE(detail_view_count,0)+1";
  else if(type==='cart') setSql="cart_count=COALESCE(cart_count,0)+1, last_cart_at=now()";
  else if(type==='wish') setSql="wish_count=COALESCE(wish_count,0)+1, last_wish_at=now()";
  else if(type==='order') setSql="order_count=COALESCE(order_count,0)+1, order_qty_total=COALESCE(order_qty_total,0)+"+qty+", last_order_at=now()";
  else if(type==='return') setSql="return_count=COALESCE(return_count,0)+1, last_return_at=now()";
  else if(type==='exchange') setSql="exchange_count=COALESCE(exchange_count,0)+1, last_exchange_at=now()";
  else if(type==='ad_view') setSql="ad_view_count=COALESCE(ad_view_count,0)+1, last_ad_view_at=now()";
  else if(type==='ad_sale') setSql="ad_order_count=COALESCE(ad_order_count,0)+1, ad_sales_qty=COALESCE(ad_sales_qty,0)+"+qty+", last_ad_order_at=now()";
  else return fail(res,400,'event type must be detail/view/cart/wish/order/return/exchange/ad_view/ad_sale');
  try{
    const r=await pool.query(`UPDATE gm_product SET ${setSql}, updated_at=now() WHERE ${where} RETURNING product_uid, mall_code, product_id, pi_ii_vi`,vals);
    let option_updated=0;
    if(type==='order'){
      const mall=cleanText(id.mallCode||(r.rows[0]&&r.rows[0].mall_code)||'').toUpperCase(), pi=cleanText(id.pi||(r.rows[0]&&r.rows[0].pi_ii_vi)||'');
      if(mall&&pi){ try{const or=await pool.query(`UPDATE gm_product_option SET sales_qty=COALESCE(sales_qty,0)+$3, updated_at=now() WHERE mall_code=$1 AND pi_ii_vi=$2`,[mall,pi,qty]);option_updated=or.rowCount||0;}catch(_){ } }
    }
    return ok(res,{action:'product.event',type,updated:r.rowCount,option_updated,item:r.rows[0]||null});
  }catch(e){return fail(res,500,'product event failed',{detail:String(e&&e.message||e)});}
});

router.use(require('./detail_fast'));
router.use(require('./queue'));
console.log('[GM_PRODUCT_SPLIT_V004] routes/product/index registered (detail_fast + queue)');
module.exports=router;
