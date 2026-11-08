'use strict';
/* V070 direct translation UPSERT: no queue, no hash, no automatic STATUS changes. */
const {LANGS,norm,origin,resolveOption}=require('./i18n_source_sync');
const TARGETS={PRODUCT:{table:'gm_product_translation',key:'product_id'},OPTION:{table:'gm_option_translation',key:'pi_vi'}};
const reMall=/^[A-Z0-9_]{2,16}$/;
function invalid(code){const e=new Error(code);e.code=code;return e;}
async function save(pool,input){
 if(!pool||typeof pool.connect!=='function')throw invalid('TRANSACTION_POOL_REQUIRED');
 const x=input||{},t=TARGETS[x.type],mall=String(x.mall_code||''),code=String(x.code||'');
 if(!t||!reMall.test(mall)||!code||code.length>255)throw invalid('INVALID_ITEM');
 const requestOriginal=norm(x.source_text);
 if(!requestOriginal)throw invalid('SOURCE_TEXT_REQUIRED');
 if(!Array.isArray(x.translations)||!x.translations.length||x.translations.length>25)throw invalid('INVALID_TRANSLATIONS');
 const seen=new Set(),entries=[];
 for(const it of x.translations){
  const lang=String(it&&it.lang||'').toLowerCase(),source=String(it&&it.source||'').toUpperCase(),text=norm(it&&it.text);
  if(!LANGS.includes(lang)||seen.has(lang)||!['ON','OFF'].includes(source)||!text||text.length>10000)throw invalid('INVALID_TRANSLATION_ENTRY');
  seen.add(lang);entries.push({lang,source,text});
 }
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[t.table+':'+mall,code]);
  let actual=code,sourceRow;
  if(x.type==='PRODUCT'){
   sourceRow=await db.query('SELECT product_name AS name FROM public.gm_product WHERE mall_code=$1 AND product_id=$2 LIMIT 2 FOR SHARE',[mall,code]);
  }else{
   const mapping=await resolveOption(db,mall,code);if(!mapping.ok)throw invalid(mapping.reason);
   actual=mapping.pi_vi;
   sourceRow=await db.query('SELECT option_name AS name FROM public.gm_product_option WHERE mall_code=$1 AND pi_ii_vi=$2 LIMIT 2 FOR SHARE',[mall,code]);
  }
  if(sourceRow.rows.length!==1)throw invalid('SOURCE_NOT_UNIQUE');
  const currentOriginal=norm(sourceRow.rows[0].name),sourceLang=origin(currentOriginal);
  if(!currentOriginal||currentOriginal!==requestOriginal)throw invalid('STALE_SOURCE');
  if(!sourceLang||entries.some(e=>e.lang===sourceLang))throw invalid('SOURCE_LANGUAGE_CANNOT_BE_TRANSLATED');
  const existing=await db.query(`SELECT * FROM public.${t.table} WHERE mall_code=$1 AND ${t.key}=$2 FOR UPDATE`,[mall,actual]);
  if(existing.rows.length!==1)throw invalid('TRANSLATION_ROW_NOT_INITIALIZED');
  const row=existing.rows[0];
  if(norm(row[sourceLang])!==currentOriginal)throw invalid('SOURCE_TEXT_MISMATCH');
  const sources=row.translation_source&&typeof row.translation_source==='object'?row.translation_source:{};
  let changed=0,skipped=0;
  for(const e of entries){
   const prior=String(sources[e.lang]||'').toUpperCase(),before=norm(row[e.lang]);
   if(before&&(prior==='ON'||!prior)){skipped++;continue;} // Never overwrite an existing accepted/legacy translation through public upload.
   if(before===e.text&&prior===e.source&&norm(sources['__original_'+e.lang])===currentOriginal){skipped++;continue;}
   await db.query(`UPDATE public.${t.table} SET "${e.lang}"=$3,translation_source=jsonb_set(jsonb_set(COALESCE(translation_source,'{}'::jsonb),$4::text[],to_jsonb($5::text),true),$6::text[],to_jsonb($7::text),true) WHERE mall_code=$1 AND ${t.key}=$2`,[mall,actual,e.text,[e.lang],e.source,['__original_'+e.lang],currentOriginal]);
   row[e.lang]=e.text;sources[e.lang]=e.source;sources['__original_'+e.lang]=currentOriginal;changed++;
  }
  // STATUS is intentionally untouched. Y belongs exclusively to a separate
  // verified full-25-language slow completion scan; never to one-language upload.
  await db.query('COMMIT');
  return {ok:true,type:x.type,code:code,translation_code:actual,changed,skipped,translation_status:row.translation_status};
 }catch(e){try{await db.query('ROLLBACK');}catch(_){}throw e;}
 finally{db.release();}
}
module.exports={save};
