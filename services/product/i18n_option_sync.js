'use strict';
/* GM_PRODUCT_I18N_RUNTIME_V008: conservative option-name translation status tracking.
 * PID_VID mapping is accepted ONLY when product_id and vendor_item_id are both
 * present and unambiguous among source rows; ambiguous options are untouched.
 */
const {syncName,resolveOption}=require('./i18n_source_sync');
async function syncOptionName(pool,x){
 const mapped=await resolveOption(pool,x.mall_code,x.pi_ii_vi);
 if(!mapped.ok)return {skipped:mapped.reason};
 return syncName(pool,{
  table:'gm_option_translation',queue:'gm_option_translation_queue',key:'pi_vi',
  mall_code:x.mall_code,code:mapped.pi_vi,new_name:x.new_name,
  old_name:x.old_name,inserted:x.inserted,
  // Detect staleness in the authoritative original option row, not translation table.
  currentSql:'SELECT option_name AS name FROM public.gm_product_option WHERE mall_code=$1 AND pi_ii_vi=$2 LIMIT 2',
  originalCode:x.pi_ii_vi
 });
}
module.exports={syncOptionName};
