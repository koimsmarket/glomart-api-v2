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
// Translation records are exclusively owned by the translation plan/upload APIs.
// Legacy product/option UPSERT hooks have been removed. Preserve this legacy
// export as a non-writing no-op for any older caller loaded out of order.
async function syncName(){return {skipped:'TRANSLATION_OWNER_ONLY'};}
module.exports={LANGS,norm,origin,resolveOption,syncName};
