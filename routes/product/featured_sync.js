'use strict';
/* GM_FEATURED_V002: homepage recommendation/new product bulk lookup.
 * Cafe24 can INSERT an absent PID; it can NEVER UPDATE an existing PID/IID/VID/status/price.
 */
const express=require('express'),router=express.Router();
const LANGS=new Set('ko en zh vi ja tw th uz ne km id tl mn my kk si ru bn ur lo hi tr fa es fr'.split(' '));
const C=x=>String(x==null?'':x).trim().replace(/\s+/g,' ');
function parse(x){
 if(!x||typeof x!=='object')return null;
 const code=C(x.internal_product_code).toUpperCase(),key=C(x.pi_ii_vi);
 if(!/^\d{1,15}[A-Z]$/.test(code)||!/^\d{5,}_\d{5,}_\d{5,}$/.test(key)||C(x.mall_code)!=='CPKR'||C(x.source_mall)!=='GMKR'||C(x.source_uid)!=='GMKR_'+code)return null;
 const [pid,iid,vid]=key.split('_'),price=Number(x.price),title=C(x.product_name);
 if(!title||title.length>500||!Number.isSafeInteger(price)||price<0||price>1000000000)return null;
 return {code,key,pid,iid,vid,price,title,uid:'CPKR_'+pid,source_uid:'GMKR_'+code,thumb:C(x.thumb_url).slice(0,2000)};
}
router.post('/api/gm/product/featured-sync',async(req,res)=>{
 res.set('Cache-Control','no-store');
 const pool=req.app.locals.db||req.app.locals.pool,body=req.body||{},lang=C(body.lang).toLowerCase();
 if(!pool)return res.status(503).json({ok:false,error:'DB_UNAVAILABLE'});
 if(!LANGS.has(lang)||!Array.isArray(body.items)||body.items.length<1||body.items.length>150)return res.status(400).json({ok:false,error:'INVALID_ITEMS'});
 const unique=new Map();
 for(const raw of body.items){const x=parse(raw);if(!x)return res.status(400).json({ok:false,error:'INVALID_CAFE24_IDENTITY'});unique.set(x.source_uid,x);}
 const items=[...unique.values()],pids=[...new Set(items.map(x=>x.pid))];
 try{
  const get=()=>pool.query(`SELECT product_uid,product_id,source_mall,source_uid,product_name,mall_sale_price,normal_price,sale_status,updated_at
    FROM gm_product WHERE mall_code='CPKR' AND product_id=ANY($1::text[]) ORDER BY updated_at DESC NULLS LAST`,[pids]);
  let r=await get(),found=new Set(r.rows.map(x=>C(x.product_id))),inserted=0;
  for(const x of items){
   if(found.has(x.pid))continue;
   // No ON CONFLICT UPDATE: stale Cafe24 IID/VID can never overwrite collector data.
   const ins=await pool.query(`INSERT INTO gm_product
    (product_uid,mall_code,source_mall,source_uid,internal_product_code,product_id,item_id,vendor_item_id,pi_ii_vi,
     product_name,mall_product_name,mall_sale_price,normal_price,thumb_origin_url,sale_status,
     glomart_code,gm_category,mall_category_json,cp_match,option_json,thumb_json,detail_json,product_url,soldout_yn,overseas_direct_yn,created_at,updated_at)
    SELECT $1,'CPKR','GMKR',$2,$3,$4,$5,$6,$7,$8,$8,$9,$9,$10,'unknown',
     '','','[]'::jsonb,'F','{"iid_vid":""}'::jsonb,'[]'::jsonb,'{}'::jsonb,'','N','N',now(),now()
    WHERE NOT EXISTS (SELECT 1 FROM gm_product WHERE mall_code='CPKR' AND product_id=$4)
    ON CONFLICT (product_uid) DO NOTHING`,[x.uid,x.source_uid,x.code,x.pid,x.iid,x.vid,x.key,x.title,x.price,x.thumb]);
   inserted+=ins.rowCount||0; found.add(x.pid);
  }
  r=await get();const best=new Map();r.rows.forEach(x=>{if(!best.has(x.product_id))best.set(x.product_id,x);});
  const tr=await pool.query(`SELECT product_id,source_lang,ko,en,${lang} AS translated_text FROM gm_product_translation
    WHERE mall_code='CPKR' AND product_id=ANY($1::text[])`,[pids]);
  const ts=new Map(tr.rows.map(x=>[x.product_id,x]));
  const out=items.map(x=>{
   const p=best.get(x.pid);if(!p)return {requested_source_uid:x.source_uid,error:'NOT_FOUND'};
   const t=ts.get(x.pid),source=t?C(t.source_lang==='en'?t.en:t.ko):'';
   return {requested_source_uid:x.source_uid,product_uid:p.product_uid,product_id:p.product_id,
    source_mall:p.source_mall||'',source_uid:p.source_uid||'',product_name:p.product_name,
    sale_status:C(p.sale_status).toLowerCase()||'unknown',price:Number(p.normal_price)>0?Number(p.normal_price):Number(p.mall_sale_price)||0,
    price_known:Number(p.normal_price)>0||Number(p.mall_sale_price)>0,
    translated_text:source&&source===C(p.product_name)&&t?C(t.translated_text):'',lang,updated_at:p.updated_at};
  });
  res.json({ok:true,version:'GM_FEATURED_V002',inserted,complete:out.every(x=>!x.error),items:out});
 }catch(e){console.error('[GM_FEATURED_SYNC_V002]',{code:e.code||'',column:e.column||'',table:e.table||'',constraint:e.constraint||'',detail:e.detail||'',message:e.message||''});res.status(500).json({ok:false,error:'FEATURED_SYNC_FAILED'});}
});
module.exports=router;
