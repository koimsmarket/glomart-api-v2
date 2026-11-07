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
function requiredLanguages(row,sourceLang,pending,status){
 const outstanding=new Set(pending),sources=translationSources(row);
 // U is a source-version refresh: every target language needs a new ON result.
 if(status==='U')return LANGS.filter(l=>l!==sourceLang);
 return LANGS.filter(l=>l!==sourceLang &&
  (!row||!norm(row[l])||outstanding.has(l)||String(sources[l]||'').toUpperCase()==='OFF'));
}
function parsePending(value){
 if(Array.isArray(value))return value;
 if(typeof value==='string'){
  try{const v=JSON.parse(value);return Array.isArray(v)?v:null;}catch(_e){return null;}
 }
 return null;
}
async function planOne(pool,x){
 const src=await current(pool,x);
 if(!src)return {group:'skipped',item:{type:x.type,code:x.code,reason:'SOURCE_NOT_FOUND_OR_AMBIGUOUS'}};
 if(src.blocked)return {group:'blocked',item:{type:x.type,code:x.code,reason:src.blocked}};
 if(!src.text)return {group:'skipped',item:{type:x.type,code:x.code,reason:'EMPTY_SOURCE'}};
 const sourceLang=sourceLanguage(src.text);
 if(!sourceLang)return {group:'blocked',item:{type:x.type,code:x.code,reason:'UNSUPPORTED_SOURCE_LANG'}};
 const sourceHash=hash(src.text),translationCode=src.translationCode||x.code;
 const q=await pool.query(`SELECT source_hash,source_lang,pending_langs FROM public.${src.queue} WHERE mall_code=$1 AND ${src.key}=$2`,[x.mall_code,translationCode]);
 const tracked=q.rows[0]||null;
 // Upload rejects untracked versions: never give a client work that cannot be saved.
 if(!tracked)return {group:'blocked',item:{type:x.type,code:x.code,reason:'SOURCE_VERSION_NOT_INITIALIZED'}};
 if(String(tracked.source_hash||'').trim()!==sourceHash)
  return {group:'blocked',item:{type:x.type,code:x.code,reason:'SOURCE_VERSION_STALE'}};
 if(tracked.source_lang&&tracked.source_lang!==sourceLang)
  return {group:'blocked',item:{type:x.type,code:x.code,reason:'SOURCE_LANGUAGE_MISMATCH'}};
 const pending=parsePending(tracked.pending_langs);
 if(!pending||pending.some(l=>!LANGS.includes(l)||l===sourceLang))
  return {group:'blocked',item:{type:x.type,code:x.code,reason:'INVALID_PENDING_LANGUAGES'}};
 const found=await pool.query(`SELECT * FROM public.${src.table} WHERE mall_code=$1 AND ${src.key}=$2`,[x.mall_code,translationCode]);
 const row=found.rows[0]||null;
 if(!row)return {group:'blocked',item:{type:x.type,code:x.code,reason:'TRANSLATION_ROW_NOT_INITIALIZED'}};
 if(norm(row[sourceLang])!==src.text)
  return {group:'blocked',item:{type:x.type,code:x.code,reason:'SOURCE_TEXT_MISMATCH'}};
 const status=String(row.translation_status||'N').trim();
 if(!['Y','N','U'].includes(status))return {group:'blocked',item:{type:x.type,code:x.code,reason:'INVALID_STATUS'}};
 // A Y row with provisional OFF is NOT final. Report the inconsistency while
 // returning work for ON backfill; never silently declare a provisional result complete.
 const sources=translationSources(row);
 if(status==='Y'&&pending.length===0){
  const missing=LANGS.filter(l=>!norm(row[l]));
  if(missing.length)return {group:'blocked',item:{type:x.type,mall_code:x.mall_code,code:x.code,reason:'INCONSISTENT_COMPLETED_ROW'}};
  const provisional=LANGS.filter(l=>l!==sourceLang&&String(sources[l]||'').toUpperCase()==='OFF');
  if(!provisional.length)return {group:'skipped',item:{type:x.type,mall_code:x.mall_code,code:x.code,reason:'Y_COMPLETE'}};
 }
 const languages=requiredLanguages(row,sourceLang,pending,status);
 if(!languages.length)return {group:'skipped',item:{type:x.type,code:x.code,reason:'NO_MISSING_LANGUAGE'}};
 // code is the ORIGINAL client-side identifier; translation_code is only for DB bookkeeping.
 return {group:'tasks',item:{type:x.type,mall_code:x.mall_code,code:x.code,
  translation_code:translationCode,source_text:src.text,source_hash:sourceHash,
  source_lang:sourceLang,languages,translation_status:status,
  reason:status==='U'?'SOURCE_UPDATED_OR_RECHECK':'MISSING_OFF_OR_REVIEW'}};
}
router.post('/api/gm/product/i18n/plan',async(req,res)=>{
 res.set('Cache-Control','no-store');
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
// Validation is independent of optional GM_MEMBER_PROFILE_AUTH_ENFORCE: upload ALWAYS enforces auth.
// A request body member_id or authenticated flag is never proof of identity.
router.post('/api/gm/product/i18n/upload',async(req,res)=>{
 res.set('Cache-Control','no-store');
 const memberAuth=require('../gm_member_access_guard');
 if(!memberAuth.enabled())return fail(res,503,'MEMBER_AUTH_NOT_CONFIGURED');
 const memberId=memberAuth.validate(req);
 if(!memberId)return fail(res,401,'MEMBER_LOGIN_REQUIRED');
 // An optional member_id in the payload must match the signed principal.
 const submitted=req.body&&(req.body.member_id||req.body.memberId);
 if(submitted!==undefined&&String(submitted)!==memberId)return fail(res,403,'MEMBER_ACCESS_DENIED');
 try{
  const pool=db(req);
  if(!pool)return fail(res,503,'DB_UNAVAILABLE');
  const result=await require('../../services/product/i18n_upload').save(pool,req.body);
  return res.json(result);
 }catch(e){
  const known=['INVALID_ITEM','INVALID_TRANSLATIONS','INVALID_SOURCE_HASH','INVALID_TRANSLATION_ENTRY','SOURCE_LANGUAGE_CANNOT_BE_TRANSLATED','SOURCE_NOT_UNIQUE','PID_VID_NOT_PROVABLE','PID_VID_COLLISION','STALE_SOURCE','UNTRACKED_OR_STALE_VERSION','TRANSLATION_ROW_NOT_INITIALIZED','TRANSACTION_POOL_REQUIRED'];
  const error=known.includes(e.code)?e.code:'UPLOAD_FAILED';
  if(error==='UPLOAD_FAILED')console.error('[GM_PRODUCT_I18N_UPLOAD]',e.code||e.message);
  return fail(res,error==='STALE_SOURCE'||error==='UNTRACKED_OR_STALE_VERSION'?409:error==='UPLOAD_FAILED'?500:400,error);
 }
});
// V049: one authenticated HTTP request carrying several distinct product/option
// translations. Existing i18n_upload.save remains the only source/version/ON
// validation and writes each entity in its own proven DB transaction.
// Partial failure is explicit, never silently acknowledged as a total success.
router.post('/api/gm/product/i18n/upload-batch',async(req,res)=>{
 res.set('Cache-Control','no-store');
 const memberAuth=require('../gm_member_access_guard');
 if(!memberAuth.enabled())return fail(res,503,'MEMBER_AUTH_NOT_CONFIGURED');
 const memberId=memberAuth.validate(req);
 if(!memberId)return fail(res,401,'MEMBER_LOGIN_REQUIRED');
 const submitted=req.body&&(req.body.member_id||req.body.memberId);
 if(submitted!==undefined&&String(submitted)!==memberId)return fail(res,403,'MEMBER_ACCESS_DENIED');
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
    source_hash:x.source_hash,translation_status:result.translation_status,
    remaining_languages:result.remaining_languages||[],changed:result.changed,skipped:result.skipped});
  }catch(e){
   const known=['INVALID_ITEM','INVALID_TRANSLATIONS','INVALID_SOURCE_HASH','INVALID_TRANSLATION_ENTRY',
    'SOURCE_LANGUAGE_CANNOT_BE_TRANSLATED','SOURCE_NOT_UNIQUE','PID_VID_NOT_PROVABLE',
    'PID_VID_COLLISION','STALE_SOURCE','UNTRACKED_OR_STALE_VERSION',
    'TRANSLATION_ROW_NOT_INITIALIZED','TRANSACTION_POOL_REQUIRED'];
   const error=known.includes(e.code)?e.code:'UPLOAD_FAILED';
   if(error==='UPLOAD_FAILED')console.error('[GM_PRODUCT_I18N_BATCH_ITEM]',i,e.code||e.message);
   results.push({index:i,ok:false,type:x.type,mall_code:x.mall_code,code:x.code,
    source_hash:x.source_hash,error});
  }
 }
 const saved=results.filter(x=>x.ok).length;
 return res.json({ok:true,mode:'per_entity_transactions',received:items.length,saved,
  failed:items.length-saved,results});
});
module.exports=router;
