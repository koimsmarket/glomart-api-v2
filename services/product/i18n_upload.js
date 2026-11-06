'use strict';
/* V009: conditional client translation save; identity must be server-verified by caller.
   No schema changes and no translation services executed here. */
const {LANGS,norm,hash,origin,resolveOption}=require('./i18n_source_sync');
const TARGETS={PRODUCT:{table:'gm_product_translation',queue:'gm_product_translation_queue',key:'product_id'},OPTION:{table:'gm_option_translation',queue:'gm_option_translation_queue',key:'pi_vi'}};
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
  const q=await client.query(`SELECT source_hash,source_lang,pending_langs FROM public.${t.queue} WHERE mall_code=$1 AND ${t.key}=$2 FOR UPDATE`,[mall,actual]);
  if(q.rows.length!==1||String(q.rows[0].source_hash).trim()!==suppliedHash)throw invalid('UNTRACKED_OR_STALE_VERSION');
  const rowResult=await client.query(`SELECT * FROM public.${t.table} WHERE mall_code=$1 AND ${t.key}=$2 FOR UPDATE`,[mall,actual]);
  if(rowResult.rows.length!==1)throw invalid('TRANSLATION_ROW_NOT_INITIALIZED');
  const row=rowResult.rows[0];
  const pending=new Set(Array.isArray(q.rows[0].pending_langs)?q.rows[0].pending_langs:[]);
  const oldSource=row.translation_source&&typeof row.translation_source==='object'?row.translation_source:{};
  const isDone=row.translation_status==='Y';
  let changed=0,skipped=0;
  for(const e of entries){
   if(isDone&&!pending.has(e.lang)){skipped++;continue;}
   // A recorded valid translation is immutable unless explicitly marked for review.
   if(!pending.has(e.lang)&&norm(row[e.lang])){skipped++;continue;}
   // A pending language with existing text is a review task; never downgrade ON to OFF.
   if(row.translation_status!=='U'&&norm(row[e.lang])&&oldSource[e.lang]==='ON'&&e.source==='OFF'){skipped++;continue;}
   // A new source version's previous translations are stale even if the column has content.
   await client.query(`UPDATE public.${t.table} SET "${e.lang}"=$3,translation_source=jsonb_set(COALESCE(translation_source,'{}'::jsonb),$4::text[],to_jsonb($5::text),true) WHERE mall_code=$1 AND ${t.key}=$2`,[mall,actual,e.text,[e.lang],e.source]);
   row[e.lang]=e.text;oldSource[e.lang]=e.source;pending.delete(e.lang);changed++;
  }
  // Only current-source valid translations count; pending languages remain excluded even if old text exists.
  // Ensure all 25 languages are filled and no pending work remains before status Y.
  const complete=LANGS.every(l=>!!norm(row[l]))&&pending.size===0;
  const state=complete?'Y':(row.translation_status==='U'?'U':'N');
  await client.query(`UPDATE public.${t.table} SET translation_status=$3 WHERE mall_code=$1 AND ${t.key}=$2`,[mall,actual,state]);
  await client.query(`UPDATE public.${t.queue} SET pending_langs=$3::jsonb,status=$4,completed_at=CASE WHEN $4='COMPLETED' THEN now() ELSE NULL END,owner_token=NULL,lease_until=NULL,updated_at=now() WHERE mall_code=$1 AND ${t.key}=$2 AND source_hash=$5`,[mall,actual,JSON.stringify([...pending]),complete?'COMPLETED':'PENDING',suppliedHash]);
  await client.query('COMMIT');
  return {ok:true,type:x.type,code:actual,changed,skipped,translation_status:state,remaining_languages:[...pending]};
 }catch(e){try{await client.query('ROLLBACK');}catch(_){ }throw e;}
 finally{client.release();}
}
module.exports={save};
