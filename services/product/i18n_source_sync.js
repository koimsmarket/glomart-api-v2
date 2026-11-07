'use strict';
/* GM_PRODUCT_I18N_RUNTIME_V008: shared server-source identity checks; IndexedDB owns all pending work.
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
 const {table,key,currentSql}=x;
 if(!['gm_product_translation','gm_option_translation'].includes(table)||!['product_id','pi_vi'].includes(key))throw Error('INVALID_TRANSLATION_TARGET');
 const mall=norm(x.mall_code),code=norm(x.code),name=norm(x.new_name);
 if(!mall||!code||!name)return {skipped:'SOURCE_MISSING'};
 const lang=origin(name);if(!lang)return {skipped:'SOURCE_LANGUAGE_UNKNOWN'};
 const latest=await pool.query(currentSql,[mall,x.originalCode||code]);
 if(latest.rows.length!==1||norm(latest.rows[0].name)!==name)return {skipped:'SOURCE_SUPERSEDED'};
 // IndexedDB owns outstanding work. Never initialize a translation row or queue here.
 const changed=x.old_name!==undefined&&x.old_name!==null&&norm(x.old_name)!==name;
 if(changed){
  // Keep existing translations for auditing, but mark stale until a matching-hash upload replaces them.
  await pool.query(`UPDATE public.${table} SET translation_status='U'
    WHERE mall_code=$1 AND ${key}=$2 AND source_hash IS DISTINCT FROM $3`,[mall,code,hash(name)]);
 }
 return {skipped:'CLIENT_INDEXEDDB_OWNS_PENDING',source_hash:hash(name),status:changed?'U':'N'};
}
module.exports={LANGS,norm,hash,origin,resolveOption,syncName};
