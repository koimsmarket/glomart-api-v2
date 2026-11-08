'use strict';
/* V070: Direct translation-table source text sync; no queue or hash columns.
 * No DDL and no translation calls. Preserve original-name comparison and option mapping.
 */
const LANGS=['ko','en','zh','vi','ja','tw','th','uz','ne','km','id','tl','mn','my','kk','si','ru','bn','ur','lo','hi','tr','fa','es','fr'];
const norm=s=>String(s||'').trim().replace(/\s+/g,' ');
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
 const sourceLang=origin(name);if(!sourceLang)return {skipped:'SOURCE_LANGUAGE_UNKNOWN'};
 const originalCode=x.originalCode||code;
 const client=typeof pool.connect==='function'?await pool.connect():null,db=client||pool;
 try{
  if(client)await db.query('BEGIN');
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[table+':'+mall,code]);
  const latest=await db.query(currentSql,[mall,originalCode]);
  if(latest.rows.length!==1||norm(latest.rows[0].name)!==name){if(client)await db.query('ROLLBACK');return {skipped:'SOURCE_SUPERSEDED'};}
  const previous=await db.query(`SELECT * FROM public.${table} WHERE mall_code=$1 AND ${key}=$2 FOR UPDATE`,[mall,code]);
  if(!previous.rows.length){
   await db.query(`INSERT INTO public.${table}(mall_code,${key},"${sourceLang}",translation_status) VALUES($1,$2,$3,'0') ON CONFLICT(mall_code,${key}) DO NOTHING`,[mall,code,name]);
   if(client)await db.query('COMMIT');return {status:'0',inserted:true};
  }
  const old=previous.rows[0];
  // Compare the authoritative original language, not a translated language.
  const oldName=norm(old[sourceLang]);
  const changed=(x.old_name!=null&&norm(x.old_name)!==name)||!!oldName&&oldName!==name;
  if(changed){
   await db.query(`UPDATE public.${table} SET "${sourceLang}"=$3,translation_status='U' WHERE mall_code=$1 AND ${key}=$2`,[mall,code,name]);
  }else if(!oldName){
   await db.query(`UPDATE public.${table} SET "${sourceLang}"=$3 WHERE mall_code=$1 AND ${key}=$2`,[mall,code,name]);
  }
  if(client)await db.query('COMMIT');
  return {status:changed?'U':String(old.translation_status||'0'),changed:changed};
 }catch(e){if(client)try{await db.query('ROLLBACK');}catch(_){}throw e;}
 finally{if(client)client.release();}
}
module.exports={LANGS,norm,origin,resolveOption,syncName};
