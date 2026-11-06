 'use strict';
/* GM_PRODUCT_I18N_V013: search display-only enrichment.
 * Never runs translation in server. Never modifies product/option source.
 * Only current-hash translations are reusable. Existing search remains the source of results.
 */
const crypto=require('crypto');
const LANGS=new Set(['ko','en','zh','vi','ja','tw','th','uz','ne','km','id','tl','mn','my','kk','si','ru','bn','ur','lo','hi','tr','fa','es','fr']);
function norm(v){return String(v||'').trim().replace(/\s+/g,' ');}
function hash(s){return crypto.createHash('sha256').update(s,'utf8').digest('hex');}
function langOf(v){let l=norm(v).toLowerCase().split(/[-_]/)[0];if(l==='cn')l='zh';if(l==='jp')l='ja';if(l==='kr')l='ko';if(l==='vn')l='vi';return LANGS.has(l)?l:'';}
function origin(t){return /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(t)?'ko':/^[\x20-\x7e]+$/.test(t)?'en':null;}
async function attach(pool,rows,items,langInput){
 const lang=langOf(langInput);
 for(let i=0;i<items.length;i++){
  const original=norm(rows[i]&&rows[i].product_name);
  const sourceLang=origin(original);
  items[i].original_lang=sourceLang;
  items[i].server_lang=sourceLang;
  items[i].search_lang=lang||null;
 }
 // Do not infer a fallback language when the client did not send its language.
 if(!lang){for(let i=0;i<items.length;i++){
   items[i].original_product_name=norm(rows[i].product_name);
   items[i].translated_name=null;items[i].translate_required='N';items[i].i18n_reason='LANG_NOT_SPECIFIED';
  }return;}
 const malls=[],ids=[],keys=[];
 for(let i=0;i<rows.length;i++){
  const x=rows[i],mall=norm(x.mall_code),id=norm(x.product_id);malls.push(mall);ids.push(id);keys.push(mall+'\u0000'+id);
  items[i].original_product_name=norm(x.product_name);items[i].translated_name=null;
  items[i].translate_required='N';items[i].i18n_lang=lang;items[i].i18n_reason='NOT_TRACKED';
 }
 if(!rows.length)return;
 const map=new Map();
 try{
  // Whitelist the column name; user input must never become arbitrary SQL.
  const r=await pool.query(`SELECT t.mall_code,t.product_id,t."${lang}" AS translated_name,
     q.source_hash,q.source_lang,q.pending_langs,t.translation_status
     FROM UNNEST($1::text[],$2::text[]) AS k(mall_code,product_id)
     JOIN public.gm_product_translation t ON t.mall_code=k.mall_code AND t.product_id=k.product_id
     JOIN public.gm_product_translation_queue q ON q.mall_code=k.mall_code AND q.product_id=k.product_id`,[malls,ids]);
  for(const x of r.rows||[])map.set(norm(x.mall_code)+'\u0000'+norm(x.product_id),x);
 }catch(e){
  console.warn('[GM_I18N_SEARCH_LOOKUP_FAILED]',e.code||e.message);
  for(const x of items)x.i18n_reason='LOOKUP_UNAVAILABLE';
  return;
 }
 for(let i=0;i<rows.length;i++){
  const original=items[i].original_product_name,srcLang=origin(original),tracked=map.get(keys[i]);
  if(!original||!srcLang){items[i].i18n_reason='SOURCE_UNSUPPORTED';continue;}
  if(lang===srcLang){items[i].translated_name=original;items[i].i18n_reason='SOURCE_LANGUAGE';continue;}
  if(!tracked){continue;}
  const srcHash=hash(original);
  if(norm(tracked.source_hash)!==srcHash|| (tracked.source_lang&&tracked.source_lang!==srcLang)){
    items[i].i18n_reason='SOURCE_VERSION_MISMATCH';continue;
  }
  const pending=Array.isArray(tracked.pending_langs)?tracked.pending_langs:[];
  items[i].source_hash=srcHash;
  items[i].source_lang=srcLang;
  items[i].translation_code=norm(rows[i].product_id);
  const translated=norm(tracked.translated_name);
  if(translated&&!pending.includes(lang)){
   items[i].translated_name=translated;
   items[i].server_lang=lang;
   items[i].productName=translated;items[i].title=translated;
   items[i].i18n_reason='SERVER_TRANSLATION';
  }else{
   items[i].translate_required='Y';items[i].i18n_reason='CLIENT_TRANSLATION_REQUIRED';
  }
 }
}
module.exports={attach,langOf};
