'use strict';
/* GM_PRODUCT_I18N_RUNTIME_V008: shared guarded translation state/queue updates.
 * No DDL, no translation calls. Uses DB source versions and conservative mapping.
 */
const crypto=require('crypto');
const LANGS=['ko','en','zh','vi','ja','tw','th','uz','ne','km','id','tl','mn','my','kk','si','ru','bn','ur','lo','hi','tr','fa','es','fr'];
const norm=s=>String(s||'').trim().replace(/\s+/g,' ');
const hash=s=>crypto.createHash('sha256').update(s,'utf8').digest('hex');
const origin=s=>/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(s)?'ko':/^[\x20-\x7e]+$/.test(s)?'en':null;
// No fuzzy PID_VID mapping. Verifies exactly one source row for this identifier.
async function resolveOption(pool,mall,pi){
 const r=await pool.query(`SELECT product_id,vendor_item_id,pi_ii_vi
   FROM public.gm_product_option WHERE mall_code=$1 AND pi_ii_vi=$2 LIMIT 2`,[mall,pi]);
 if(r.rows.length!==1)return {ok:false,reason:'SOURCE_NOT_UNIQUE'};
 const row=r.rows[0],pid=norm(row.product_id),vid=norm(row.vendor_item_id);
 if(!pid||!vid||pid.includes('_')||vid.includes('_'))return {ok:false,reason:'PID_VID_NOT_PROVABLE'};
 const dup=await pool.query(`SELECT COUNT(*)::int AS n FROM public.gm_product_option
  WHERE mall_code=$1 AND product_id=$2 AND vendor_item_id=$3`,[mall,pid,vid]);
 if(Number(dup.rows[0]&&dup.rows[0].n)!==1)return {ok:false,reason:'PID_VID_COLLISION'};
 return {ok:true,pi_vi:pid+'_'+vid};
}
async function syncName(pool,x){
 const {table,queue,key,currentSql}=x;
 if(!['gm_product_translation','gm_option_translation'].includes(table)||!['product_id','pi_vi'].includes(key))throw Error('INVALID_TRANSLATION_TARGET');
 const mall=norm(x.mall_code),code=norm(x.code),name=norm(x.new_name);
 if(!mall||!code||!name)return {skipped:'SOURCE_MISSING'};
 const lang=origin(name);if(!lang)return {skipped:'SOURCE_LANGUAGE_UNKNOWN'};
 const originalCode=x.originalCode||code;
 const latest=await pool.query(currentSql,[mall,originalCode]);
 if(latest.rows.length!==1||norm(latest.rows[0].name)!==name)return {skipped:'SOURCE_SUPERSEDED'};
 const prev=await pool.query(`SELECT source_hash FROM public.${queue} WHERE mall_code=$1 AND ${key}=$2`,[mall,code]);
 const oldHash=prev.rows[0]&&String(prev.rows[0].source_hash).trim();
 const newHash=hash(name);
 const changed=(x.old_name!==null&&x.old_name!==undefined&&norm(x.old_name)!==name)||(!!oldHash&&oldHash!==newHash);
 if(!x.inserted&&!changed){
  // If translation metadata never existed, initialize it even for old source rows.
  const translated=await pool.query(`SELECT 1 FROM public.${table} WHERE mall_code=$1 AND ${key}=$2`,[mall,code]);
  if(translated.rows.length)return {skipped:'SOURCE_UNCHANGED'};
 }
 const pending=LANGS.filter(l=>l!==lang);
 // Advisory lock scoped to exact translation identity prevents concurrent bookkeeping interleaving.
 const client=typeof pool.connect==='function'?await pool.connect():null;
 const db=client||pool;
 try{
  if(client)await db.query('BEGIN');
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[table+':'+mall,code]);
  const still=await db.query(currentSql,[mall,originalCode]);
  if(still.rows.length!==1||norm(still.rows[0].name)!==name){if(client)await db.query('ROLLBACK');return {skipped:'SOURCE_SUPERSEDED'};}
  const queued=await db.query(`SELECT source_hash FROM public.${queue} WHERE mall_code=$1 AND ${key}=$2 FOR UPDATE`,[mall,code]);
  if(queued.rows.length&&String(queued.rows[0].source_hash).trim()===newHash){
   const existing=await db.query(`SELECT 1 FROM public.${table} WHERE mall_code=$1 AND ${key}=$2`,[mall,code]);
   if(existing.rows.length){if(client)await db.query('COMMIT');return {skipped:'VERSION_ALREADY_TRACKED'};}
  }
  // Do not change source on an already completed record for the identical source version.
  const langCol='"'+lang+'"';
  await db.query(`INSERT INTO public.${table}(mall_code,${key},${langCol},translation_status)
   VALUES($1,$2,$3,'N') ON CONFLICT(mall_code,${key}) DO UPDATE SET
    ${langCol}=EXCLUDED.${langCol},translation_status=$4`,[mall,code,name,changed?'U':'N']);
  await db.query(`INSERT INTO public.${queue}
    (mall_code,${key},source_hash,source_lang,pending_langs,status,next_retry_at,updated_at)
    VALUES($1,$2,$3,$4,$5::jsonb,'PENDING',now(),now())
    ON CONFLICT(mall_code,${key}) DO UPDATE SET
    source_hash=EXCLUDED.source_hash,source_lang=EXCLUDED.source_lang,
    pending_langs=EXCLUDED.pending_langs,status='PENDING',owner_token=NULL,
    lease_until=NULL,next_retry_at=now(),updated_at=now(),completed_at=NULL
    WHERE ${queue}.source_hash IS DISTINCT FROM EXCLUDED.source_hash`,
   [mall,code,newHash,lang,JSON.stringify(pending)]);
  if(client)await db.query('COMMIT');
  return {status:changed?'U':'N',source_hash:newHash};
 }catch(e){if(client)try{await db.query('ROLLBACK');}catch(_){}throw e;}
 finally{if(client)client.release();}
}
module.exports={LANGS,norm,hash,origin,resolveOption,syncName};
