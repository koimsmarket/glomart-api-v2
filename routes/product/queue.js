
'use strict';
// GM_PRODUCT_SPLIT_V006_QUEUE_DIAG
const express=require('express');
const router=express.Router();
const {cleanText,toInt,parseIncomingPayloadBody,normalizeQueueItems,makeRequestId}=require('../../services/product/shared');
const keywordService=require('../../services/product/keyword');
function db(req){return req.app.locals.db||req.app.locals.pool;}
function ok(res,data){return res.json(Object.assign({ok:true},data||{}));}
function fail(res,status,message,extra){return res.status(status).json(Object.assign({ok:false,error:message},extra||{}));}
function saveRelationAfterResponse(pool,p,mallCode,keyword){
  const idx=toInt(p.chunk_index||p.chunkIndex,0);
  if(mallCode!=='CPKR'||(idx!==0&&idx!==1))return;
  const meta=keywordService.pickKeywordMeta(p);
  if(!meta.relatedKeywords.length)return;
  setImmediate(async()=>{let saved=0,skipped=0;for(const relatedKo of meta.relatedKeywords){try{const x=await keywordService.saveKeywordRelationRow(pool,meta.mainKeyword||keyword,relatedKo,{categoryMainKeywordKo:meta.categoryMainKeywordKo});if(x)saved++;else skipped++;}catch(e){skipped++;}}console.log('[GM_KEYWORD_RELATION_SAVE] keyword='+(meta.mainKeyword||keyword)+' received='+meta.relatedKeywords.length+' saved='+saved+' skipped='+skipped);});
}
router.post('/api/gm/product/queue',async(req,res)=>{
  const routeT0=Date.now();
  const pool=db(req),p=parseIncomingPayloadBody(req.body||{});if(!pool)return fail(res,500,'DB pool is not attached');
  const items=normalizeQueueItems(p);if(!items.length)return fail(res,400,'items required');
  const maxItems=Number(process.env.GM_PRODUCT_QUEUE_MAX_ITEMS||300);if(items.length>maxItems)return fail(res,413,'too many items',{received:items.length,max:maxItems});
  const requestId=makeRequestId(p,items);
  const mallCode=cleanText(p.mall_code||p.mallCode||p.source||(items[0]&&(items[0].mall_code||items[0].mallCode))||'').toUpperCase();
  const keyword=cleanText(p.keyword||p.q||p.search_keyword||p.searchKeyword||'');
  const chunkIndex=toInt(p.chunk_index||p.chunkIndex,0),chunkTotal=toInt(p.chunk_total||p.chunkTotal,0);
  const payloadJson=JSON.stringify(items);const t0=Date.now();
  let loopLagMs=null,client=null,acquireMs=null,sqlMs=null;
  setImmediate(()=>{loopLagMs=Date.now()-t0;});
  try{
    const values=[requestId,mallCode,keyword,payloadJson,items.length];
    const sql=`INSERT INTO gm_product_upsert_queue (request_id,mall_code,keyword,items_json,item_count,status,retry_count,created_at) VALUES ($1,$2,$3,$4::jsonb,$5,'pending',0,now()) ON CONFLICT (request_id) DO UPDATE SET mall_code=EXCLUDED.mall_code,keyword=EXCLUDED.keyword,items_json=EXCLUDED.items_json,item_count=EXCLUDED.item_count,status=CASE WHEN gm_product_upsert_queue.status IN ('done','processing') THEN gm_product_upsert_queue.status ELSE 'pending' END,error_message=NULL RETURNING queue_id,request_id,status,item_count`;
    let r;
    if(pool&&typeof pool.connect==='function'){
      const ta=Date.now();client=await pool.connect();acquireMs=Date.now()-ta;
      const tq=Date.now();r=await client.query(sql,values);sqlMs=Date.now()-tq;
    }else{
      acquireMs=0;const tq=Date.now();r=await pool.query(sql,values);sqlMs=Date.now()-tq;
    }
    const beforeResponseMs=Date.now()-t0;
    req.__gmApiDiag={route_ms:Date.now()-routeT0,acquire_ms:acquireMs,sql_ms:sqlMs};
    console.log('[GM_QUEUE_TIMING] keyword='+keyword+' mall='+mallCode+' items='+items.length+' acquire_ms='+acquireMs+' sql_ms='+sqlMs+' route_ms='+(Date.now()-routeT0));
    ok(res,{action:'product.queue',queued:true,queue:r.rows[0],queue_id:r.rows[0]&&r.rows[0].queue_id,request_id:r.rows[0]&&r.rows[0].request_id,item_count:r.rows[0]&&r.rows[0].item_count,received:items.length,inline_upsert:false,inline_status:'queued',chunk_index:chunkIndex,chunk_total:chunkTotal});
    saveRelationAfterResponse(pool,p,mallCode,keyword);
  }catch(e){req.__gmApiDiag={route_ms:Date.now()-routeT0,acquire_ms:acquireMs,sql_ms:sqlMs};console.error('[GM_QUEUE_ERROR] keyword='+keyword+' mall='+mallCode+' acquire_ms='+acquireMs+' sql_ms='+sqlMs+' error='+String(e&&e.message||e));return fail(res,500,'product queue failed',{detail:String(e&&e.message||e)});}
  finally{if(client&&typeof client.release==='function'){try{client.release();}catch(_){}}}
});
router.get('/api/gm/product/queue/status',async(req,res)=>{const pool=db(req);if(!pool)return fail(res,500,'DB pool is not attached');try{const r=await pool.query(`SELECT status,COUNT(*)::int AS count FROM gm_product_upsert_queue GROUP BY status ORDER BY status`);return ok(res,{action:'product.queue.status',rows:r.rows});}catch(e){return fail(res,500,'product queue status failed',{detail:String(e&&e.message||e)});}});
router.get('/api/gm/product/queue/recent',async(req,res)=>{const pool=db(req);if(!pool)return fail(res,500,'DB pool is not attached');try{const limit=Math.min(100,Math.max(1,parseInt(req.query.limit||'20',10)||20));const r=await pool.query(`SELECT queue_id,request_id,mall_code,keyword,item_count,status,retry_count,error_message,result_json,created_at,locked_at,processed_at FROM gm_product_upsert_queue ORDER BY created_at DESC LIMIT $1`,[limit]);return ok(res,{action:'product.queue.recent',rows:r.rows});}catch(e){return fail(res,500,'product queue recent failed',{detail:String(e&&e.message||e)});}});
module.exports=router;
