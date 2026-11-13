 'use strict';
// GM_BUILDER_TRANSLATION_QA_V001 — Admin-only, manual DB data quality operations.
// No automatic scan at page load and no Google translation request.
const express=require('express');
const router=express.Router();
const {dbFrom}=require('./core/common');
const LANGS=['en','zh','vi','ja','tw','th','uz','ne','km','id','tl','mn','my','kk','si','ru','bn','ur','lo','hi','tr','fa','es','fr'];
const TYPES={product:{table:'gm_product_translation',key:'product_id'},option:{table:'gm_option_translation',key:'pi_vi'}};
const bad=v=>typeof v==='string' && v.trim().length>0 && !/[^\p{P}\p{S}\s]/u.test(v);
function validateQuery(body){
 const type=String(body.type||'both'),lang=String(body.lang||'all');
 if(!['both','product','option'].includes(type)||!(lang==='all'||LANGS.includes(lang)))throw Error('INVALID_FILTER');
 const limit=Math.min(100,Math.max(1,Number(body.limit)||50));
 const offset=Math.max(0,Math.min(1000000,Number(body.offset)||0));
 return {type,lang,limit,offset};
}
function sqlScan(type,lang){
 const cfg=TYPES[type], langs=lang==='all'?LANGS:[lang];
 // Static allowlisted SQL identifiers only; no user-supplied column or table names.
 const values=langs.map((l,i)=>`('${l}', t."${l}")`).join(',');
 return `SELECT t.mall_code, t."${cfg.key}" AS item_key, t.ko, v.lang, v.translation_value,
   t.translation_status FROM public.${cfg.table} t
   CROSS JOIN LATERAL (VALUES ${values}) AS v(lang,translation_value)
   WHERE v.translation_value IS NOT NULL AND BTRIM(v.translation_value)<>''
     AND BTRIM(v.translation_value) ~ '^[[:space:][:punct:]…·•。！？、，]+$'
   ORDER BY t.mall_code,t."${cfg.key}",v.lang LIMIT $1 OFFSET $2`;
}
router.post('/api/gm/builder/translation-qa/scan',express.json({limit:'8kb'}),async(req,res)=>{
 try {
  const q=validateQuery(req.body||{}), db=dbFrom(req), result=[];
  for(const type of (q.type==='both'?['product','option']:[q.type])){
   const rows=await db.query(sqlScan(type,q.lang),[q.limit+1,q.offset]);
   result.push({type,rows:rows.rows.slice(0,q.limit).filter(x=>bad(x.translation_value)),has_more:rows.rows.length>q.limit});
  }
  res.set('Cache-Control','no-store');return res.json({ok:true,limit:q.limit,offset:q.offset,groups:result});
 }catch(e){console.error('[TRANSLATION_QA_SCAN]',e.code||e.message);return res.status(e.message==='INVALID_FILTER'?400:500).json({ok:false,error:e.message==='INVALID_FILTER'?'INVALID_FILTER':'SCAN_FAILED'});}
});
router.post('/api/gm/builder/translation-qa/clear-selected',express.json({limit:'32kb'}),async(req,res)=>{
 const items=req.body&&req.body.items;
 if(!Array.isArray(items)||items.length<1||items.length>100)return res.status(400).json({ok:false,error:'INVALID_ITEMS'});
 const db=dbFrom(req),out=[];
 try {
  // Every cell update is conditional on its currently stored exact value: stale previews cannot erase newer translations.
  for(const item of items){
   const type=String(item.type||''),lang=String(item.lang||''),cfg=TYPES[type];
   const mall_code=String(item.mall_code||''),key=String(item.item_key||''),old=item.translation_value;
   if(!cfg||!LANGS.includes(lang)||!mall_code||!key||!bad(old)){
    out.push({type,lang,mall_code,item_key:key,result:'INVALID'});continue;
   }
   const sql=`UPDATE public.${cfg.table} SET "${lang}"=NULL,
     translation_source=COALESCE(translation_source,'{}'::jsonb)-$1::text,
     translation_review_status=COALESCE(translation_review_status,'{}'::jsonb)-$1::text,
     translation_status=CASE WHEN translation_status='Y' THEN '0' ELSE translation_status END
     WHERE mall_code=$2 AND "${cfg.key}"=$3 AND "${lang}"=$4 RETURNING mall_code`;
   const r=await db.query(sql,[lang,mall_code,key,old]);
   out.push({type,lang,mall_code,item_key:key,result:r.rowCount===1?'CLEARED':'STALE_OR_MISSING'});
  }
  res.set('Cache-Control','no-store');return res.json({ok:true,results:out,cleared:out.filter(x=>x.result==='CLEARED').length});
 }catch(e){console.error('[TRANSLATION_QA_CLEAR]',e.code||e.message);return res.status(500).json({ok:false,error:'CLEAR_FAILED',results:out});}
});

// V002: single-action, entire-table administrative cleanup. Each table is scanned once
// in one UPDATE, not once per language and not one page at a time.
const QA_RE = "^[[:space:][:punct:]…·•。！？、，]+$";
let bulkJob={id:0,state:'idle',started_at:null,finished_at:null,results:[],error:null};
function fullCleanupSQL(type){
 const cfg=TYPES[type];
 const invalid=l=>`(t."${l}" IS NOT NULL AND BTRIM(t."${l}")<>'' AND BTRIM(t."${l}") ~ '${QA_RE}')`;
 const sets=LANGS.map(l=>`"${l}"=CASE WHEN ${invalid(l)} THEN NULL ELSE t."${l}" END`);
 const keyArray=`ARRAY_REMOVE(ARRAY[${LANGS.map(l=>`CASE WHEN ${invalid(l)} THEN '${l}'::text ELSE NULL::text END`).join(',')}],NULL)`;
 sets.push(`translation_source=COALESCE(t.translation_source,'{}'::jsonb) - (${keyArray})`);
 // translation_review_status may not exist in upgraded databases: skip it here.
 sets.push("translation_status=CASE WHEN t.translation_status='Y' THEN '0' ELSE t.translation_status END");
 return `UPDATE public.${cfg.table} AS t SET ${sets.join(', ')} WHERE (${LANGS.map(invalid).join(' OR ')})`;
}
router.post('/api/gm/builder/translation-qa/clear-all',express.json({limit:'2kb'}),async(req,res)=>{
 if(bulkJob.state==='running')return res.status(409).json({ok:false,error:'QA_JOB_RUNNING'});
 const type=String(req.body?.type||'both'); const lang=String(req.body?.lang||'all');
 if(!['both','product','option'].includes(type)||lang!=='all')return res.status(400).json({ok:false,error:'INVALID_FILTER'});
 const db=dbFrom(req),id=bulkJob.id+1;
 bulkJob={id,state:'running',started_at:new Date().toISOString(),finished_at:null,results:[],error:null};
 res.set('Cache-Control','no-store').status(202).json({ok:true,job_id:id,state:'running'});
 // Intentionally do not hold a client HTTP request open for a large-table UPDATE.
 (async()=>{
   for(const t of (type==='both'?['product','option']:[type])){
     const result=await db.query(fullCleanupSQL(t));
     bulkJob.results.push({type:t,cleared_rows:result.rowCount});
   }
   bulkJob.state='done'; bulkJob.finished_at=new Date().toISOString();
 })().catch(e=>{console.error('[TRANSLATION_QA_BULK]',e.code||e.message);bulkJob.state='failed';bulkJob.error=e.code||'QA_BULK_FAILED';bulkJob.finished_at=new Date().toISOString();});
});
router.get('/api/gm/builder/translation-qa/job-status',(req,res)=>{
 res.set('Cache-Control','no-store').json({ok:true,...bulkJob});
});

module.exports=router;
