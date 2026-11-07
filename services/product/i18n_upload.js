'use strict';
/* V009: conditional client translation save; identity must be server-verified by caller.
   No schema changes and no translation services executed here. */
const {LANGS,norm,hash,origin,resolveOption}=require('./i18n_source_sync');
const TARGETS={PRODUCT:{table:'gm_product_translation',key:'product_id'},OPTION:{table:'gm_option_translation',key:'pi_vi'}};
const reMall=/^[A-Z0-9_]{2,16}$/;
function invalid(error){const e=new Error(error);e.code=error;return e;}
async function save(pool,input){
 if(!pool||typeof pool.connect!=='function')throw invalid('TRANSACTION_POOL_REQUIRED');
 const x=input||{},t=TARGETS[x.type],mall=String(x.mall_code||''),code=String(x.code||'');
 if(!t||!reMall.test(mall)||!code||code.length>255)throw invalid('INVALID_ITEM');
 if(!Array.isArray(x.translations)||x.translations.length<1||x.translations.length>25)throw invalid('INVALID_TRANSLATIONS');
 const suppliedHash=String(x.source_hash||'').toLowerCase();
 if(!/^[0-9a-f]{64}$/.test(suppliedHash))throw invalid('INVALID_SOURCE_HASH');
 const seen=new Set(),entries=[];
 for(const it of x.translations){
  const lang=String(it&&it.lang||'').toLowerCase(),source=String(it&&it.source||'').toUpperCase();
  const value=typeof (it&&it.text)==='string'?it.text.trim():'';
  if(!LANGS.includes(lang)||seen.has(lang)||!['ON','OFF'].includes(source)||!value||value.length>10000)throw invalid('INVALID_TRANSLATION_ENTRY');
  seen.add(lang);entries.push({lang,source,text:value});
 }
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[t.table+':'+mall,code]);
  let original,actual=code;
  if(x.type==='PRODUCT'){
   const r=await client.query('SELECT product_name AS name FROM public.gm_product WHERE mall_code=$1 AND product_id=$2 LIMIT 2 FOR SHARE',[mall,code]);
   if(r.rows.length!==1)throw invalid('SOURCE_NOT_UNIQUE');original=norm(r.rows[0].name);
  }else{
   // OPTION input code is the source pi_ii_vi; never reinterpret a client code as pi_vi.
   const mapping=await resolveOption(client,mall,code);
   if(!mapping.ok)throw invalid(mapping.reason);
   actual=mapping.pi_vi;
   const r=await client.query('SELECT option_name AS name FROM public.gm_product_option WHERE mall_code=$1 AND pi_ii_vi=$2 LIMIT 2 FOR SHARE',[mall,code]);
   if(r.rows.length!==1)throw invalid('SOURCE_NOT_UNIQUE');original=norm(r.rows[0].name);
  }
  const sourceLang=origin(original);
  if(!original||!sourceLang||hash(original)!==suppliedHash)throw invalid('STALE_SOURCE');
  if(entries.some(e=>e.lang===sourceLang))throw invalid('SOURCE_LANGUAGE_CANNOT_BE_TRANSLATED');
  // The source row and its SHA-256 are authoritative. A server queue is not required.
  const rowResult=await client.query(`SELECT * FROM public.${t.table} WHERE mall_code=$1 AND ${t.key}=$2 FOR UPDATE`,[mall,actual]);
  let row=rowResult.rows[0]||null;
  const legacyMatch=!!row&&norm(row[sourceLang])===original;
  const stale=!!row&&((row.source_hash&&String(row.source_hash).trim()!==suppliedHash)||(!row.source_hash&&!legacyMatch)||row.translation_status==='U');
  if(!row){
   await client.query(`INSERT INTO public.${t.table}(mall_code,${t.key},source_hash,source_lang,"${sourceLang}",translation_status)
      VALUES($1,$2,$3,$4,$5,'N') ON CONFLICT(mall_code,${t.key}) DO NOTHING`,[mall,actual,suppliedHash,sourceLang,original]);
   const reread=await client.query(`SELECT * FROM public.${t.table} WHERE mall_code=$1 AND ${t.key}=$2 FOR UPDATE`,[mall,actual]);
   row=reread.rows[0];
  }
  if(stale){
   // Old translations must never be counted as translations of a changed source.
   const clear=LANGS.map(l=>'"'+l+'"=NULL').join(',');
   await client.query(`UPDATE public.${t.table} SET ${clear},translation_source='{}'::jsonb,translation_review_status='{}'::jsonb,
     source_hash=$3,source_lang=$4,translation_status='N' WHERE mall_code=$1 AND ${t.key}=$2`,[mall,actual,suppliedHash,sourceLang]);
   row={translation_source:{},translation_status:'N'};
  }
  let changed=0,skipped=0;
  const oldSource=row.translation_source&&typeof row.translation_source==='object'?{...row.translation_source}:{};
  const incoming=new Map();
  for(const e of entries){
   const existing=norm(row[e.lang]);
   const oldEngine=String(oldSource[e.lang]||'').toUpperCase();
   if(existing&&oldEngine==='ON'&&e.source==='OFF'){skipped++;continue;}
   if(existing&&oldEngine==='ON'&&e.source==='ON'&&!stale){skipped++;continue;}
   await client.query(`UPDATE public.${t.table} SET "${e.lang}"=$3,
     translation_source=jsonb_set(COALESCE(translation_source,'{}'::jsonb),$4::text[],to_jsonb($5::text),true)
     WHERE mall_code=$1 AND ${t.key}=$2`,[mall,actual,e.text,[e.lang],e.source]);
   row[e.lang]=e.text;oldSource[e.lang]=e.source;incoming.set(e.lang,e.source);changed++;
  }
  // The source-language column is identity metadata, not a completed translation.
  await client.query(`UPDATE public.${t.table} SET "${sourceLang}"=$3,source_hash=$4,source_lang=$5
    WHERE mall_code=$1 AND ${t.key}=$2`,[mall,actual,original,suppliedHash,sourceLang]);
  row[sourceLang]=original;
  const missing=LANGS.filter(l=>l!==sourceLang&&(!norm(row[l])||oldSource[l]!=='ON'));
  const state=missing.length?'N':'Y';
  await client.query(`UPDATE public.${t.table} SET translation_status=$3 WHERE mall_code=$1 AND ${t.key}=$2`,[mall,actual,state]);
  await client.query('COMMIT');
  return {ok:true,type:x.type,code:actual,changed,skipped,translation_status:state,remaining_languages:missing};
 }catch(e){try{await client.query('ROLLBACK');}catch(_){ }throw e;}
 finally{client.release();}
}
module.exports={save};
