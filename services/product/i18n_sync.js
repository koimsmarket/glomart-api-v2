'use strict';
/* GM_PRODUCT_I18N_RUNTIME_V008: product source state changes use shared guarded updater. */
const {syncName}=require('./i18n_source_sync');
async function syncProductName(pool,x){
 return syncName(pool,{
  table:'gm_product_translation',queue:'gm_product_translation_queue',key:'product_id',
  mall_code:x.mall_code,code:x.product_id,new_name:x.new_name,old_name:x.old_name,
  inserted:x.inserted,
  currentSql:'SELECT product_name AS name FROM public.gm_product WHERE mall_code=$1 AND product_id=$2 LIMIT 2'
 });
}
module.exports={syncProductName};
