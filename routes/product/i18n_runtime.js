'use strict';
/* GM_PRODUCT_I18N_RUNTIME_V006: explicit, opt-in product/option translation API.
 * Mount under existing authenticated product router. Does NOT run translations.
 * Source identity must be derived from authoritative product/option DB rows.
 */
const express=require('express');
const router=express.Router();
const LANGS=['ko','en','zh','vi','ja','tw','th','uz','ne','km','id','tl','mn','my','kk','si','ru','bn','ur','lo','hi','tr','fa','es','fr'];
const reMall=/^[A-Z0-9_]{2,16}$/;
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
  return {text:norm(r.rows[0].product_name), table:'gm_product_translation',key:'product_id'};
 }
 const r=await dbh.query('SELECT option_display_name FROM public.gm_product_option WHERE mall_code=$1 AND pi_ii_vi=$2 LIMIT 2',[mall,key]);
 if(r.rows.length!==1)return null;
 // Resolve only unique PID_VID identities, using the exact source row.
 const mapping=await require('../../services/product/i18n_source_sync').resolveOption(dbh,mall,key);
 if(!mapping.ok)return {blocked:mapping.reason};
 return {text:norm(r.rows[0].option_display_name),table:'gm_option_translation',key:'pi_vi',translationCode:mapping.pi_vi};
}
// V012: server-authoritative read-only translation work plan for BOTH products and options.
// Source identity and version are checked before the client receives translation work.
function translationSources(row){
 const raw=row&&row.translation_source;
 if(raw&&typeof raw==='object'&&!Array.isArray(raw))return raw;
 if(typeof raw==='string'){
  try{const v=JSON.parse(raw);if(v&&typeof v==='object'&&!Array.isArray(v))return v;}catch(_e){}
 }
 return {};
}
function requiredLanguages(row,sourceLang,status){
 const sources=translationSources(row);
 if(status==='U')return LANGS.filter(l=>l!==sourceLang&&(!norm(row[l])||norm(sources['__original_'+l])!==norm(row[sourceLang])||String(sources[l]||'').toUpperCase()==='OFF'));
 return LANGS.filter(l=>l!==sourceLang&&(!row||!norm(row[l])||String(sources[l]||'').toUpperCase()==='OFF'));
}
async function planOne(pool,x){
 const src=await current(pool,x);
 if(!src)return {group:'skipped',item:{type:x.type,code:x.code,reason:'SOURCE_NOT_FOUND_OR_AMBIGUOUS'}};
 if(src.blocked)return {group:'blocked',item:{type:x.type,code:x.code,reason:src.blocked}};
 const sourceLang=sourceLanguage(src.text);
 if(x.type==='OPTION'&&!/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(src.text))return {group:'skipped',item:{type:x.type,code:x.code,reason:'OPTION_NO_HANGUL'}};
 if(!src.text||!sourceLang)return {group:'blocked',item:{type:x.type,code:x.code,reason:'UNSUPPORTED_SOURCE_LANG'}};
 const translationCode=src.translationCode||x.code;
 const found=await pool.query(`SELECT * FROM public.${src.table} WHERE mall_code=$1 AND ${src.key}=$2`,[x.mall_code,translationCode]);
 const row=found.rows[0]||null;
 // A missing translation row is normal: the translation upload owns its creation.
 // Detect source changes against the current authoritative product/option source,
 // without writing an empty translation row during a planning request.
 const sourceChanged=!!row&&norm(row[sourceLang])!==src.text;
 const status=sourceChanged?'U':String(row&&row.translation_status!=null?row.translation_status:'0');
 if(!['Y','U','0','1','2','3'].includes(status))return {group:'blocked',item:{type:x.type,code:x.code,reason:'INVALID_STATUS'}};
 const effectiveRow=row?Object.assign({},row,{[sourceLang]:src.text}):{[sourceLang]:src.text};
 const langs=row?requiredLanguages(effectiveRow,sourceLang,status):LANGS.filter(l=>l!==sourceLang);
 if(!langs.length)return {group:'skipped',item:{type:x.type,code:x.code,reason:'NO_MISSING_LANGUAGE'}};
 // This endpoint is read-only; the server search UPSERT owns the atomic 0..3 grant.
 // A plan must not issue translation assignments after the cap has been exhausted.
 if(status==='3')return {group:'blocked',item:{type:x.type,code:x.code,reason:'TRANSLATION_REQUEST_LIMIT'}};
 return {group:'tasks',item:{type:x.type,mall_code:x.mall_code,code:x.code,
  translation_code:translationCode,source_text:src.text,source_lang:sourceLang,
  languages:langs,translation_status:status,reason:status==='U'?'SOURCE_UPDATED_OR_RECHECK':(!row?'UNINITIALIZED_TRANSLATION':'MISSING_OR_REVIEW')}};
}
router.post('/api/gm/product/i18n/plan',async(req,res)=>{
 res.set('Cache-Control','no-store');
 // V033: do not allocate pool connections or grant 24-language plans to old clients.
 return res.json({ok:true,translation_required:[],skipped:[],blocked:[],retired:true,
  counts:{requested:Array.isArray(req.body&&req.body.items)?req.body.items.length:0,required:0,skipped:0,blocked:0}});
 const pool=db(req),items=req.body&&req.body.items;
 if(!pool)return fail(res,503,'DB_UNAVAILABLE');
 if(!Array.isArray(items)||items.length<1||items.length>100||items.some(x=>!validItem(x)))return fail(res,400,'INVALID_ITEMS');
 try{
  const tasks=[],skipped=[],blocked=[],seen=new Set();
  for(const x of items){
   const identity=[x.type,x.mall_code,x.code].join('\u0000');
   if(seen.has(identity))continue;
   seen.add(identity);
   const result=await planOne(pool,x);
   if(result.group==='tasks')tasks.push(result.item);
   else if(result.group==='skipped')skipped.push(result.item);
   else blocked.push(result.item);
  }
  return res.json({ok:true,translation_required:tasks,skipped,blocked,
   counts:{requested:items.length,required:tasks.length,skipped:skipped.length,blocked:blocked.length}});
 }catch(e){console.error('[GM_PRODUCT_I18N_PLAN]',e.code||e.message);return fail(res,500,'PLAN_FAILED');}
});
// Fail closed: this callback MUST validate an already authenticated user/session on the server.
// Never accept member_id, role or an "authenticated" flag from request JSON as evidence.
// Reuse Glomart's existing signed, member-bound, short-lived access token.
// V072: translation submissions are independent of member login, as search collection is.
// Source identity, original-text validation and existing translation protection remain in save().
router.post('/api/gm/product/i18n/upload',async(req,res)=>{
 res.set('Cache-Control','no-store');
 try{
  const pool=db(req);
  if(!pool)return fail(res,503,'DB_UNAVAILABLE');
  const result=await require('../../services/product/i18n_upload').save(pool,req.body);
  return res.json(result);
 }catch(e){
  const known=['INVALID_ITEM','INVALID_TRANSLATIONS','SOURCE_TEXT_REQUIRED','INVALID_TRANSLATION_ENTRY','SOURCE_LANGUAGE_CANNOT_BE_TRANSLATED','OPTION_NO_HANGUL','SOURCE_NOT_UNIQUE','PID_VID_NOT_PROVABLE','PID_VID_COLLISION','STALE_SOURCE','SOURCE_TEXT_MISMATCH','TRANSLATION_ROW_NOT_INITIALIZED','TRANSACTION_POOL_REQUIRED'];
  const error=known.includes(e.code)?e.code:'UPLOAD_FAILED';
  if(error==='UPLOAD_FAILED')console.error('[GM_PRODUCT_I18N_UPLOAD]',e.code||e.message);
  return fail(res,error==='STALE_SOURCE'||error==='SOURCE_TEXT_MISMATCH'?409:error==='UPLOAD_FAILED'?500:400,error);
 }
});
// V072: one login-independent HTTP request carrying several distinct product/option
// translations. Existing i18n_upload.save remains the only source/version/ON
// validation and writes each entity in its own proven DB transaction.
// Partial failure is explicit, never silently acknowledged as a total success.
router.post('/api/gm/product/i18n/upload-batch',async(req,res)=>{
 res.set('Cache-Control','no-store');
 const items=req.body&&req.body.items;
 if(!Array.isArray(items)||items.length<1||items.length>20||items.some(x=>!validItem(x)))return fail(res,400,'INVALID_ITEMS');
 const pool=db(req);if(!pool)return fail(res,503,'DB_UNAVAILABLE');
 const seen=new Set();
 for(const x of items){
  if(!Array.isArray(x.translations)||x.translations.length<1||x.translations.length>25)return fail(res,400,'INVALID_TRANSLATIONS');
  const key=[x.type,x.mall_code,x.code].join('\u0000');
  if(seen.has(key))return fail(res,400,'DUPLICATE_ENTITY');
  seen.add(key);
 }
 const save=require('../../services/product/i18n_upload').save;
 const results=[];
 for(let i=0;i<items.length;i++){
  const x=items[i];
  try{
   // An existing validated transaction per entity; no global transaction and no
   // claim of all-or-nothing success across unrelated products.
   const result=await save(pool,x);
   results.push({index:i,ok:true,type:x.type,mall_code:x.mall_code,code:x.code,
    source_text:x.source_text,translation_status:result.translation_status,
    remaining_languages:result.remaining_languages||[],changed:result.changed,skipped:result.skipped});
  }catch(e){
   const known=['INVALID_ITEM','INVALID_TRANSLATIONS','SOURCE_TEXT_REQUIRED','INVALID_TRANSLATION_ENTRY',
    'SOURCE_LANGUAGE_CANNOT_BE_TRANSLATED','OPTION_NO_HANGUL','SOURCE_NOT_UNIQUE','PID_VID_NOT_PROVABLE',
    'PID_VID_COLLISION','STALE_SOURCE','SOURCE_TEXT_MISMATCH',
    'TRANSLATION_ROW_NOT_INITIALIZED','TRANSACTION_POOL_REQUIRED'];
   const error=known.includes(e.code)?e.code:'UPLOAD_FAILED';
   if(error==='UPLOAD_FAILED')console.error('[GM_PRODUCT_I18N_BATCH_ITEM]',i,e.code||e.message);
   results.push({index:i,ok:false,type:x.type,mall_code:x.mall_code,code:x.code,
    source_text:x.source_text,error});
  }
 }
 const saved=results.filter(x=>x.ok).length;
 return res.json({ok:true,mode:'per_entity_transactions',received:items.length,saved,
  failed:items.length-saved,results});
});
module.exports=router;
