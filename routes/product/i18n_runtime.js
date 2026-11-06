'use strict';
/* GM_PRODUCT_I18N_RUNTIME_V006: explicit, opt-in product/option translation API.
 * Mount under existing authenticated product router. Does NOT run translations.
 * Source identity must be derived from authoritative product/option DB rows.
 */
const crypto=require('crypto');
const express=require('express');
const router=express.Router();
const LANGS=['ko','en','zh','vi','ja','tw','th','uz','ne','km','id','tl','mn','my','kk','si','ru','bn','ur','lo','hi','tr','fa','es','fr'];
const reMall=/^[A-Z0-9_]{2,16}$/;
function hash(s){return crypto.createHash('sha256').update(s,'utf8').digest('hex');}
function norm(s){return String(s||'').trim().replace(/\s+/g,' ');}
function db(req){return req.app.locals.db||req.app.locals.pool;}
function fail(res,status,error){return res.status(status).json({ok:false,error});}
function validItem(x){return !!x&&['PRODUCT','OPTION'].includes(x.type)&&reMall.test(String(x.mall_code||''))&&typeof x.code==='string'&&x.code.length>0&&x.code.length<256;}
function sourceLanguage(t){return /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(t)?'ko':/^[\x20-\x7e]+$/.test(t)?'en':null;}
// Returns null if the identifier is not unambiguously resolvable. No guessing conversion PID_IID_VID -> PID_VID.
async function current(dbh,x){
 const type=x.type, key=String(x.code),mall=x.mall_code;
 if(type==='PRODUCT'){
  const r=await dbh.query('SELECT product_name FROM public.gm_product WHERE mall_code=$1 AND product_id=$2 LIMIT 2',[mall,key]);
  if(r.rows.length!==1)return null;
  return {text:norm(r.rows[0].product_name), table:'gm_product_translation',key:'product_id',queue:'gm_product_translation_queue'};
 }
 const r=await dbh.query('SELECT option_name FROM public.gm_product_option WHERE mall_code=$1 AND pi_ii_vi=$2 LIMIT 2',[mall,key]);
 if(r.rows.length!==1)return null;
 // Resolve only unique PID_VID identities, using the exact source row.
 const mapping=await require('../../services/product/i18n_source_sync').resolveOption(dbh,mall,key);
 if(!mapping.ok)return {blocked:mapping.reason};
 return {text:norm(r.rows[0].option_name),table:'gm_option_translation',key:'pi_vi',queue:'gm_option_translation_queue',translationCode:mapping.pi_vi};
}
function needed(row,srcLang,reviewLangs){
 if(row&&row.translation_status==='Y'&&(!reviewLangs||!reviewLangs.length))return [];
 return LANGS.filter(l=>l!==srcLang && (!row||!norm(row[l])||reviewLangs.includes(l)));
}
router.post('/api/gm/product/i18n/plan',async(req,res)=>{
 const pool=db(req),items=req.body&&req.body.items;
 if(!pool)return fail(res,503,'DB_UNAVAILABLE');
 if(!Array.isArray(items)||items.length>100||items.some(x=>!validItem(x)))return fail(res,400,'INVALID_ITEMS');
 try{
  const tasks=[],skipped=[],blocked=[];
  for(const x of items){
   const src=await current(pool,x);
   if(!src){skipped.push({type:x.type,code:x.code,reason:'SOURCE_NOT_FOUND_OR_AMBIGUOUS'});continue;}
   if(src.blocked){blocked.push({type:x.type,code:x.code,reason:src.blocked});continue;}
   if(!src.text){skipped.push({type:x.type,code:x.code,reason:'EMPTY_SOURCE'});continue;}
   const code=src.translationCode||x.code;
   const found=await pool.query(`SELECT * FROM public.${src.table} WHERE mall_code=$1 AND ${src.key}=$2`,[x.mall_code,code]);
   const row=found.rows[0]||null;
   const sourceHash=hash(src.text),sourceLang=sourceLanguage(src.text);
   if(!sourceLang){blocked.push({type:x.type,code:x.code,reason:'UNSUPPORTED_SOURCE_LANG'});continue;}
   // Queue is the authoritative source version. A changed source invalidates all older translations.
   const q=await pool.query(`SELECT source_hash,pending_langs FROM public.${src.queue} WHERE mall_code=$1 AND ${src.key}=$2`,[x.mall_code,code]);
   const old=q.rows[0]||null;
   const inRowSource=row&&norm(row[sourceLang]);
   const changed=!!((old&&old.source_hash!==sourceHash)||(inRowSource&&inRowSource!==src.text));
   if(row&&row.translation_status==='Y'&&(!old||old.source_hash!==sourceHash)&&!inRowSource){blocked.push({type:x.type,code:x.code,reason:'UNVERIFIED_COMPLETION_SOURCE'});continue;}
   const review=old&&!changed&&Array.isArray(old.pending_langs)?old.pending_langs.filter(l=>LANGS.includes(l)):[];
   const langs=(changed||(row&&row.translation_status==='U'))?LANGS.filter(l=>l!==sourceLang):needed(row,sourceLang,review);
   if(!langs.length){skipped.push({type:x.type,code:x.code,reason:'COMPLETE'});continue;}
   tasks.push({type:x.type,mall_code:x.mall_code,code,source_text:src.text,source_hash:sourceHash,source_lang:sourceLang,languages:langs,reason:changed?'SOURCE_UPDATED':'MISSING_OR_REVIEW'});
  }
  res.json({ok:true,translation_required:tasks,skipped,blocked});
 }catch(e){console.error('[GM_PRODUCT_I18N_PLAN]',e.message);fail(res,500,'PLAN_FAILED');}
});
// Upload is intentionally disabled until authenticated member/connector identity and source-version
// atomic compare-and-swap are integrated. Never expose an unauthenticated DB write endpoint.
router.post('/api/gm/product/i18n/upload',(_req,res)=>fail(res,501,'UPLOAD_AUTH_AND_ATOMIC_UPSERT_NOT_YET_CONNECTED'));
module.exports=router;
