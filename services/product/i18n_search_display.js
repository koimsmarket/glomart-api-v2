 'use strict';
/* GM_PRODUCT_I18N_V013: search display-only enrichment.
 * Never runs translation in server. Never modifies product/option source.
 * Only translations matching the current original name are reusable.
 */
const LANGS=new Set(['ko','en','zh','vi','ja','tw','th','uz','ne','km','id','tl','mn','my','kk','si','ru','bn','ur','lo','hi','tr','fa','es','fr']);
function norm(v){return String(v||'').trim().replace(/\s+/g,' ');}
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
 // Search results must carry their known VID options, including the representative VID.
 // Read-only; no source writes, translation queue or detail-page dependency.
 try{
  const rr=await pool.query(`SELECT o.mall_code,o.product_id,o.pi_ii_vi,o.option_name,o.option_display_name,
        o.vendor_item_id,o.item_id,o.option_sort_no,
        t."${lang}" AS translated_option_name,t.ko,t.en,t.translation_status,t.translation_source
      FROM (SELECT DISTINCT mall_code,product_id FROM UNNEST($1::text[],$2::text[]) AS k(mall_code,product_id)) k
      JOIN public.gm_product_option o ON o.mall_code=k.mall_code AND o.product_id=k.product_id
      LEFT JOIN public.gm_option_translation t
        ON t.mall_code=o.mall_code AND t.pi_vi=o.product_id||'_'||o.vendor_item_id
      WHERE COALESCE(o.active_yn,'Y')='Y'
      ORDER BY o.mall_code,o.product_id,o.option_sort_no NULLS LAST,o.pi_ii_vi`,[malls,ids]);
  const grouped=new Map();
  for(const o of rr.rows||[]){
   const key=norm(o.mall_code)+'\u0000'+norm(o.product_id);
   const original=norm(o.option_display_name),srcLang=origin(original);
   const opt={pi_ii_vi:norm(o.pi_ii_vi),product_id:norm(o.product_id),
    vendorItemId:norm(o.vendor_item_id),itemId:norm(o.item_id),
    option_name:norm(o.option_name),option_display_name:original,original_option_name:original,
    translated_option_name:null,translate_required:'N',i18n_lang:lang};
   if(original&&/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(original)&&srcLang!==lang){
    const sourceStored=norm(o[srcLang]);
    const meta=o.translation_source&&typeof o.translation_source==='object'?o.translation_source:{};
    const valid=sourceStored===original&&
     (String(o.translation_status||'')!=='U'||norm(meta['__original_'+lang])===original);
    if(valid&&norm(o.translated_option_name)){
     opt.translated_option_name=norm(o.translated_option_name);
    }else opt.translate_required='Y';
   }
   if(!grouped.has(key))grouped.set(key,[]);
   grouped.get(key).push(opt);
  }
  for(let i=0;i<items.length;i++)items[i].options=grouped.get(keys[i])||[];
 }catch(e){
  console.warn('[GM_I18N_SEARCH_OPTIONS_LOOKUP_FAILED]',e.code||e.message);
  for(const it of items)it.options=[];
 }
 const map=new Map();
 try{
  // Whitelist the column name; user input must never become arbitrary SQL.
  const r=await pool.query(`SELECT t.mall_code,t.product_id,t."${lang}" AS translated_name,
     t.ko,t.en,t.translation_status,t.translation_source
     FROM UNNEST($1::text[],$2::text[]) AS k(mall_code,product_id)
     JOIN public.gm_product_translation t ON t.mall_code=k.mall_code AND t.product_id=k.product_id
     `,[malls,ids]);
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
  if(!tracked){items[i].translate_required='Y';items[i].i18n_reason='CLIENT_TRANSLATION_REQUIRED';continue;}
  if(norm(tracked[srcLang])!==original){
    items[i].translate_required='Y';items[i].i18n_reason='SOURCE_VERSION_MISMATCH';continue;
  }

  items[i].source_lang=srcLang;
  items[i].translation_code=norm(rows[i].product_id);
  const translated=norm(tracked.translated_name);
  const meta=tracked.translation_source&&typeof tracked.translation_source==='object'?tracked.translation_source:{};
  const valid=String(tracked.translation_status||'')!=='U'||norm(meta['__original_'+lang])===original;
  if(translated&&valid){
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
