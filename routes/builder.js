const express = require('express');
const router = express.Router();

const VERSION = 'GM_SAFE_UPDATE_BUILDER_V049_AUTO_ORDER_AUTH_REMOVED';
console.log('[GM_BUILDER_ROUTE_V049_AUTO_ORDER_AUTH_REMOVED] routes/builder.js loaded');

// V002 기본 원칙:
// - UPDATE ONLY
// - INSERT 금지
// - DELETE 금지
// - 키 없는 행 SKIP
// - DB에 없는 키 SKIP
// - 빈값은 기본적으로 기존값 유지
// - 중요 컬럼 부적격은 행 SKIP
// - 부적격 과다 시 STOP
// - 결과 CSV 출력

const TABLES = {
  products: {
    table: 'gm_product',
    key: ['mall_code', 'pi_ii_vi'],
    order: 'updated_at DESC NULLS LAST, created_at DESC NULLS LAST',
    critical: ['mall_code', 'pi_ii_vi', 'product_name', 'mall_sale_price'],
    numeric: ['mall_sale_price','customer_sale_price','final_supply_price','normal_price','discount_price','delivery_fee','unit_price_value','unit_base_qty','unit_norm_qty','unit_norm_price','option_count','return_shipping_fee','exchange_shipping_fee','return_period_days','exchange_period_days','view_count','search_count','wish_count','cart_count','order_count','sales_qty','sales_amount','purchase_amount','gross_profit','return_count','exchange_count','ad_view_count','ad_order_count','ad_sales_qty','ad_sales_amount'],
    defaults: { mall_code:'CPKR', currency:'KRW', sale_status:'active', collect_status:'ok', unit_sortable_yn:'N', unit_parse_status:'failed', return_available_yn:'Y', exchange_available_yn:'Y' },
    enums: {
      delivery_type:['seller','bundle','fresh','rocket','rocket_fresh','unknown'],
      sale_status:['active','soldout','unavailable','deleted','collect_failed'],
      collect_status:['ok','option_failed','price_failed','page_failed','etc'],
      unit_sortable_yn:['Y','N'], return_available_yn:['Y','N'], exchange_available_yn:['Y','N']
    },
    blocked: ['product_uid','created_at']
  },

  product_options: {
    table: 'gm_product_option',
    key: ['mall_code', 'pi_ii_vi'],
    order: 'updated_at DESC NULLS LAST, created_at DESC NULLS LAST, mall_code ASC, product_id ASC, option_sort_no ASC',
    critical: ['mall_code','product_id','pi_ii_vi'],
    numeric: ['option_sort_no','mall_sale_price','final_supply_price','normal_price','discount_price','delivery_fee','buyable_qty','min_order_qty','max_order_qty','sales_qty'],
    defaults: { mall_code:'CPKR', option_sort_no:'0', mall_sale_price:'0', discount_price:'0', delivery_fee:'0', soldout_yn:'N', sale_status:'active', active_yn:'Y', sales_qty:'0' },
    enums: {
      soldout_yn:['Y','N'],
      active_yn:['Y','N'],
      sale_status:['active','soldout','unavailable','deleted','collect_failed'],
      delivery_type:['seller','bundle','fresh','rocket','rocket_fresh','unknown']
    },
    blocked: ['created_at'],
    allowInsert: true
  },
  cart: {
    table: 'gm_basket',
    keyAny: [['member_id','pi_ii_vi'], ['guest_key','pi_ii_vi']],
    order: 'updated_at DESC NULLS LAST, added_at DESC NULLS LAST',
    critical: ['pi_ii_vi','product_name','quantity','amount'],
    numeric: ['quantity','amount','delivery_fee'],
    defaults: { quantity:'1', amount_type:'unit', delivery_fee:'0' },
    enums: { amount_type:['unit','line_total'], delivery_type:['seller','bundle','fresh','rocket','rocket_fresh','unknown'] },
    blocked: ['added_at','created_at']
  },
  orders: {
    table: 'gm_order',
    key: ['order_no'],
    order: 'created_at DESC NULLS LAST',
    critical: ['order_no','orderer_name','orderer_mobile','receiver_name','receiver_mobile','receiver_zipcode','receiver_address1','total_payment_price'],
    numeric: ['expected_payment_amount','actual_payment_amount','payment_difference_amount','total_product_price','total_delivery_fee','extra_area_delivery_fee','estimated_customs_fee','estimated_import_vat','total_payment_price'],
    defaults: { customs_required_yn:'N', order_status:'ordered', payment_status:'pending', shipping_status:'pending', cs_status:'none', cancel_status:'none', purchase_confirmed_yn:'N' },
    enums: {
      customs_required_yn:['Y','N'],
      order_status:['draft','ordered','cancelled','completed'],
      payment_status:['pending','waiting_deposit','partially_paid','paid','overpaid','refunded','failed'],
      shipping_status:['pending','preparing','shipped','in_transit','delivered','returned'],
      cs_status:['none','open','processing','resolved','closed'],
      cancel_status:['none','requested','completed','rejected'],
      purchase_confirmed_yn:['Y','N']
    },
    blocked: ['order_no','created_at','ordered_at']
  },
  order_items: {
    table: 'gm_order_item',
    key: ['order_no','pi_ii_vi'],
    order: 'created_at DESC NULLS LAST',
    critical: ['order_no','pi_ii_vi','product_name','quantity','mall_sale_price','customer_order_price','product_amount'],
    numeric: ['quantity','mall_sale_price','customer_order_price','final_supply_price','product_amount','delivery_fee','extra_area_delivery_fee'],
    defaults: { quantity:'1', delivery_fee:'0', extra_area_delivery_fee:'0', item_order_status:'ordered', item_shipping_status:'pending' },
    enums: { delivery_type:['seller','bundle','fresh','rocket','rocket_fresh','unknown'], item_order_status:['ordered','cancelled','returned','exchanged'], item_shipping_status:['pending','preparing','shipped','in_transit','delivered','returned'] },
    blocked: ['created_at']
  },
  cs: {
    table: 'gm_cs',
    key: ['cs_no'],
    order: 'created_at DESC NULLS LAST',
    critical: ['cs_no','order_no','cs_type','cs_status'],
    numeric: [],
    defaults: { cs_status:'requested', return_confirm_yn:'N' },
    enums: {
      cs_type:['cs','return','exchange','cancel','refund','delivery','payment'],
      cs_status:['requested','processing','return_shipping','return_received','return_confirmed','reshipped','completed','cancelled'],
      return_confirm_yn:['Y','N']
    },
    blocked: ['cs_no','created_at','request_at']
  },
  cs_messages: {
    table: 'gm_cs_message',
    key: ['message_id'],
    order: 'created_at DESC NULLS LAST',
    critical: ['message_id','cs_no','order_no','sender_type','message_type'],
    numeric: ['message_id'],
    defaults: { sender_type:'customer', message_type:'text', read_yn:'N' },
    enums: {
      sender_type:['customer','seller','admin','system'],
      message_type:['text','image','file','system'],
      read_yn:['Y','N']
    },
    blocked: ['message_id','created_at']
  },
  member: {
    table: 'gm_member',
    key: ['member_id'],
    order: 'updated_at DESC NULLS LAST, created_at DESC NULLS LAST',
    critical: ['member_id'],
    numeric: ['deposit_balance','bonus_balance','usable_balance','refund_balance','point_balance'],
    defaults: { language_code:'ko', cs_language:'ko', member_status:'active' },
    enums: { member_status:['active','guest','withdrawn','dormant','blocked'] },
    blocked: ['created_at','password_hash','password_algo','password_updated_at','password_migrated'],
    allowInsert: true
  },
  member_address: {
    table: 'gm_member_address',
    key: ['address_id'],
    order: 'member_id ASC, is_default DESC, updated_at DESC NULLS LAST',
    critical: ['address_id','member_id'],
    numeric: [],
    defaults: { address_name:'기본배송지', is_default:'Y' },
    enums: { is_default:['Y','N'] },
    blocked: ['created_at'],
    allowInsert: true
  },
  supplier: {
    table: 'gm_supplier',
    key: ['gm_supplier_id'],
    order: 'updated_at DESC NULLS LAST, created_at DESC NULLS LAST',
    critical: ['gm_supplier_id','seller_name'],
    numeric: [],
    defaults: { status:'active' },
    enums: { status:['active','inactive','blocked','deleted'] },
    blocked: ['created_at']
  },
  product_archive: {
    table: 'gm_product_archive',
    key: ['product_uid'],
    order: 'expire_date DESC NULLS LAST, updated_at DESC NULLS LAST',
    critical: ['product_uid'],
    numeric: ['mall_sale_price','customer_sale_price','final_supply_price','normal_price','discount_price','delivery_fee','unit_price_value','unit_base_qty','unit_norm_qty','unit_norm_price','option_count','return_shipping_fee','exchange_shipping_fee','return_period_days','exchange_period_days','view_count','search_count','wish_count','cart_count','order_count','sales_qty','sales_amount','purchase_amount','gross_profit','return_count','exchange_count','ad_view_count','ad_order_count','ad_sales_qty','ad_sales_amount'],
    defaults: { archive_reason:'EXPIRE', archive_source:'SYSTEM', return_available_yn:'Y', exchange_available_yn:'Y' },
    enums: { return_available_yn:['Y','N'], exchange_available_yn:['Y','N'] },
    blocked: ['created_at']
  },
  category: {
    table: 'gm_category',
    // DEV: use Coupang category no as the upsert key. Before official launch this can be changed to ['gm_code'].
    key: ['cp_code'],
    keyAny: [['cp_code'], ['gm_code']],
    deleteKeys: [['category_id'], ['cp_code'], ['gm_code']],
    order: 'depth ASC, sort_order ASC, gm_code ASC',
    critical: ['cp_code','gm_code','name_ko'],
    numeric: ['category_id','depth','sort_order','view_count','search_count','wish_count','cart_count','order_count','sales_qty','sales_amount','purchase_amount','gross_profit','return_count','exchange_count','ad_view_count','ad_order_count','ad_sales_qty','ad_sales_amount'],
    defaults: { leaf_yn:'N', display_yn:'Y', depth:'0', sort_order:'0' },
    enums: { leaf_yn:['Y','N'], display_yn:['Y','N'] },
    // Do not overwrite AI/runtime learning columns or counters from translation uploads.
    blocked: ['category_id','created_at','cp_id','view_count','search_count','wish_count','cart_count','order_count','sales_qty','sales_amount','purchase_amount','gross_profit','return_count','exchange_count','ad_view_count','ad_order_count','ad_sales_qty','ad_sales_amount','last_search_at','last_view_at','last_order_at','last_return_at','last_exchange_at','last_ad_view_at','last_ad_order_at'],
    allowInsert: true
  },

  category_keyword: {
    table: 'gm_category_keyword',
    key: ['keyword_normalized','lang_code','country_code','category_no'],
    order: 'updated_at DESC NULLS LAST, last_seen_at DESC NULLS LAST',
    critical: ['keyword_original','keyword_normalized'],
    numeric: ['keyword_id','confidence_score','search_count'],
    defaults: { source:'manual', status:'active', confidence_score:'1.0', search_count:'0' },
    enums: { status:['active','confirmed','auto','disabled','excluded'], source:['manual','auto','system','import'] },
    blocked: ['keyword_id','created_at'],
    allowInsert: true
  },
  search_keyword_stat: {
    table: 'gm_search_keyword_stat',
    key: ['keyword_normalized','country_code','lang_code','category_no','mall_code'],
    order: 'search_count DESC, last_search_at DESC NULLS LAST',
    critical: ['keyword_normalized'],
    numeric: ['stat_id','search_count','cache_used_count','cache_miss_count','result_count_sum','db_insert_count_sum','queue_send_count_sum'],
    defaults: { country_code:'', lang_code:'', category_no:'', mall_code:'', search_count:'0' },
    enums: {},
    blocked: ['stat_id','created_at']
  },
  category_search_stat: {
    table: 'gm_category_search_stat',
    key: ['category_no','country_code','lang_code','mall_code'],
    order: 'search_count DESC, last_search_at DESC NULLS LAST',
    critical: ['category_no'],
    numeric: ['stat_id','search_count','cache_used_count','cache_miss_count','result_count_sum','db_insert_count_sum','queue_send_count_sum'],
    defaults: { country_code:'', lang_code:'', mall_code:'', search_count:'0' },
    enums: {},
    blocked: ['stat_id','created_at']
  },
  category_search_monthly: {
    table: 'gm_category_search_monthly',
    key: ['yyyymm','category_no','country_code','lang_code','mall_code'],
    order: 'yyyymm DESC, search_count DESC, last_search_at DESC NULLS LAST',
    critical: ['yyyymm','category_no'],
    numeric: ['monthly_id','search_count','cache_used_count','cache_miss_count','result_count_sum','db_insert_count_sum','queue_send_count_sum'],
    defaults: { country_code:'', lang_code:'', mall_code:'', search_count:'0' },
    enums: {},
    blocked: ['monthly_id','created_at']
  },

  category_search_yearly: {
    table: 'gm_category_search_yearly',
    key: ['yyyy','category_no','mall_code'],
    order: 'yyyy DESC, total_count DESC, last_search_at DESC NULLS LAST',
    critical: ['yyyy','category_no'],
    numeric: ['yearly_id','total_count','ko_count','en_count','zh_count','vi_count','ja_count','tw_count','th_count','uz_count','ne_count','km_count','id_count','tl_count','mn_count','my_count','kk_count','si_count','ru_count','bn_count','ur_count','lo_count','hi_count','tr_count','fa_count','es_count','fr_count'],
    defaults: { mall_code:'', total_count:'0' }, enums: {}, blocked: ['yearly_id','created_at']
  },
  product_sales_monthly: { table:'gm_product_sales_monthly', key:['yyyymm','product_uid'], order:'yyyymm DESC, sales_amount DESC', critical:['yyyymm','product_uid'], numeric:['sales_id','search_count','sales_qty','sales_amount','purchase_amount','gross_profit','margin_rate'], defaults:{search_count:'0',sales_qty:'0',sales_amount:'0',purchase_amount:'0'}, enums:{}, blocked:['sales_id','created_at'] },
  product_sales_yearly: { table:'gm_product_sales_yearly', key:['yyyy','product_uid'], order:'yyyy DESC, sales_amount DESC', critical:['yyyy','product_uid'], numeric:['sales_id','search_count','sales_qty','sales_amount','purchase_amount','gross_profit','margin_rate'], defaults:{search_count:'0',sales_qty:'0',sales_amount:'0',purchase_amount:'0'}, enums:{}, blocked:['sales_id','created_at'] },
  product_country_sales_monthly: { table:'gm_product_country_sales_monthly', key:['yyyymm','product_uid','country_code'], order:'yyyymm DESC, sales_amount DESC', critical:['yyyymm','product_uid','country_code'], numeric:['sales_id','sales_qty','sales_amount','purchase_amount'], defaults:{sales_qty:'0',sales_amount:'0',purchase_amount:'0'}, enums:{}, blocked:['sales_id','created_at'] },
  product_country_sales_yearly: { table:'gm_product_country_sales_yearly', key:['yyyy','product_uid','country_code'], order:'yyyy DESC, sales_amount DESC', critical:['yyyy','product_uid','country_code'], numeric:['sales_id','sales_qty','sales_amount','purchase_amount'], defaults:{sales_qty:'0',sales_amount:'0',purchase_amount:'0'}, enums:{}, blocked:['sales_id','created_at'] },
  category_sales_monthly: { table:'gm_category_sales_monthly', key:['yyyymm','category_no'], order:'yyyymm DESC, sales_amount DESC', critical:['yyyymm','category_no'], numeric:['sales_id','sales_qty','sales_amount','purchase_amount','gross_profit','margin_rate'], defaults:{sales_qty:'0',sales_amount:'0',purchase_amount:'0'}, enums:{}, blocked:['sales_id','created_at'] },
  category_sales_yearly: { table:'gm_category_sales_yearly', key:['yyyy','category_no'], order:'yyyy DESC, sales_amount DESC', critical:['yyyy','category_no'], numeric:['sales_id','sales_qty','sales_amount','purchase_amount','gross_profit','margin_rate'], defaults:{sales_qty:'0',sales_amount:'0',purchase_amount:'0'}, enums:{}, blocked:['sales_id','created_at'] },
  category_country_sales_monthly: { table:'gm_category_country_sales_monthly', key:['yyyymm','category_no','country_code'], order:'yyyymm DESC, sales_amount DESC', critical:['yyyymm','category_no','country_code'], numeric:['sales_id','sales_qty','sales_amount','purchase_amount'], defaults:{sales_qty:'0',sales_amount:'0',purchase_amount:'0'}, enums:{}, blocked:['sales_id','created_at'] },
  category_country_sales_yearly: { table:'gm_category_country_sales_yearly', key:['yyyy','category_no','country_code'], order:'yyyy DESC, sales_amount DESC', critical:['yyyy','category_no','country_code'], numeric:['sales_id','sales_qty','sales_amount','purchase_amount'], defaults:{sales_qty:'0',sales_amount:'0',purchase_amount:'0'}, enums:{}, blocked:['sales_id','created_at'] },


  keyword_translate: {
    table: 'gm_keyword_translate',
    key: ['lang','input_keyword'],
    order: 'updated_at DESC NULLS LAST, hit_count DESC, lang ASC, input_keyword ASC',
    critical: ['lang','input_keyword','main_keyword_ko'],
    numeric: ['hit_count'],
    defaults: { hit_count:'1' },
    enums: {},
    blocked: ['updated_at'],
    allowInsert: true
  },
  keyword_relation: {
    table: 'gm_keyword_relation',
    key: ['keyword_ko','related_keyword_ko'],
    order: 'updated_at DESC NULLS LAST, keyword_ko ASC, related_keyword_ko ASC',
    critical: ['keyword_ko','related_keyword_ko'],
    numeric: [],
    defaults: { category_main_keyword_ko:'' },
    enums: {},
    blocked: ['updated_at'],
    allowInsert: true
  },
  search_log: {
    table: 'gm_search_log',
    key: ['search_id'],
    order: 'search_at DESC NULLS LAST, created_at DESC NULLS LAST',
    critical: ['search_id'],
    numeric: ['search_id','result_count','db_insert_count','queue_send_count'],
    defaults: { cache_used:'false' },
    enums: {},
    blocked: ['search_id','search_at','created_at']
  },

  smartfit_space: {
    table: 'gm_smartfit_space',
    key: ['space_id'],
    order: 'updated_at DESC NULLS LAST, created_at DESC NULLS LAST, space_id DESC',
    critical: ['space_id'],
    numeric: ['space_id','image_count','sort_no','sort_order'],
    defaults: { source_lang:'ko', category_no:'ROOT', image_count:'0', visibility:'private', search_visible:'T', favorite_yn:'F', sort_no:'0', is_active:'T', is_deleted:'F' },
    enums: { visibility:['draft','private','public'], search_visible:['T','F','Y','N'], favorite_yn:['T','F','Y','N'], is_active:['T','F','Y','N'], is_deleted:['T','F','Y','N'] },
    blocked: ['space_id','created_at']
  },
  smartfit_template: {
    table: 'gm_smartfit_template',
    key: ['template_id'],
    order: 'updated_at DESC NULLS LAST, created_at DESC NULLS LAST, template_id DESC',
    critical: ['template_id'],
    numeric: ['template_id','space_id','image_count','keyword_count','sort_no','use_count','item_count','view_count','visit_count','collection_count','reuse_count','build_cart_count','item_add_count','review_count','rating_sum','rating_avg'],
    defaults: { source_lang:'ko', category_no:'ROOT', image_count:'0', keyword_count:'0', visibility:'private', search_visible:'T', favorite_yn:'F', sort_no:'0', content_json:'{}', use_count:'0', item_count:'0', is_active:'T', is_deleted:'F' },
    enums: { visibility:['draft','private','public'], search_visible:['T','F','Y','N'], favorite_yn:['T','F','Y','N'], is_active:['T','F','Y','N'], is_deleted:['T','F','Y','N'] },
    blocked: ['template_id','created_at']
  },
  smartfit_item: {
    table: 'gm_smartfit_item',
    key: ['item_id'],
    order: 'template_id ASC, sort_no ASC, item_id ASC',
    critical: ['item_id'],
    numeric: ['item_id','template_id','qty','sort_no'],
    defaults: { item_role:'ETC', qty:'1', sort_no:'0', is_active:'T', is_deleted:'F' },
    enums: { is_active:['T','F','Y','N'], is_deleted:['T','F','Y','N'] },
    blocked: ['item_id','created_at']
  },
  smartfit_collection: {
    table: 'gm_smartfit_collection',
    key: ['member_id','template_id'],
    order: 'updated_at DESC NULLS LAST, collected_at DESC NULLS LAST',
    critical: ['member_id','template_id'],
    numeric: ['template_id','use_count'],
    defaults: { use_count:'0', is_active:'T', is_deleted:'F' },
    enums: { is_active:['T','F','Y','N'], is_deleted:['T','F','Y','N'] },
    blocked: ['collected_at','created_at']
  },
  smartfit_category: {
    table: 'gm_smartfit_category',
    key: ['category_code'],
    order: 'depth ASC, display_order ASC, category_code ASC',
    critical: ['category_code'],
    numeric: ['depth','display_order'],
    defaults: { parent_code:'', depth:'1', leaf_yn:'F', display_order:'0', is_active:'T' },
    enums: { leaf_yn:['T','F','Y','N'], is_active:['T','F','Y','N'] },
    blocked: []
  },

  category_dynamic: { table:'gm_category_dynamic', key:['id'], order:'updated_at DESC NULLS LAST, id DESC', critical:['id'], numeric:['id'], defaults:{}, enums:{}, blocked:['id','created_at'] },
  product_interest: { table:'gm_product_interest', keyAny:[['member_id','mall_code','pi_ii_vi'],['guest_key','mall_code','pi_ii_vi']], order:'last_visited_at DESC NULLS LAST, mall_code ASC, pi_ii_vi ASC', critical:['mall_code','pi_ii_vi'], numeric:[], defaults:{}, enums:{}, blocked:['created_at'] },
  product_upsert_queue: { table:'gm_product_upsert_queue', key:['queue_id'], order:'created_at DESC NULLS LAST, queue_id DESC', critical:['queue_id'], numeric:['queue_id','retry_count'], defaults:{}, enums:{}, blocked:['queue_id','created_at'] },
  sales_aggregate_event: { table:'gm_sales_aggregate_event', key:['id'], order:'created_at DESC NULLS LAST, id DESC', critical:['id'], numeric:['id'], defaults:{}, enums:{}, blocked:['id','created_at'] },
  member_ledger: { table:'gm_member_ledger', key:['ledger_id'], order:'created_at DESC NULLS LAST, ledger_id DESC', critical:['ledger_id'], numeric:['ledger_id'], defaults:{}, enums:{}, blocked:['ledger_id','created_at'] },
  member_payment_info: { table:'gm_member_payment_info', key:['member_id'], order:'updated_at DESC NULLS LAST, member_id ASC', critical:['member_id'], numeric:[], defaults:{}, enums:{}, blocked:['created_at'] },
  member_device: { table:'gm_member_device', key:['id'], order:'updated_at DESC NULLS LAST, id DESC', critical:['id'], numeric:['id'], defaults:{}, enums:{}, blocked:['id','created_at'] },
  member_relation_count: { table:'gm_member_relation_count', key:['member_id'], order:'member_id ASC', critical:['member_id'], numeric:[], defaults:{}, enums:{}, blocked:['created_at'] },
  guest_member_link: { table:'gm_guest_member_link', key:['guest_key'], order:'updated_at DESC NULLS LAST, guest_key ASC', critical:['guest_key'], numeric:[], defaults:{}, enums:{}, blocked:['created_at'] },
  network_incentive_rate: { table:'gm_network_incentive_rate', key:['step_no','effective_from'], order:'effective_from DESC, step_no ASC', critical:['step_no','effective_from'], numeric:['step_no'], defaults:{}, enums:{}, blocked:['created_at'] },
  network_payment_snapshot: { table:'gm_network_payment_snapshot', key:['snapshot_id'], order:'created_at DESC NULLS LAST, snapshot_id DESC', critical:['snapshot_id'], numeric:['snapshot_id'], defaults:{}, enums:{}, blocked:['snapshot_id','created_at'] },
  message_policy: { table:'gm_message_policy', key:['message_type'], order:'message_type ASC', critical:['message_type'], numeric:[], defaults:{}, enums:{}, blocked:['created_at'] },
  message_personal: { table:'gm_message_personal', key:['id'], order:'created_at DESC NULLS LAST, id DESC', critical:['id'], numeric:['id'], defaults:{}, enums:{}, blocked:['id','created_at'] },
  message_broadcast: { table:'gm_message_broadcast', key:['id'], order:'created_at DESC NULLS LAST, id DESC', critical:['id'], numeric:['id'], defaults:{}, enums:{}, blocked:['id','created_at'] },
  message_broadcast_receive: { table:'gm_message_broadcast_receive', key:['broadcast_no','member_id'], order:'received_at DESC NULLS LAST, broadcast_no DESC', critical:['broadcast_no','member_id'], numeric:[], defaults:{}, enums:{}, blocked:['created_at'] },
  message_share: { table:'gm_message_share', key:['id'], order:'created_at DESC NULLS LAST, id DESC', critical:['id'], numeric:['id'], defaults:{}, enums:{}, blocked:['id','created_at'] },
  message_share_receiver: { table:'gm_message_share_receiver', key:['id'], order:'created_at DESC NULLS LAST, id DESC', critical:['id'], numeric:['id'], defaults:{}, enums:{}, blocked:['id','created_at'] },
  message_counter_daily: { table:'gm_message_counter_daily', key:['counter_date','message_scope','message_type'], order:'counter_date DESC, message_scope ASC, message_type ASC', critical:['counter_date','message_scope','message_type'], numeric:[], defaults:{}, enums:{}, blocked:[] },
  message_broadcast_job: { table:'gm_message_broadcast_job', key:['job_no'], order:'created_at DESC NULLS LAST, job_no DESC', critical:['job_no'], numeric:[], defaults:{}, enums:{}, blocked:['created_at'] },
  order_message: { table:'gm_order_message', key:['message_id'], order:'sent_at DESC NULLS LAST, message_id DESC', critical:['message_id'], numeric:['message_id'], defaults:{}, enums:{}, blocked:['message_id','created_at'] },
  event_queue: { table:'gm_event_queue', key:['id'], order:'created_at DESC NULLS LAST, id DESC', critical:['id'], numeric:['id','retry_count'], defaults:{}, enums:{}, blocked:['id','created_at'] },
  smartfit_internal_sale: { table:'gm_smartfit_internal_sale', key:['sale_id'], order:'created_at DESC NULLS LAST, sale_id DESC', critical:['sale_id'], numeric:['sale_id'], defaults:{}, enums:{}, blocked:['sale_id','created_at'] },
  smartfit_collection_item_delta: { table:'gm_smartfit_collection_item_delta', key:['delta_id'], order:'created_at DESC NULLS LAST, delta_id DESC', critical:['delta_id'], numeric:['delta_id'], defaults:{}, enums:{}, blocked:['delta_id','created_at'] },
  smartfit_space_subscriber: { table:'gm_smartfit_space_subscriber', key:['space_no','member_id'], order:'subscribed_at DESC NULLS LAST, space_no DESC', critical:['space_no','member_id'], numeric:[], defaults:{}, enums:{}, blocked:['created_at'] },
  smartfit_subscribe: { table:'gm_smartfit_subscribe', key:['member_id','creator_member_id'], order:'member_id ASC, creator_member_id ASC', critical:['member_id','creator_member_id'], numeric:[], defaults:{}, enums:{}, blocked:['created_at'] },
  smartfit_message_receiver: { table:'gm_smartfit_message_receiver', key:['message_no'], order:'sent_at DESC NULLS LAST, message_no DESC', critical:['message_no'], numeric:[], defaults:{}, enums:{}, blocked:['created_at'] },
  auto_orders: {
    table: 'gm_auto_order',
    key: ['auto_order_no'],
    order: 'created_at DESC NULLS LAST, auto_order_no DESC',
    critical: ['auto_order_no','order_no','member_id','mall_code'],
    numeric: ['received_item_count','ordered_item_count','total_product_price','discount_amount','total_delivery_fee','extra_area_delivery_fee','actual_payment_amount'],
    defaults: {}, enums: {}, blocked: ['auto_order_no','created_at']
  },
  auto_order_items: {
    table: 'gm_auto_order_item',
    key: ['auto_order_item_id'],
    order: 'created_at DESC NULLS LAST, auto_order_item_id DESC',
    critical: ['auto_order_item_id','auto_order_no','order_no','mall_code'],
    numeric: ['auto_order_item_id','quantity','ordered_quantity','mall_sale_price','order_attempt_price','ordered_price','item_discount_amount','product_amount'],
    defaults: {}, enums: {}, blocked: ['auto_order_item_id','created_at']
  },
  auto_order_work: {
    table: 'gm_auto_order_work',
    key: ['work_id'],
    order: 'created_at DESC NULLS LAST, work_id DESC',
    critical: ['work_id','auto_order_no','work_type','work_status'],
    numeric: ['work_id','priority'],
    defaults: {}, enums: {}, blocked: ['work_id','created_at']
  },
  auto_order_log: {
    table: 'gm_auto_order_log',
    key: ['log_id'],
    order: 'created_at DESC NULLS LAST, log_id DESC',
    critical: ['log_id','auto_order_no','action_type'],
    numeric: ['log_id','auto_order_item_id','work_id'],
    defaults: {}, enums: {}, blocked: ['log_id','created_at']
  },
  auto_order_accounts: {
    table: 'gm_auto_order_account',
    key: ['account_admin_id'],
    order: 'updated_at DESC NULLS LAST, account_admin_id DESC',
    critical: ['account_admin_id','admin_id','account_admin_role'],
    numeric: ['account_admin_id'],
    defaults: {}, enums: {},
    blocked: ['account_admin_id','encrypted_password','created_at']
  },

  dashboard_snapshot: {
    table: 'gm_dashboard_snapshot',
    key: ['snapshot_id'],
    order: 'snapshot_at DESC NULLS LAST, created_at DESC NULLS LAST',
    critical: ['snapshot_id'],
    numeric: ['snapshot_id','gm_product_count','gm_product_archive_count','gm_category_count','gm_category_keyword_count','gm_search_keyword_stat_count','gm_category_search_stat_count','gm_basket_count','gm_order_count','gm_order_item_count','gm_supplier_count','gm_cs_count','gm_cs_message_count','gm_search_log_count','queue_pending_count','queue_processing_count','queue_done_count','queue_failed_count','queue_total_count','member_count','today_order_count','today_order_amount','today_product_view_count','today_search_count','db_size_bytes','db_size_mb','db_size_percent','db_size_limit_mb','api_response_ms'],
    defaults: {},
    enums: {},
    blocked: ['snapshot_id','snapshot_at','created_at']
  }
};

const LIMITS = {
  MAX_ROWS: 50000,
  BATCH_SIZE: 300,
  MAX_INVALID: 500,
  MAX_INVALID_RATE: 0.10
};

function dbFrom(req) {
  return req.app.locals.db || req.app.locals.pool;
}

// 자동주문 Builder 전용 키 인증은 제거했다.
// 향후 Cafe24 관리자 로그인/권한 확인으로 접근제어를 통합한다.
function ok(res, data) {
  res.json({ ok:true, version:VERSION, ...data });
}
function fail(res, status, error, extra={}) {
  res.status(status).json({ ok:false, version:VERSION, error, ...extra });
}
function qIdent(s) {
  return '"' + String(s).replace(/"/g, '""') + '"';
}
function clean(v) {
  return String(v ?? '').replace(/^\ufeff/, '').trim();
}
function csvEscape(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') v = JSON.stringify(v);
  v = String(v);
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function toCsv(rows, columns) {
  const lines = [columns.map(csvEscape).join(',')];
  for (const r of rows) lines.push(columns.map(c => csvEscape(r[c])).join(','));
  return '\ufeff' + lines.join('\n');
}

// GM_BUILDER_EXPORT_ALL_ZIP_V001
// 외부 라이브러리 없이 CSV 여러 개를 ZIP으로 묶는다.
function crc32Buffer(buf){
  let table = crc32Buffer.table;
  if(!table){
    table = crc32Buffer.table = new Uint32Array(256);
    for(let i=0;i<256;i++){
      let c=i;
      for(let k=0;k<8;k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[i]=c>>>0;
    }
  }
  let crc = 0xFFFFFFFF;
  for(let i=0;i<buf.length;i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function dosDateTime(d=new Date()){
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | (Math.floor(d.getSeconds()/2) & 31);
  const date = (((d.getFullYear()-1980) & 127) << 9) | (((d.getMonth()+1) & 15) << 5) | (d.getDate() & 31);
  return {time,date};
}
function u16(n){ const b=Buffer.alloc(2); b.writeUInt16LE(n & 0xFFFF,0); return b; }
function u32(n){ const b=Buffer.alloc(4); b.writeUInt32LE(n >>> 0,0); return b; }
function makeZip(files){
  const local=[], central=[];
  let offset=0;
  const dt=dosDateTime();
  for(const f of files){
    const nameBuf=Buffer.from(f.name,'utf8');
    const data=Buffer.isBuffer(f.data)?f.data:Buffer.from(String(f.data||''),'utf8');
    const crc=crc32Buffer(data);
    const lh=Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(dt.time), u16(dt.date),
      u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), nameBuf
    ]);
    local.push(lh,data);
    const ch=Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(dt.time), u16(dt.date),
      u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), nameBuf
    ]);
    central.push(ch);
    offset += lh.length + data.length;
  }
  const centralSize=central.reduce((a,b)=>a+b.length,0);
  const end=Buffer.concat([u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),u32(centralSize),u32(offset),u16(0)]);
  return Buffer.concat([...local,...central,end]);
}
function parseCsv(text) {
  text = String(text || '').replace(/^\ufeff/, '');
  const rows = [];
  let row = [], cell = '', quote = false;
  for (let i=0; i<text.length; i++) {
    const ch = text[i], nx = text[i+1];
    if (quote) {
      if (ch === '"' && nx === '"') { cell += '"'; i++; }
      else if (ch === '"') quote = false;
      else cell += ch;
    } else {
      if (ch === '"') quote = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row=[]; cell=''; }
      else if (ch !== '\r') cell += ch;
    }
  }
  row.push(cell);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  if (!rows.length) return [];
  const header = rows.shift().map(h => clean(h));
  return rows
    .filter(r => r.some(v => clean(v) !== ''))
    .map((r, idx) => {
      const o = { __row_no: idx + 2 };
      header.forEach((h,i)=>{ if (h) o[h] = r[i] ?? ''; });
      return o;
    });
}
async function getColumns(db, table) {
  const r = await db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1
    ORDER BY ordinal_position
  `, [table]);
  return r.rows.map(x => x.column_name);
}
function tableSpec(key) {
  return TABLES[String(key || '').trim()] || null;
}
function keySets(spec) {
  return spec.keyAny || [spec.key];
}
function pickKey(row, spec) {
  for (const ks of keySets(spec)) {
    const ok = ks.every(k => clean(row[k]) !== '');
    if (ok) return { keys:ks, values:ks.map(k => clean(row[k])), label:ks.map(k => clean(row[k])).join('+') };
  }
  return null;
}

function deleteKeySets(spec, columns=[]) {
  const colSet = new Set(columns || []);
  const sets = [];
  function add(ks){
    if(!Array.isArray(ks) || !ks.length) return;
    const cleanKs = ks.map(k => clean(k)).filter(Boolean);
    if(!cleanKs.length) return;
    if(colSet.size && !cleanKs.every(k => colSet.has(k))) return;
    const sig = cleanKs.join('|');
    if(!sets.some(x => x.join('|') === sig)) sets.push(cleanKs);
  }
  (spec.deleteKeys || []).forEach(add);
  keySets(spec).forEach(add);
  if(!sets.length && Array.isArray(columns)){
    for(const c of ['id','category_id','product_uid','order_no','message_id','address_id','gm_code','cp_code']){
      if(colSet.has(c)){ add([c]); break; }
    }
  }
  return sets;
}
function pickDeleteKey(row, spec, columns=[]) {
  for(const ks of deleteKeySets(spec, columns)){
    const ok = ks.every(k => clean(row[k]) !== '');
    if(ok) return { keys:ks, values:ks.map(k => clean(row[k])), label:ks.map(k => clean(row[k])).join('+') };
  }
  return null;
}
function rowLabel(row, columns=[]) {
  const preferred = ['category_id','gm_code','cp_code','name_ko','product_uid','pi_ii_vi','product_name','title','keyword','order_no','member_id','created_at','updated_at'];
  const parts = [];
  for(const c of preferred){
    if(columns.includes(c) && clean(row[c]) !== '') parts.push(`${c}=${clean(row[c])}`);
    if(parts.length >= 6) break;
  }
  if(parts.length) return parts.join(' | ');
  return columns.slice(0,8).map(c => `${c}=${clean(row[c])}`).join(' | ');
}
function deleteConfirmOk(req){
  return clean((req.query && req.query.confirm) || (req.body && req.body.confirm) || '') === 'DELETE SELECTED';
}
function isNumberValue(v) {
  if (v === null || v === undefined || clean(v) === '') return false;
  const n = Number(String(v).replace(/,/g,''));
  return Number.isFinite(n) && n >= 0;
}
function normalizeNumber(v) {
  const n = Number(String(v).replace(/,/g,''));
  return Number.isFinite(n) ? n : null;
}
function validateCell(col, rawValue, spec) {
  let value = clean(rawValue);
  const hasValue = value !== '';

  if (!hasValue && Object.prototype.hasOwnProperty.call(spec.defaults || {}, col)) {
    value = spec.defaults[col];
  }

  if (!hasValue && (spec.critical || []).includes(col)) {
    return { ok:false, value, reason:'CRITICAL_EMPTY' };
  }

  if (!hasValue) {
    return { ok:true, value:null, action:'KEEP_OLD' };
  }

  if ((spec.numeric || []).includes(col)) {
    if (!isNumberValue(value)) return { ok:false, value, reason:'INVALID_NUMBER' };
    return { ok:true, value:normalizeNumber(value) };
  }

  if (spec.enums && spec.enums[col]) {
    if (!spec.enums[col].includes(value)) {
      return { ok:false, value, reason:'INVALID_ENUM:' + spec.enums[col].join('|') };
    }
  }

  if (col.endsWith('_url') || col === 'product_url' || col === 'thumb_origin_url' || col === 'file_url') {
    if (value && !/^https?:\/\//i.test(value)) {
      return { ok:false, value, reason:'INVALID_URL' };
    }
  }

  return { ok:true, value };
}
function shouldStop(invalid, processed) {
  if (invalid >= LIMITS.MAX_INVALID) return 'MAX_INVALID';
  if (processed >= 100 && invalid / processed > LIMITS.MAX_INVALID_RATE) return 'MAX_INVALID_RATE';
  return '';
}
function resultRow(rowNo, table, key, result, column, value, reason) {
  return { row_no:rowNo, table, key:key || '', result, column_name:column || '', value:value ?? '', reason:reason || '' };
}



const CAFE24_MEMBER_HEADERS = [
  'SNS ID 연동일시','SSO 연동 서비스명','e메일 수신여부','e메일 최근 수신 동의 일자','가입시간','개인인증방법','개인정보 수집 및 이용 동의 여부(주문서 간단 회원가입 시)','개인정보 수집 및 이용 동의 일자(주문서 간단 회원가입 시)','개인정보 제3자 제공 동의 여부','개인정보 제3자 제공 동의 일자','개인정보 처리 위탁 동의 여부','개인정보 처리 위탁 동의 일자','결혼기념일','결혼여부','관심분야','국가','국적','국제면허번호','나이','누적주문건수','답변','도시 (City)','마케팅 목적의 개인정보 수집 및 이용 동의 여부','마케팅 목적의 개인정보 수집 및 이용 동의 일자','모바일 메시지 수신여부','모바일 메시지 최근 수신 동의 일자','모바일앱 이용여부','미가용 적립금','배우자생일','별명','불량회원','사업자구분(P:개인사업자/C:법인사업자)','사업자번호','사용가능 적립금','상호','생년월일','성별','실결제금액','실명인증여부','아이디','양력(T)/음력(F)','업태','여권번호','연동중인 SNS','연소득','영문이름','우편번호','이름','이름(발음)','이메일','인터넷이용장소','자녀','자동차','전화번호','접속 IP','종목','주 (State/Province)','주소1','주소2','지역','직업','직종','총 방문횟수(1년 내)','총 사용 적립금','총 실주문건수','총구매금액','총예치금','총적립금','최종접속일','최종주문일','최종학력','추가사항1','추가사항2','추가사항3','추가사항4','추천인 아이디','탈퇴구분','탈퇴사유','탈퇴여부','탈퇴일','특별회원','평생회원','평생회원 전환일','확인질문','환불계좌정보(은행/계좌/예금주)','회원 가입경로','회원 가입일','회원구분','회원등급','회원등급적용형태','회원등급코드','회원인증여부','휴대폰번호','휴면안내(대량메일) 발송일','휴면처리일','휴면회원 해제일'
];
function isBlankCafe24(v) {
  const x = clean(v);
  return !x || /^(BLANK|NULL|N\/A|-|없음)$/i.test(x);
}
function pickKorRaw(row, names, d='') {
  for (const n of names) if (row[n] !== undefined && row[n] !== null) return clean(row[n]);
  return d;
}
function moneyOrBlank(v) {
  if (isBlankCafe24(v)) return '';
  const n = Number(clean(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : '';
}
function intOrBlank(v) { return moneyOrBlank(v); }
function languageFromCafe24(nationality, country) {
  const x = (clean(nationality) || clean(country)).toLowerCase();
  if (!x) return '';
  const rules = [
    [/베트남|vietnam|viet/, 'vi'], [/중국|china|chinese|cn/, 'zh'], [/대만|taiwan|tw/, 'tw'], [/일본|japan|jp/, 'ja'],
    [/태국|thailand|thai/, 'th'], [/우즈베키스탄|uzbek/, 'uz'], [/네팔|nepal/, 'ne'], [/캄보디아|cambodia|khmer/, 'km'],
    [/인도네시아|indonesia/, 'id'], [/필리핀|philippines|filipino/, 'tl'], [/몽골|mongol/, 'mn'], [/미얀마|myanmar|burma/, 'my'],
    [/카자흐|kazakh/, 'kk'], [/스리랑카|sri\s*lanka/, 'si'], [/러시아|russia/, 'ru'], [/방글라데시|bangladesh/, 'bn'],
    [/파키스탄|pakistan|urdu/, 'ur'], [/라오스|laos/, 'lo'], [/인도|india|hindi/, 'hi'], [/튀르키|터키|turkey/, 'tr'],
    [/이란|iran|persia/, 'fa'], [/스페인|spain|spanish/, 'es'], [/프랑스|france|french/, 'fr'], [/한국|대한민국|korea|kr/, 'ko']
  ];
  for (const [re, lang] of rules) if (re.test(x)) return lang;
  return 'ko';
}
function parseRawJson(v){
  try { if (!v) return {}; if (typeof v === 'object') return v; return JSON.parse(v); } catch(e){ return {}; }
}
function rawOrFallback(raw, header, fallback='') {
  const v = raw && Object.prototype.hasOwnProperty.call(raw, header) ? raw[header] : '';
  return isBlankCafe24(v) ? fallback : clean(v);
}

function pickKor(row, names, d='') {
  for (const n of names) {
    if (row[n] !== undefined && row[n] !== null && !isBlankCafe24(row[n])) return clean(row[n]);
  }
  return d;
}
function digits(v) {
  return clean(v).replace(/[^0-9]/g, '');
}
function money(v) {
  const n = Number(clean(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
}
function splitRefundInfo(v) {
  const raw = clean(v);
  const out = { bank:'', account:'', holder:'' };
  if (!raw) return out;
  // Cafe24 export is usually "은행/계좌/예금주", but tolerate spaces, pipes and commas.
  const parts = raw.split(/[\/|,]/).map(x=>clean(x)).filter(Boolean);
  if (parts.length >= 3) {
    out.bank = parts[0]; out.account = parts[1]; out.holder = parts.slice(2).join(' ');
  } else if (parts.length === 2) {
    out.bank = parts[0]; out.account = parts[1];
  } else {
    out.account = raw;
  }
  return out;
}

function ynCafe24(v) {
  const x = clean(v).toUpperCase();
  if (!x) return '';
  if (['T','Y','YES','TRUE','1','동의','수신'].includes(x)) return 'Y';
  if (['F','N','NO','FALSE','0','거부','미수신'].includes(x)) return 'N';
  return clean(v);
}
function intMoney(v) { return money(v); }
function intMoneyOrBlank(v) { return intOrBlank(v); }
function dateText(v) { return clean(v); }
function rawJsonText(row) {
  try { return JSON.stringify(row || {}); } catch(e) { return '{}'; }
}
function refundJoin(bank, account, holder) {
  return [clean(bank), clean(account), clean(holder)].filter(Boolean).join('/');
}
function cafe24Status(row) {
  const withdrawn = pickKor(row, ['탈퇴여부']);
  const dormant = pickKor(row, ['휴면처리일','휴면안내(대량메일) 발송일']);
  const bad = pickKor(row, ['불량회원']);
  if (/^(T|Y|1|TRUE|탈퇴)$/i.test(withdrawn)) return 'withdrawn';
  if (dormant) return 'dormant';
  if (/^(T|Y|1|TRUE)$/i.test(bad)) return 'blocked';
  return 'active';
}
function compactAddress(zip, a1, a2, old) {
  return [zip ? '[' + zip + ']' : '', a1, a2, old ? '(' + old + ')' : ''].filter(Boolean).join(' ').trim();
}
function mapCafe24Member(row) {
  const memberId = pickKor(row, ['아이디','ID','회원아이디','member_id']);
  const name = pickKor(row, ['이름','회원명']);
  const phone = pickKor(row, ['전화번호']);
  const mobile = pickKor(row, ['휴대폰번호']);
  const zip = pickKor(row, ['우편번호']);
  const addr1 = pickKor(row, ['주소1']);
  const addr2 = pickKor(row, ['주소2']);
  const sido = pickKor(row, ['주 (State/Province)','지역']);
  const city = pickKor(row, ['도시 (City)']);
  const refund = splitRefundInfo(pickKor(row, ['환불계좌정보(은행/계좌/예금주)']));
  const pointUsable = moneyOrBlank(pickKorRaw(row, ['사용가능 적립금']));
  const pointTotal = moneyOrBlank(pickKorRaw(row, ['총적립금']));
  const nationality = pickKor(row, ['국적']);
  const country = pickKor(row, ['국가']);
  const lang = languageFromCafe24(nationality, country);
  const member = {
    member_id: memberId,
    cafe24_member_id: memberId,
    member_name: name,
    member_name_en: pickKor(row, ['영문이름']),
    email: pickKor(row, ['이메일','이메일주소']),
    phone: mobile || phone,
    country_code: country,
    nationality: nationality,
    language_code: lang,
    cs_language: lang,
    recommender_id: pickKor(row, ['추천인 아이디']),
    member_grade: pickKor(row, ['회원등급']),
    member_grade_code: pickKor(row, ['회원등급코드']),
    member_status: cafe24Status(row),
    deposit_balance: moneyOrBlank(pickKorRaw(row, ['총예치금'])),
    point_balance: pointUsable !== '' ? pointUsable : pointTotal,
    refund_bank_name: refund.bank,
    refund_account_no: refund.account,
    refund_account_holder: refund.holder,
    default_receiver_name: name,
    default_receiver_phone: phone,
    default_receiver_mobile: mobile,
    default_zipcode: zip,
    default_address1: addr1,
    default_address2: addr2,
    default_address_old: '',
    default_address_full: compactAddress(zip, addr1, addr2, ''),
    default_sido: sido,
    default_sigungu: city,
    default_eup_myeon_dong: '',
    delivery_memo: '',
    // Cafe24 원본 96개 컬럼은 실제 DB 컬럼을 늘리지 않고 cafe24_raw_json 하나에 100% 보존한다.
    // gm_member에는 주문/로그인/배송에 바로 필요한 핵심 컬럼만 저장한다.
    cafe24_raw_json: rawJsonText(row)
  };
  const address = {
    address_id: memberId ? memberId + '_default' : '',
    member_id: memberId,
    address_name: '기본배송지',
    receiver_name: name,
    receiver_phone: phone,
    receiver_mobile: mobile,
    zipcode: zip,
    address1: addr1,
    address2: addr2,
    address_old: '',
    address_full: compactAddress(zip, addr1, addr2, ''),
    sido: sido,
    sigungu: city,
    eup_myeon_dong: '',
    delivery_memo: '',
    is_default: 'Y'
  };
  return { member, address };
}

function cafe24ImportResultRow(row, m, action, memberAction, addressAction, reason) {
  return {
    row_no: row.__row_no,
    member_id: m.member_id || '',
    result: action,
    member_action: memberAction || '',
    address_action: addressAction || '',
    name: m.member_name || '',
    email: m.email || '',
    phone: m.default_receiver_phone || '',
    mobile: m.default_receiver_mobile || '',
    zipcode: m.default_zipcode || '',
    address1: m.default_address1 || '',
    address2: m.default_address2 || '',
    member_grade: m.member_grade || '',
    member_grade_code: m.member_grade_code || '',
    deposit_balance: m.deposit_balance === undefined ? '' : m.deposit_balance,
    point_balance: m.point_balance === undefined ? '' : m.point_balance,
    refund_account_info: refundJoin(m.refund_bank_name, m.refund_account_no, m.refund_account_holder),
    total_order_count: intMoneyOrBlank(pickKorRaw(row, ['누적주문건수'])),
    total_purchase_amount: moneyOrBlank(pickKorRaw(row, ['총구매금액','실결제금액'])),
    last_login_at: pickKorRaw(row, ['최종접속일']),
    joined_at: pickKorRaw(row, ['회원 가입일']),
    reason: reason || ''
  };
}

async function upsertObject(client, table, obj, keyCols, allowBlank=false) {
  const cols = Object.keys(obj).filter(k => obj[k] !== undefined && obj[k] !== null && (allowBlank || clean(obj[k]) !== ''));
  if (!cols.length) return { action:'SKIP', reason:'NO_COLUMNS' };
  const vals = cols.map(k => obj[k]);
  const setCols = cols.filter(c => !keyCols.includes(c));
  const sql = `INSERT INTO ${qIdent(table)} (${cols.map(qIdent).join(',')}) VALUES (${cols.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT (${keyCols.map(qIdent).join(',')}) DO UPDATE SET ${setCols.map(c => `${qIdent(c)}=COALESCE(NULLIF(EXCLUDED.${qIdent(c)}::text,'')::${qIdent(table)}.${qIdent(c)}%TYPE,${qIdent(table)}.${qIdent(c)})`).join(',') || keyCols.map(c=>`${qIdent(c)}=EXCLUDED.${qIdent(c)}`).join(',')}, updated_at=NOW()`;
  // PostgreSQL cannot use table.column%TYPE in prepared SQL expression. Build a simpler blank-preserving query below.
  const updateSql = `INSERT INTO ${qIdent(table)} (${cols.map(qIdent).join(',')}) VALUES (${cols.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT (${keyCols.map(qIdent).join(',')}) DO UPDATE SET ${setCols.map(c => `${qIdent(c)}=CASE WHEN EXCLUDED.${qIdent(c)} IS NULL OR EXCLUDED.${qIdent(c)}::text='' THEN ${qIdent(table)}.${qIdent(c)} ELSE EXCLUDED.${qIdent(c)} END`).join(',') || keyCols.map(c=>`${qIdent(c)}=EXCLUDED.${qIdent(c)}`).join(',')}${cols.includes('updated_at') || setCols.includes('updated_at') ? '' : ', updated_at=NOW()'}`;
  await client.query(updateSql, vals);
  return { action:'UPSERT' };
}

router.get('/api/gm/builder/tables', (req,res)=>{
  ok(res, { tables:Object.keys(TABLES).map(k=>({ key:k, table:TABLES[k].table, keys:keySets(TABLES[k]) })) });
});

router.get('/api/gm/builder/delete-list', async (req,res)=>{
  const spec = tableSpec(req.query.table);
  if(!spec) return fail(res, 400, 'invalid table');
  const db = dbFrom(req);
  const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 1000);
  const offset = Math.max(Number(req.query.offset || 0), 0);
  const q = clean(req.query.q || '');
  try{
    let cols = await getColumns(db, spec.table);
    if(spec.table === 'gm_member') cols = cols.filter(c => !/^password_/i.test(c));
    const delSets = deleteKeySets(spec, cols);
    const textCols = cols.filter(c => !/^password_/i.test(c));
    const params=[];
    let where='';
    if(q){
      params.push('%' + q + '%');
      where = 'WHERE ' + textCols.map(c => `${qIdent(c)}::text ILIKE $1`).join(' OR ');
    }
    params.push(limit, offset);
    const sql = `SELECT ${cols.map(qIdent).join(', ')} FROM ${qIdent(spec.table)} ${where} ORDER BY ${spec.order} LIMIT $${params.length-1} OFFSET $${params.length}`;
    const r = await db.query(sql, params);
    const rows = r.rows.map(row => {
      const key = pickDeleteKey(row, spec, cols);
      const compact = {};
      for(const c of cols){
        const v = row[c];
        if(v === null || v === undefined || clean(v) === '') continue;
        compact[c] = typeof v === 'object' ? JSON.stringify(v) : String(v);
        if(Object.keys(compact).length >= 18) break;
      }
      return { key, label:rowLabel(row, cols), row:compact };
    });
    ok(res, { table:spec.table, key:String(req.query.table||''), columns:cols, deleteKeys:delSets, count:rows.length, limit, offset, q, rows });
  }catch(e){
    fail(res, 500, 'delete list failed', { detail:String(e && e.message || e) });
  }
});

function normalizeDeleteKeyInput(k){
  // accepts: {key:{category_id:'1'}}, {category_id:'1'}, {keys:['category_id'],values:['1']}
  const x = (k && k.key) ? k.key : k;
  if(x && Array.isArray(x.keys) && Array.isArray(x.values)){
    const o={};
    x.keys.forEach((c,i)=>{ if(clean(c)) o[clean(c)] = clean(x.values[i]); });
    return o;
  }
  const o={};
  Object.keys(x || {}).forEach(c=>{ if(clean(c) && c !== 'label') o[clean(c)] = clean(x[c]); });
  return o;
}

router.post('/api/gm/builder/delete-selected', express.json({ limit:'5mb' }), async (req,res)=>{
  const spec = tableSpec((req.query && req.query.table) || (req.body && req.body.table));
  if(!spec) return fail(res, 400, 'invalid table');
  if(!deleteConfirmOk(req)) return fail(res, 403, 'DELETE_CONFIRM_REQUIRED', { required:'DELETE SELECTED' });
  const keys = Array.isArray(req.body && req.body.keys) ? req.body.keys : [];
  if(!keys.length) return fail(res, 400, 'NO_KEYS');
  if(keys.length > 1000) return fail(res, 400, 'TOO_MANY_KEYS', { max:1000 });
  const db = dbFrom(req);
  const client = await db.connect();
  const result=[];
  let deleted=0;
  try{
    const cols = await getColumns(client, spec.table);
    const allowedSets = deleteKeySets(spec, cols);
    const allowed = allowedSets.map(ks => ks.join('|'));
    await client.query('BEGIN');

    // Fast and safest path for gm_category: delete by explicit category_id first.
    // V063: accept ids/category_ids from UI and avoid relying only on nested key parsing.
    if(spec.table === 'gm_category'){
      const ids=[];
      const nonIdKeys=[];
      const pushId=(v)=>{ const id=clean(v); if(/^\d+$/.test(id) && !ids.includes(id)) ids.push(id); };
      (Array.isArray(req.body && req.body.ids) ? req.body.ids : []).forEach(pushId);
      (Array.isArray(req.body && req.body.category_ids) ? req.body.category_ids : []).forEach(pushId);
      for(const k of keys){
        const obj = normalizeDeleteKeyInput(k);
        pushId(obj.category_id);
        // last-resort: allow a label/meta copied from UI to carry category_id=13384
        const blob = JSON.stringify(k || {});
        const m = blob.match(/category_id[\"'=:\s]+(\d+)/i);
        if(m) pushId(m[1]);
        if(!clean(obj.category_id)) nonIdKeys.push(obj);
      }
      if(ids.length){
        // category_id may be int/bigint/numeric depending on migration state. Text compare is safest for dev delete.
        const r = await client.query('DELETE FROM gm_category WHERE category_id::text = ANY($1::text[])', [ids]);
        deleted += r.rowCount || 0;
        result.push({ key:'category_id', action:'DELETE_BATCH_TEXT', requested:ids.length, deleted:r.rowCount || 0, ids:ids.slice(0,100) });
      }
      // keep support for cp_code/gm_code rows if no category_id exists.
      for(const obj of nonIdKeys){
        const ks = Object.keys(obj || {}).map(clean).filter(Boolean).sort();
        if(!ks.length){ result.push({ key:'', action:'SKIP', reason:'EMPTY_KEY' }); continue; }
        const sig = ks.join('|');
        if(!allowed.includes(sig)){ result.push({ key:JSON.stringify(obj), action:'SKIP', reason:'KEY_NOT_ALLOWED', allowed:allowedSets }); continue; }
        const vals = ks.map(c => clean(obj[c]));
        if(vals.some(v => v === '')){ result.push({ key:JSON.stringify(obj), action:'SKIP', reason:'EMPTY_VALUE' }); continue; }
        const where = ks.map((c,i)=>`${qIdent(c)}::text=$${i+1}`).join(' AND ');
        const r = await client.query(`DELETE FROM ${qIdent(spec.table)} WHERE ${where}`, vals);
        deleted += r.rowCount || 0;
        result.push({ key:ks.map((c,i)=>`${c}=${vals[i]}`).join('+'), action:'DELETE', deleted:r.rowCount || 0 });
      }
      await client.query('COMMIT');
      return ok(res, { table:spec.table, requested:keys.length, requested_ids:ids.length, deleted, result });
    }

    for(const k of keys){
      const obj = normalizeDeleteKeyInput(k);
      const ks = Object.keys(obj || {}).map(clean).filter(Boolean).sort();
      if(!ks.length){ result.push({ key:'', action:'SKIP', reason:'EMPTY_KEY' }); continue; }
      const sig = ks.join('|');
      if(!allowed.includes(sig)){
        result.push({ key:JSON.stringify(obj), action:'SKIP', reason:'KEY_NOT_ALLOWED', allowed:allowedSets });
        continue;
      }
      const vals = ks.map(c => clean(obj[c]));
      if(vals.some(v => v === '')){ result.push({ key:JSON.stringify(obj), action:'SKIP', reason:'EMPTY_VALUE' }); continue; }
      const where = ks.map((c,i)=>`${qIdent(c)}::text=$${i+1}`).join(' AND ');
      const r = await client.query(`DELETE FROM ${qIdent(spec.table)} WHERE ${where}`, vals);
      deleted += r.rowCount || 0;
      result.push({ key:ks.map((c,i)=>`${c}=${vals[i]}`).join('+'), action:'DELETE', deleted:r.rowCount || 0 });
    }
    await client.query('COMMIT');
    ok(res, { table:spec.table, requested:keys.length, deleted, result });
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    fail(res, 500, 'delete selected failed', { detail:String(e && e.message || e), deleted, result });
  }finally{
    client.release();
  }
});

router.get('/api/gm/builder/export', async (req,res)=>{
  const exportKey=clean(req.query.table);
  const spec = tableSpec(exportKey);
  if (!spec) return fail(res, 400, 'invalid table');

  const format = String(req.query.format || 'csv').toLowerCase();
  if (format !== 'csv') return fail(res, 400, 'only csv export is supported');

  const db = dbFrom(req);
  const rawLimit = req.query.limit === undefined ? 0 : Number(req.query.limit || 0);
  const limit = rawLimit > 0 ? Math.min(Math.max(rawLimit, 1), 200000) : 0;
  const requestedPageSize = Number(req.query.pageSize || 0);
  const defaultPageSize = spec.table === 'gm_product' ? 250 : 2000;
  const maxPageSize = spec.table === 'gm_product' ? 500 : 5000;
  const pageSize = Math.min(Math.max(requestedPageSize || defaultPageSize, 100), maxPageSize);
  const startedAt = Date.now();
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
  let aborted = false;
  let sent = 0;
  let client = null;
  let transactionStarted = false;

  req.on('aborted', ()=>{ aborted = true; });
  res.on('close', ()=>{ if (!res.writableEnded) aborted = true; });

  try { console.log('[GM_BUILDER_EXPORT_REQUEST_V038]', JSON.stringify({ requestId, table:spec.table, key:String(req.query.table||''), format, limit, pageSize })); } catch(_) {}

  try {
    client = typeof db.connect === 'function' ? await db.connect() : db;
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    transactionStarted = true;

    let cols = await getColumns(client, spec.table);
    if (spec.table === 'gm_member') cols = cols.filter(c => !/^password_/i.test(c));
    if (!cols.length) throw new Error('no exportable columns');

    // Use the real primary key whenever one exists. If there is no PK, use the
    // configured logical key and ctid as the final tie breaker. The repeatable-
    // read snapshot keeps the full export stable while OFFSET pages are read.
    const pkResult = await client.query(`
      SELECT a.attname AS column_name
        FROM pg_index i
        JOIN pg_attribute a
          ON a.attrelid = i.indrelid
         AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = $1::regclass
         AND i.indisprimary
       ORDER BY array_position(i.indkey, a.attnum)
    `, [spec.table]);
    let orderCols = pkResult.rows.map(r=>String(r.column_name||'')).filter(c=>cols.includes(c));
    if (!orderCols.length && Array.isArray(spec.key)) orderCols = spec.key.filter(c=>cols.includes(c));
    if (!orderCols.length && Array.isArray(spec.keyAny) && Array.isArray(spec.keyAny[0])) orderCols = spec.keyAny[0].filter(c=>cols.includes(c));
    const orderSql = [...orderCols.map(c=>`${qIdent(c)} ASC NULLS FIRST`), 'ctid ASC'].join(', ');

    res.status(200);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${spec.table}_${Date.now()}.csv"`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('X-GM-Export-Protocol', 'v038-abort-on-failure');
    res.setHeader('X-GM-Export-Request-Id', requestId);
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const write = async (chunk) => {
      if (aborted || res.destroyed) throw new Error('client disconnected');
      if (res.write(chunk)) return;
      await new Promise((resolve,reject)=>{
        const onDrain=()=>{cleanup();resolve();};
        const onClose=()=>{cleanup();reject(new Error('client disconnected'));};
        const cleanup=()=>{res.off('drain',onDrain);res.off('close',onClose);};
        res.once('drain',onDrain);
        res.once('close',onClose);
      });
    };

    await write('\ufeff' + cols.map(csvEscape).join(',') + '\n');

    let offset = 0;
    while (!aborted) {
      const take = limit ? Math.min(pageSize, limit - sent) : pageSize;
      if (take <= 0) break;
      const r = await client.query(
        `SELECT ${cols.map(qIdent).join(', ')} FROM ${qIdent(spec.table)} ORDER BY ${orderSql} LIMIT $1 OFFSET $2`,
        [take, offset]
      );
      if (!r.rows.length) break;

      for (const row of r.rows) {
        await write(cols.map(c => csvEscape(row[c])).join(',') + '\n');
        sent++;
        if (limit && sent >= limit) break;
      }
      offset += r.rows.length;
      try { console.log('[GM_BUILDER_EXPORT_PAGE_V038]', JSON.stringify({ requestId, table:spec.table, sent, offset, pageSize, orderCols, elapsedMs:Date.now()-startedAt })); } catch(_) {}
      if (r.rows.length < take || (limit && sent >= limit)) break;
    }

    if (aborted) throw new Error('client disconnected');
    await client.query('COMMIT');
    transactionStarted = false;
    if (!res.writableEnded) res.end();
    try { console.log('[GM_BUILDER_EXPORT_DONE_V038]', JSON.stringify({ requestId, table:spec.table, sent, elapsedMs:Date.now()-startedAt })); } catch(_) {}
  } catch(e) {
    if (transactionStarted && client) await client.query('ROLLBACK').catch(()=>{});
    transactionStarted = false;
    try { console.error('[GM_BUILDER_EXPORT_FAIL_V038]', JSON.stringify({ requestId, table:spec.table, sent, detail:String(e && e.message || e), headersSent:res.headersSent, elapsedMs:Date.now()-startedAt })); } catch(_) {}
    if (!res.headersSent) return fail(res, 500, 'export failed', { detail:String(e && e.message || e), request_id:requestId });
    // Never finish a partially generated CSV as a successful response. Destroying
    // the socket makes fetch() reject instead of saving a truncated file.
    try { res.destroy(e instanceof Error ? e : new Error(String(e))); } catch(_) {}
  } finally {
    if (client && client !== db && typeof client.release === 'function') client.release();
  }
});


// V046: selected tables are exported as one streaming ZIP response.
// PostgreSQL server-side cursors remove OFFSET scans. Full DB export does not
// require a stable row order, so ORDER BY is intentionally omitted to allow a
// plain sequential scan. Each fetched page is converted to one CSV buffer.
const ZIP_CRC_TABLE = (()=>{
  const table = new Uint32Array(256);
  for(let n=0;n<256;n++){
    let c=n;
    for(let k=0;k<8;k++) c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);
    table[n]=c>>>0;
  }
  return table;
})();
function zipCrcUpdate(crc,buf){
  let c=crc>>>0;
  for(let i=0;i<buf.length;i++) c=ZIP_CRC_TABLE[(c^buf[i])&0xff]^(c>>>8);
  return c>>>0;
}
function zipU16(n){ const b=Buffer.allocUnsafe(2); b.writeUInt16LE(n&0xffff,0); return b; }
function zipU32(n){ const b=Buffer.allocUnsafe(4); b.writeUInt32LE(n>>>0,0); return b; }
function zipDosDateTime(d=new Date()){
  const year=Math.max(1980,d.getFullYear());
  const time=((d.getHours()&31)<<11)|((d.getMinutes()&63)<<5)|((Math.floor(d.getSeconds()/2))&31);
  const date=(((year-1980)&127)<<9)|(((d.getMonth()+1)&15)<<5)|(d.getDate()&31);
  return {time,date};
}
function safeCursorName(key){
  return `gm_export_${String(key||'table').replace(/[^a-zA-Z0-9_]/g,'_')}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
}
async function exportTableCsvIntoZip({req,db,spec,key,writeZip,requestId}){
  const requestedPageSize=Number(req.query.pageSize||0);
  const defaultPageSize=spec.table==='gm_product'?2000:5000;
  const maxPageSize=spec.table==='gm_product'?5000:10000;
  const pageSize=Math.min(Math.max(requestedPageSize||defaultPageSize,100),maxPageSize);
  const client=typeof db.connect==='function'?await db.connect():db;
  const cursorName=safeCursorName(key);
  let transactionStarted=false;
  let cursorDeclared=false;
  let sent=0;
  let page=0;
  const startedAt=Date.now();
  try{
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    transactionStarted=true;
    // Keep a safety limit, but allow large/toasted tables enough time per FETCH.
    // A slow client may hold the read-only cursor while backpressure drains.
    await client.query("SET LOCAL statement_timeout = '120000ms'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '600000ms'");

    let cols=await getColumns(client,spec.table);
    if(spec.table==='gm_member') cols=cols.filter(c=>!/^password_/i.test(c));
    if(!cols.length) throw new Error(`no exportable columns: ${spec.table}`);

    await writeZip(Buffer.from('\ufeff'+cols.map(csvEscape).join(',')+'\n','utf8'));

    // The repeatable-read cursor itself advances exactly once through the snapshot.
    // ORDER BY is unnecessary for a full export and can force an expensive sort or
    // index-ordered heap access on gm_product, so use the planner's sequential scan.
    await client.query(`DECLARE ${qIdent(cursorName)} NO SCROLL CURSOR FOR SELECT ${cols.map(qIdent).join(', ')} FROM ${qIdent(spec.table)}`);
    cursorDeclared=true;

    while(true){
      const r=await client.query(`FETCH FORWARD ${pageSize} FROM ${qIdent(cursorName)}`);
      if(!r.rows.length) break;
      page++;
      const csvPage=r.rows.map(row=>cols.map(c=>csvEscape(row[c])).join(',')).join('\n')+'\n';
      await writeZip(Buffer.from(csvPage,'utf8'));
      sent+=r.rows.length;
      console.log('[GM_BUILDER_ZIP_PAGE_V046]',JSON.stringify({requestId,key,table:spec.table,page,rows:r.rows.length,totalRows:sent,pageSize,elapsedMs:Date.now()-startedAt}));
      if(r.rows.length<pageSize) break;
    }

    await client.query(`CLOSE ${qIdent(cursorName)}`);
    cursorDeclared=false;
    await client.query('COMMIT');
    transactionStarted=false;
    return {key,table:spec.table,rows:sent,pages:page,pageSize,elapsedMs:Date.now()-startedAt};
  }catch(e){
    if(cursorDeclared) await client.query(`CLOSE ${qIdent(cursorName)}`).catch(()=>{});
    if(transactionStarted) await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{
    if(client!==db && typeof client.release==='function') client.release();
  }
}
router.get('/api/gm/builder/export-all', async (req,res)=>{
  const raw=String(req.query.tables||'').split(',').map(x=>x.trim()).filter(Boolean);
  const unique=[...new Set(raw)];
  if(!unique.length) return fail(res,400,'no tables selected');
  const invalid=unique.filter(k=>!tableSpec(k));
  if(invalid.length) return fail(res,400,'invalid table',{invalid});

  // gm_product is always exported first and completes before any other table starts.
  const ordered=[...unique.filter(k=>k==='products'),...unique.filter(k=>k!=='products')];
  const db=dbFrom(req);
  const stamp=new Date().toISOString().replace(/[-:T]/g,'').slice(0,14);
  const filename=`glomart_db_${stamp}.zip`;
  const requestId=`${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
  const central=[];
  let offset=0;
  let aborted=false;
  const startedAt=Date.now();
  req.on('aborted',()=>{aborted=true;});
  res.on('close',()=>{if(!res.writableEnded) aborted=true;});

  const writeRaw=async(buf)=>{
    if(aborted||res.destroyed) throw new Error('client disconnected');
    if(!Buffer.isBuffer(buf)) buf=Buffer.from(buf);
    offset+=buf.length;
    if(res.write(buf)) return;
    await new Promise((resolve,reject)=>{
      const cleanup=()=>{res.off('drain',onDrain);res.off('close',onClose);};
      const onDrain=()=>{cleanup();resolve();};
      const onClose=()=>{cleanup();reject(new Error('client disconnected'));};
      res.once('drain',onDrain); res.once('close',onClose);
    });
  };

  try{
    console.log('[GM_BUILDER_ZIP_START_V046]',JSON.stringify({requestId,filename,tables:ordered}));
    res.status(200);
    res.setHeader('Content-Type','application/zip');
    res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
    res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
    res.setHeader('X-Accel-Buffering','no');
    res.setHeader('X-GM-Export-Protocol','v046-unordered-cursor-zip');
    res.setHeader('X-GM-Export-Request-Id',requestId);
    if(typeof res.flushHeaders==='function') res.flushHeaders();

    for(let i=0;i<ordered.length;i++){
      const key=ordered[i];
      const spec=tableSpec(key);
      const entryName=Buffer.from(`${spec.table}.csv`,'utf8');
      const {time,date}=zipDosDateTime();
      const localOffset=offset;
      const flags=0x0808;
      const local=Buffer.concat([
        zipU32(0x04034b50),zipU16(20),zipU16(flags),zipU16(0),zipU16(time),zipU16(date),
        zipU32(0),zipU32(0),zipU32(0),zipU16(entryName.length),zipU16(0),entryName
      ]);
      await writeRaw(local);
      let crc=0xffffffff;
      let size=0;
      const writeEntry=async(buf)=>{
        if(!Buffer.isBuffer(buf)) buf=Buffer.from(buf);
        crc=zipCrcUpdate(crc,buf);
        size+=buf.length;
        await writeRaw(buf);
      };
      console.log('[GM_BUILDER_ZIP_TABLE_START_V046]',JSON.stringify({requestId,index:i+1,total:ordered.length,key,table:spec.table,productStandalone:key==='products'}));
      const result=await exportTableCsvIntoZip({req,db,spec,key,writeZip:writeEntry,requestId});
      crc=(crc^0xffffffff)>>>0;
      await writeRaw(Buffer.concat([zipU32(0x08074b50),zipU32(crc),zipU32(size),zipU32(size)]));
      central.push({entryName,time,date,flags,crc,size,localOffset});
      console.log('[GM_BUILDER_ZIP_TABLE_DONE_V046]',JSON.stringify({requestId,...result,size}));
    }

    const centralOffset=offset;
    for(const e of central){
      await writeRaw(Buffer.concat([
        zipU32(0x02014b50),zipU16(20),zipU16(20),zipU16(e.flags),zipU16(0),zipU16(e.time),zipU16(e.date),
        zipU32(e.crc),zipU32(e.size),zipU32(e.size),zipU16(e.entryName.length),zipU16(0),zipU16(0),
        zipU16(0),zipU16(0),zipU32(0),zipU32(e.localOffset),e.entryName
      ]));
    }
    const centralSize=offset-centralOffset;
    await writeRaw(Buffer.concat([
      zipU32(0x06054b50),zipU16(0),zipU16(0),zipU16(central.length),zipU16(central.length),
      zipU32(centralSize),zipU32(centralOffset),zipU16(0)
    ]));
    res.end();
    console.log('[GM_BUILDER_ZIP_DONE_V046]',JSON.stringify({requestId,filename,tables:ordered.length,bytes:offset,elapsedMs:Date.now()-startedAt}));
  }catch(e){
    console.error('[GM_BUILDER_ZIP_FAIL_V046]',JSON.stringify({requestId,detail:String(e&&e.message||e),headersSent:res.headersSent,tablesCompleted:central.length,elapsedMs:Date.now()-startedAt}));
    if(!res.headersSent) return fail(res,500,'zip export failed',{detail:String(e&&e.message||e),request_id:requestId});
    try{res.destroy(e instanceof Error?e:new Error(String(e)));}catch(_){ }
  }
});


function validateCategoryImportRow(row, columns, colSet, spec, seenKeys) {
  const key = pickKey(row, spec);
  if (!key) return { ok:false, result:resultRow(row.__row_no, spec.table, '', 'SKIP', '', '', 'MISSING_KEY') };
  const upsertKey = key.values.join('+');
  if (seenKeys && seenKeys.has(upsertKey)) {
    return { ok:false, duplicate:true, result:resultRow(row.__row_no, spec.table, upsertKey, 'SKIP', '', '', 'DUPLICATE_INPUT_KEY') };
  }

  const obj = {};
  for (const [col, raw] of Object.entries(row)) {
    if (col === '__row_no') continue;
    if (!colSet.has(col)) continue;
    if ((spec.blocked || []).includes(col)) continue;
    const v = validateCell(col, raw, spec);
    if (!v.ok) return { ok:false, result:resultRow(row.__row_no, spec.table, upsertKey, 'SKIP', col, raw, v.reason) };
    if (v.action === 'KEEP_OLD') continue;
    obj[col] = v.value;
  }
  for (const k of key.keys) {
    if (colSet.has(k) && clean(row[k]) !== '') obj[k] = clean(row[k]);
  }
  if (!obj.cp_code && clean(row.cp_code)) obj.cp_code = clean(row.cp_code);
  if (!obj.gm_code && clean(row.gm_code)) obj.gm_code = clean(row.gm_code);

  // gm_category requires gm_code and current development key cp_code.
  if (!clean(obj.cp_code)) return { ok:false, result:resultRow(row.__row_no, spec.table, upsertKey, 'SKIP', 'cp_code', row.cp_code || '', 'CRITICAL_EMPTY') };
  if (!clean(obj.gm_code)) return { ok:false, result:resultRow(row.__row_no, spec.table, upsertKey, 'SKIP', 'gm_code', row.gm_code || '', 'CRITICAL_EMPTY') };
  if (clean(row.name_ko) === '') return { ok:false, result:resultRow(row.__row_no, spec.table, upsertKey, 'SKIP', 'name_ko', row.name_ko || '', 'CRITICAL_EMPTY') };

  if (seenKeys) seenKeys.add(upsertKey);
  return { ok:true, key:upsertKey, obj };
}

async function categoryFastUpsertBatch(db, spec, rows, columns, colSet, apply) {
  const seenKeys = new Set();
  const valid = [];
  const result = [];
  let invalid = 0;
  let skipped = 0;

  for (const row of rows) {
    const v = validateCategoryImportRow(row, columns, colSet, spec, seenKeys);
    if (!v.ok) {
      if (v.duplicate) skipped++; else invalid++;
      result.push(v.result);
      continue;
    }
    valid.push({ rowNo:row.__row_no, key:v.key, obj:v.obj });
  }

  if (!valid.length || !apply) {
    for (const v of valid) result.push(resultRow(v.rowNo, spec.table, v.key, apply ? 'SKIP' : 'VALID_UPSERT', '', '', apply ? 'NO_VALID_ROWS' : 'DRY_RUN'));
    return { result, validCount:valid.length, invalid, skipped, applied:0 };
  }

  const upsertCols = columns.filter(c => {
    if (c === 'category_id' || c === 'created_at') return false;
    if ((spec.blocked || []).includes(c)) return false;
    return valid.some(v => Object.prototype.hasOwnProperty.call(v.obj, c));
  });
  if (!upsertCols.includes('cp_code')) upsertCols.unshift('cp_code');
  if (!upsertCols.includes('gm_code')) upsertCols.unshift('gm_code');

  const params = [];
  const valuesSql = [];
  valid.forEach((v, rowIdx) => {
    const ph = [];
    upsertCols.forEach((c) => {
      params.push(Object.prototype.hasOwnProperty.call(v.obj, c) ? v.obj[c] : null);
      ph.push('$' + params.length);
    });
    valuesSql.push('(' + ph.join(',') + ')');
  });

  const updateCols = upsertCols.filter(c => c !== 'cp_code' && c !== 'created_at' && c !== 'category_id');
  const updateSql = updateCols.map(c => {
    if (c === 'updated_at') return `${qIdent(c)}=NOW()`;
    return `${qIdent(c)}=CASE WHEN EXCLUDED.${qIdent(c)} IS NULL OR EXCLUDED.${qIdent(c)}::text='' THEN ${qIdent(spec.table)}.${qIdent(c)} ELSE EXCLUDED.${qIdent(c)} END`;
  });
  if (!updateCols.includes('updated_at') && columns.includes('updated_at')) updateSql.push(`${qIdent('updated_at')}=NOW()`);

  const sql = `INSERT INTO ${qIdent(spec.table)} (${upsertCols.map(qIdent).join(', ')}) VALUES ${valuesSql.join(', ')} ` +
    `ON CONFLICT (${qIdent('cp_code')}) WHERE cp_code IS NOT NULL AND cp_code <> '' DO UPDATE SET ${updateSql.join(', ')} ` +
    `RETURNING cp_code, (xmax = 0) AS inserted`;

  try {
    await db.query(sql, params);
    for (const v of valid) result.push(resultRow(v.rowNo, spec.table, v.key, 'UPSERTED', '', '', 'APPLIED'));
    return { result, validCount:valid.length, invalid, skipped, applied:valid.length };
  } catch (e) {
    // A failed multi-row batch usually means duplicate gm_code or one bad value. Fall back per row to identify exact rows.
    const detail = String(e && e.message || e);
    try { console.error('[GM_CATEGORY_FAST_UPSERT_BATCH_FAIL_V018]', detail); } catch(_) {}
    if (valid.length === 1) {
      invalid++;
      result.push(resultRow(valid[0].rowNo, spec.table, valid[0].key, 'FAIL', '', '', detail));
      return { result, validCount:valid.length, invalid, skipped, applied:0 };
    }
    let applied = 0;
    for (const v of valid) {
      const one = await categoryFastUpsertBatch(db, spec, [{ __row_no:v.rowNo, ...v.obj }], columns, colSet, true);
      applied += one.applied || 0;
      invalid += one.invalid || 0;
      skipped += one.skipped || 0;
      for (const rr of one.result) result.push(rr);
    }
    return { result, validCount:valid.length, invalid, skipped, applied };
  }
}

async function handleCategoryFastImport(req, res, spec, rows, apply, db) {
  const startTime = Date.now();
  const columns = await getColumns(db, spec.table);
  const colSet = new Set(columns);
  const batchSize = Math.min(Math.max(Number(req.query.batchSize || 500), 50), 1000);
  const outCols = ['row_no','table','key','result','column_name','value','reason'];
  let processed = 0, applied = 0, invalid = 0, skipped = 0;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="gm_category_import_result_${Date.now()}.csv"`);
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
  res.write('﻿' + outCols.map(csvEscape).join(',') + '\n');

  for (let i=0; i<rows.length; i+=batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const client = apply ? await db.connect() : null;
    try {
      if (client) await client.query('BEGIN');
      const r = await categoryFastUpsertBatch(client || db, spec, batch, columns, colSet, apply);
      if (client) await client.query('COMMIT');
      processed += batch.length;
      applied += r.applied || 0;
      invalid += r.invalid || 0;
      skipped += r.skipped || 0;
      for (const rr of r.result) res.write(outCols.map(c => csvEscape(rr[c])).join(',') + '\n');
      try { console.log('[GM_CATEGORY_FAST_IMPORT_V018]', JSON.stringify({ batchStart:i+1, batchEnd:i+batch.length, total:rows.length, processed, applied, invalid, skipped, ms:Date.now()-startTime })); } catch(_) {}
    } catch(e) {
      if (client) await client.query('ROLLBACK').catch(()=>{});
      processed += batch.length;
      invalid += batch.length;
      const msg = String(e && e.message || e);
      for (const row of batch) res.write(outCols.map(c => csvEscape(resultRow(row.__row_no, spec.table, pickKey(row, spec)?.label || '', 'FAIL', '', '', msg)[c])).join(',') + '\n');
      try { console.error('[GM_CATEGORY_FAST_IMPORT_BATCH_FATAL_V018]', msg); } catch(_) {}
    } finally {
      if (client) client.release();
    }
  }
  try { console.log('[GM_CATEGORY_FAST_IMPORT_DONE_V018]', JSON.stringify({ total:rows.length, processed, applied, invalid, skipped, apply, ms:Date.now()-startTime })); } catch(_) {}
  res.end();
}



// GM_DEV_FILE_RESTORE_BUILDER_V002
// 개발 기간 전용: 안전장치/blocked/빈값 유지 규칙을 무시하고 선택한 CSV 행만 강제 복원한다.
// 전체 테이블 TRUNCATE/초기화는 하지 않는다.
// apply=YES + confirm=DEV FILE RESTORE 가 없으면 실제 DB에는 반영하지 않는다.
function devOverwriteConfirmed(req){
  return String(req.query.apply || '').toUpperCase() === 'YES' && String(req.query.confirm || '') === 'DEV FILE RESTORE';
}
function rowColumnsFromRows(rows, dbColumns){
  const dbSet = new Set(dbColumns);
  const seen = new Set();
  const out = [];
  for(const row of rows){
    for(const c of Object.keys(row||{})){
      if(c === '__row_no') continue;
      if(!dbSet.has(c)) continue;
      if(seen.has(c)) continue;
      seen.add(c); out.push(c);
    }
  }
  return out;
}
function devCellValue(v){
  let x = clean(v);
  if(x === '') return null;

  // Builder CSV/XLSX export may preserve JSON-style wrapping quotes
  // around timestamps, e.g. "2026-07-16T15:27:59.000Z".
  // Remove only one matching outer quote pair in DEV restore paths.
  if(
    x.length >= 2 &&
    ((x[0] === '"' && x[x.length-1] === '"') ||
     (x[0] === "'" && x[x.length-1] === "'"))
  ){
    x = x.slice(1,-1);
  }
  return x === '' ? null : x;
}

function devFirstValue(row, names){
  for(const name of names || []){
    const v = clean(row && row[name]);
    if(v !== '') return v;
  }
  return '';
}

function normalizeDevRestoreRows(spec, rows){
  // DEV FILE RESTORE only.
  // Do not alter normal Builder update behavior or live order creation.
  if(!spec || spec.table !== 'gm_order') return { rows, filled:{} };

  const filled = {};

  function setIfBlank(row, col, value){
    if(clean(row[col]) !== '') return;
    const v = clean(value);
    if(v === '') return;
    row[col] = v;
    filled[col] = (filled[col] || 0) + 1;
  }

  function numValue(v){
    const x = clean(v).replace(/,/g,'');
    const n = Number(x);
    return Number.isFinite(n) ? n : 0;
  }

  for(const row of rows){
    const identity = devFirstValue(row, ['member_id','guest_key','order_no']);

    // Current gm_order NOT NULL identity/contact columns.
    setIfBlank(row, 'orderer_name',
      devFirstValue(row, ['receiver_name','customs_name','depositor_name','member_id','guest_key','order_no'])
    );
    setIfBlank(row, 'receiver_name',
      devFirstValue(row, ['orderer_name','customs_name','depositor_name','member_id','guest_key','order_no'])
    );

    setIfBlank(row, 'orderer_mobile',
      devFirstValue(row, ['orderer_phone','receiver_mobile','receiver_phone','receiver_safe_phone','depositor_phone'])
    );
    setIfBlank(row, 'receiver_mobile',
      devFirstValue(row, ['receiver_phone','receiver_safe_phone','orderer_mobile','orderer_phone','depositor_phone'])
    );

    // If historical backup itself did not contain these values, keep the row
    // restorable but explicitly mark that operational data needs later review.
    setIfBlank(row, 'orderer_name', identity || 'RESTORE_REQUIRED');
    setIfBlank(row, 'receiver_name', identity || 'RESTORE_REQUIRED');
    setIfBlank(row, 'orderer_mobile', 'RESTORE_REQUIRED');
    setIfBlank(row, 'receiver_mobile', 'RESTORE_REQUIRED');
    setIfBlank(row, 'receiver_zipcode', 'RESTORE_REQUIRED');
    setIfBlank(row, 'receiver_address1', 'RESTORE_REQUIRED');

    // Current gm_order NOT NULL payment/status columns.
    setIfBlank(row, 'payment_method', 'pending');
    setIfBlank(row, 'payment_method_display', '미정');
    setIfBlank(row, 'order_status', 'ordered');
    setIfBlank(row, 'payment_status', 'pending');
    setIfBlank(row, 'shipping_status', 'pending');

    // Current gm_order NOT NULL amount columns.
    if(clean(row.total_product_price) === ''){
      row.total_product_price = '0';
      filled.total_product_price = (filled.total_product_price || 0) + 1;
    }
    if(clean(row.total_delivery_fee) === ''){
      row.total_delivery_fee = '0';
      filled.total_delivery_fee = (filled.total_delivery_fee || 0) + 1;
    }

    const product = numValue(row.total_product_price);
    const delivery = numValue(row.total_delivery_fee);
    const extra = numValue(row.extra_area_delivery_fee);

    if(clean(row.total_payment_price) === ''){
      row.total_payment_price = String(product + delivery + extra);
      filled.total_payment_price = (filled.total_payment_price || 0) + 1;
    }
    if(clean(row.expected_payment_amount) === ''){
      row.expected_payment_amount = clean(row.total_payment_price) || String(product + delivery + extra);
      filled.expected_payment_amount = (filled.expected_payment_amount || 0) + 1;
    }

    // Current gm_order NOT NULL timestamps.
    setIfBlank(row, 'ordered_at',
      devFirstValue(row, ['created_at','updated_at'])
    );
    setIfBlank(row, 'created_at',
      devFirstValue(row, ['ordered_at','updated_at'])
    );

    // Last-resort only for malformed historical rows.
    const nowIso = new Date().toISOString();
    setIfBlank(row, 'ordered_at', nowIso);
    setIfBlank(row, 'created_at', row.ordered_at || nowIso);
  }

  return { rows, filled };
}
function pickDevConflictKeys(spec, inputCols){
  const input = new Set(inputCols || []);
  for(const ks of keySets(spec)){
    if((ks||[]).length && ks.every(k=>input.has(k))) return ks;
  }
  return (spec.key || []).filter(k=>input.has(k));
}
async function syncSerialSequences(client, table, cols){
  for(const col of cols){
    try{
      const seq = await client.query(`SELECT pg_get_serial_sequence($1,$2) AS seq`, [table, col]);
      const seqName = seq.rows && seq.rows[0] && seq.rows[0].seq;
      if(!seqName) continue;
      await client.query(`SELECT setval($1, COALESCE((SELECT MAX(${qIdent(col)}) FROM ${qIdent(table)}),0) + 1, false)`, [seqName]);
    }catch(e){ try{ console.warn('[GM_DEV_OVERWRITE_SEQUENCE_SYNC_SKIP]', table, col, String(e&&e.message||e)); }catch(_){} }
  }
}
async function insertDevRows(client, table, inputCols, rows, batchSize){
  let inserted = 0;
  if(!rows.length || !inputCols.length) return inserted;
  for(let i=0;i<rows.length;i+=batchSize){
    const batch = rows.slice(i, i+batchSize);
    const params=[];
    const values=[];
    for(const row of batch){
      const one=[];
      for(const c of inputCols){ params.push(devCellValue(row[c])); one.push('$'+params.length); }
      values.push('('+one.join(',')+')');
    }
    await client.query(`INSERT INTO ${qIdent(table)} (${inputCols.map(qIdent).join(',')}) VALUES ${values.join(',')}`, params);
    inserted += batch.length;
  }
  return inserted;
}

function devRestoreKeySets(spec, inputCols){
  const input = new Set(inputCols || []);
  const out = [];
  function add(keys){
    keys = (keys || []).filter(Boolean);
    if(!keys.length) return;
    if(!keys.every(k => input.has(k))) return;
    const sig = keys.join('|');
    if(out.some(x => x.join('|') === sig)) return;
    out.push(keys);
  }
  // table-specific strong keys that may be unique even if not the normal safe-update key.
  const t = spec.table;
  if(t === 'gm_category'){
    add(['category_id']); add(['cp_code']); add(['gm_code']);
  }else if(t === 'gm_product'){
    add(['product_uid']); add(['mall_code','pi_ii_vi']); add(['mall_code','product_id','item_id','vendor_item_id']);
  }else if(t === 'gm_product_option'){
    add(['option_id']); add(['mall_code','pi_ii_vi']); add(['mall_code','product_id','item_id','vendor_item_id']);
  }else if(t === 'gm_member'){
    add(['member_id']);
  }else if(t === 'gm_member_address'){
    add(['address_id']); add(['member_id','address_name']);
  }else if(t === 'gm_supplier'){
    add(['gm_supplier_id']); add(['seller_name']);
  }else if(t === 'gm_order'){
    add(['order_no']);
  }else if(t === 'gm_order_item'){
    add(['order_no','pi_ii_vi']); add(['order_item_id']);
  }else if(t === 'gm_basket'){
    add(['basket_id']); add(['member_id','pi_ii_vi']); add(['guest_key','pi_ii_vi']);
  }else if(t === 'gm_keyword_translate'){
    add(['lang','input_keyword']);
  }else if(t === 'gm_keyword_relation'){
    add(['keyword_ko','related_keyword_ko']);
  }
  for(const ks of keySets(spec)) add(ks);
  if(spec.key) add(spec.key);
  return out;
}
async function deleteDevConflictingRows(client, spec, inputCols, rows, batchSize){
  const table = spec.table;
  const keySetsForDelete = devRestoreKeySets(spec, inputCols);
  if(!keySetsForDelete.length) throw new Error('DEV_FILE_RESTORE_KEY_NOT_FOUND');
  let deleted = 0;
  for(const row of rows){
    const ors=[]; const params=[];
    for(const keys of keySetsForDelete){
      const vals = keys.map(k => devCellValue(row[k]));
      if(vals.some(v => v === null || v === undefined)) continue;
      const ands=[];
      for(let i=0;i<keys.length;i++){
        params.push(vals[i]);
        ands.push(`${qIdent(keys[i])}=$${params.length}`);
      }
      if(ands.length) ors.push('('+ands.join(' AND ')+')');
    }
    if(!ors.length) continue;
    const r = await client.query(`DELETE FROM ${qIdent(table)} WHERE ${ors.join(' OR ')}`, params);
    deleted += r.rowCount || 0;
  }
  return { deleted, keySets:keySetsForDelete };
}
async function restoreDevRowsByFile(client, spec, inputCols, rows, batchSize){
  const del = await deleteDevConflictingRows(client, spec, inputCols, rows, batchSize);
  const inserted = await insertDevRows(client, spec.table, inputCols, rows, batchSize);
  return { deleted:del.deleted, inserted, keySets:del.keySets };
}
async function upsertDevRows(client, spec, inputCols, rows, batchSize){
  let upserted = 0;
  const table = spec.table;
  const keys = pickDevConflictKeys(spec, inputCols);
  if(!keys.length) throw new Error('DEV_OVERWRITE_UPSERT_KEY_NOT_FOUND');
  const updateCols = inputCols.filter(c => !keys.includes(c));
  for(let i=0;i<rows.length;i+=batchSize){
    const batch = rows.slice(i, i+batchSize);
    const params=[];
    const values=[];
    for(const row of batch){
      const one=[];
      for(const c of inputCols){ params.push(devCellValue(row[c])); one.push('$'+params.length); }
      values.push('('+one.join(',')+')');
    }
    const updateSql = updateCols.length
      ? updateCols.map(c => `${qIdent(c)}=EXCLUDED.${qIdent(c)}`).join(',')
      : keys.map(c => `${qIdent(c)}=EXCLUDED.${qIdent(c)}`).join(',');
    await client.query(`INSERT INTO ${qIdent(table)} (${inputCols.map(qIdent).join(',')}) VALUES ${values.join(',')} ON CONFLICT (${keys.map(qIdent).join(',')}) DO UPDATE SET ${updateSql}`, params);
    upserted += batch.length;
  }
  return { upserted, keys };
}
async function handleDevOverwriteImport(req, res, spec, rows, apply, db){
  // V023: selected-file restore only. No full-table TRUNCATE. No safe-update blocked/critical/blank rules.
  const mode = 'file_restore';
  const batchSize = Math.min(Math.max(Number(req.query.batchSize || 500), 50), 1000);
  const confirmed = devOverwriteConfirmed(req);
  const columns = await getColumns(db, spec.table);
  const normalized = normalizeDevRestoreRows(spec, rows);
  rows = normalized.rows;
  const restoreFilled = normalized.filled || {};
  const inputCols = rowColumnsFromRows(rows, columns);
  const outCols = ['row_no','table','key','result','column_name','value','reason'];
  const result=[];
  const start=Date.now();
  let applied=0, deleted=0;
  let usedKeys=[];

  if(!inputCols.length){
    result.push(resultRow('', spec.table, '', 'FAIL', '', '', 'NO_MATCHING_COLUMNS'));
    const csv = toCsv(result, outCols);
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="gm_dev_file_restore_result_${Date.now()}.csv"`);
    return res.end(csv);
  }

  const client = confirmed ? await db.connect() : null;
  try{
    if(client) await client.query('BEGIN');
    if(!confirmed){
      usedKeys = devRestoreKeySets(spec, inputCols);
      result.push(resultRow('', spec.table, usedKeys.map(k=>k.join('+')).join(' / '), 'DRY_RUN', '', '', `DEV_FILE_RESTORE_READY rows=${rows.length} columns=${inputCols.length}; selected rows only; no truncate; filled=${JSON.stringify(restoreFilled)}`));
      for(const row of rows.slice(0, 2000)) result.push(resultRow(row.__row_no, spec.table, pickKey(row, spec)?.label || '', 'VALID_DEV_FILE_RESTORE', '', '', 'DRY_RUN'));
    }else{
      const r = await restoreDevRowsByFile(client, spec, inputCols, rows, batchSize);
      applied = r.inserted;
      deleted = r.deleted;
      usedKeys = r.keySets || [];
      await syncSerialSequences(client, spec.table, columns);
      result.push(resultRow('', spec.table, usedKeys.map(k=>k.join('+')).join(' / '), 'RESTORE_KEY', '', '', 'DELETE_MATCHING_ROWS_THEN_INSERT; NO_TRUNCATE'));
      result.push(resultRow('', spec.table, '', 'DELETE_MATCHED_ROWS', '', '', String(deleted)));
      for(const row of rows.slice(0, 2000)) result.push(resultRow(row.__row_no, spec.table, pickKey(row, spec)?.label || '', 'RESTORED_DEV_FILE_ROW', '', '', 'APPLIED'));
    }
    if(client) await client.query('COMMIT');
    try{ console.log('[GM_DEV_FILE_RESTORE_DONE_V025]', JSON.stringify({ table:spec.table, rows:rows.length, columns:inputCols.length, applied, deleted, confirmed, keys:usedKeys, filled:restoreFilled, ms:Date.now()-start })); }catch(_){}
  }catch(e){
    if(client) await client.query('ROLLBACK').catch(()=>{});
    result.push(resultRow('', spec.table, '', 'FAIL', '', '', String(e && e.message || e)));
    try{ console.error('[GM_DEV_FILE_RESTORE_FAIL_V025]', spec.table, String(e && e.message || e)); }catch(_){}
  }finally{
    if(client) client.release();
  }
  result.unshift(resultRow('', spec.table, '', confirmed?'SUMMARY_APPLIED':'SUMMARY_DRY_RUN', '', '', `mode=${mode}; rows=${rows.length}; columns=${inputCols.length}; deleted=${deleted}; inserted=${applied}; shown_max=2000`));
  const csv = toCsv(result, outCols);
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="gm_dev_file_restore_${spec.table}_${Date.now()}.csv"`);
  res.end(csv);
}


router.post('/api/gm/builder/dev-overwrite', express.text({ type:['text/*','application/csv'], limit:'80mb' }), async (req,res)=>{
  const spec = tableSpec(req.query.table);
  if (!spec) return fail(res, 400, 'invalid table');
  const apply = String(req.query.apply || '').toUpperCase() === 'YES';
  const db = dbFrom(req);
  let rows = parseCsv(req.body);
  const maxRows = Math.min(Math.max(Number(req.query.maxRows || 200000), 1), 500000);
  if(rows.length > maxRows) rows = rows.slice(0, maxRows);
  if(apply && !devOverwriteConfirmed(req)) return fail(res, 403, 'DEV_FILE_RESTORE_CONFIRM_REQUIRED', { required:'confirm=DEV FILE RESTORE' });
  try { return await handleDevOverwriteImport(req, res, spec, rows, apply, db); }
  catch(e){ return fail(res, 500, 'dev overwrite failed', { detail:String(e && e.message || e) }); }
});

router.post('/api/gm/builder/safe-update', express.text({ type:['text/*','application/csv'], limit:'30mb' }), async (req,res)=>{
  const uploadKey=clean(req.query.table);
  const spec = tableSpec(uploadKey);
  if (!spec) return fail(res, 400, 'invalid table');

  const apply = String(req.query.apply || '').toUpperCase() === 'YES';
  const db = dbFrom(req);

  let rows = parseCsv(req.body);
  if (rows.length > LIMITS.MAX_ROWS) {
    rows = rows.slice(0, LIMITS.MAX_ROWS);
  }

  // Cafe24 회원명부를 일반 gm_member safe-update에 넣어도 자동으로 전용 import로 처리한다.
  // 일반 safe-update는 member_id 컬럼을 찾기 때문에 Cafe24 원본 CSV(아이디/이름/휴대폰번호...)를 그대로 넣으면 MISSING_KEY가 난다.
  if (spec.table === 'gm_member' && rows.some(r => Object.prototype.hasOwnProperty.call(r, '아이디'))) {
    const result = [];
    let processed=0, insertedOrUpdated=0, skipped=0, invalid=0;
    const outCols = ['row_no','member_id','result','member_action','address_action','name','email','phone','mobile','zipcode','address1','address2','member_grade','member_grade_code','deposit_balance','point_balance','refund_account_info','total_order_count','total_purchase_amount','last_login_at','joined_at','reason'];
    try {
      const memberCols = new Set(await getColumns(db, 'gm_member'));
      const addressCols = new Set(await getColumns(db, 'gm_member_address'));
      const client = apply ? await db.connect() : null;
      try {
        if (client) await client.query('BEGIN');
        for (const row of rows) {
          processed++;
          const mapped = mapCafe24Member(row);
          const m = mapped.member;
          const a = mapped.address;
          if (!m.member_id) {
            invalid++; skipped++;
            result.push(cafe24ImportResultRow(row, m, 'SKIP', '', '', 'MISSING_MEMBER_ID'));
            continue;
          }
          const mObj = {};
          for (const [k,v] of Object.entries(m)) if (memberCols.has(k)) mObj[k]=v;
          const aObj = {};
          for (const [k,v] of Object.entries(a)) if (addressCols.has(k)) aObj[k]=v;
          let memberAction = 'VALID_MEMBER';
          let addressAction = (a.zipcode || a.address1 || a.address2) ? 'VALID_ADDRESS' : 'NO_ADDRESS';
          if (apply) {
            const mr = await upsertObject(client, 'gm_member', mObj, ['member_id']);
            memberAction = mr.action;
            if (addressAction !== 'NO_ADDRESS') {
              if (addressCols.has('is_default')) await client.query(`UPDATE gm_member_address SET is_default='N', updated_at=NOW() WHERE member_id=$1`, [m.member_id]);
              const ar = await upsertObject(client, 'gm_member_address', aObj, ['address_id']);
              addressAction = ar.action;
            }
          }
          insertedOrUpdated++;
          result.push(cafe24ImportResultRow(row, m, apply?'APPLIED':'VALID', memberAction, addressAction, apply?'APPLIED':'DRY_RUN'));
        }
        if (client) await client.query('COMMIT');
      } catch(e) {
        if (client) await client.query('ROLLBACK').catch(()=>{});
        throw e;
      } finally {
        if (client) client.release();
      }
      const csv = toCsv(result, outCols);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="cafe24_member_import_${apply?'apply':'dryrun'}_${Date.now()}.csv"`);
      return res.end(csv);
    } catch(e) {
      return fail(res, 500, 'cafe24 member auto import failed', { detail:String(e && e.message || e), processed, insertedOrUpdated, skipped, invalid });
    }
  }

  if (spec.table === 'gm_category') {
    try {
      return await handleCategoryFastImport(req, res, spec, rows, apply, db);
    } catch(e) {
      return fail(res, 500, 'category fast import failed', { detail:String(e && e.message || e) });
    }
  }

  const result = [];
  let processed = 0, updated = 0, skipped = 0, invalid = 0;
  let stopped = '';

  try {
    const columns = await getColumns(db, spec.table);
    const colSet = new Set(columns);
    const client = apply ? await db.connect() : null;

    try {
      if (client) await client.query('BEGIN');

      for (const row of rows) {
        processed++;
        const key = pickKey(row, spec);
        if (!key) {
          invalid++; skipped++;
          result.push(resultRow(row.__row_no, spec.table, '', 'SKIP', '', '', 'MISSING_KEY'));
        } else {
          const where = key.keys.map((k,i)=>`${qIdent(k)}=$${i+1}`).join(' AND ');
          const exist = await (client || db).query(`SELECT 1 FROM ${qIdent(spec.table)} WHERE ${where} LIMIT 1`, key.values);

          if (!exist.rows.length) {
            if (!spec.allowInsert) {
              skipped++;
              result.push(resultRow(row.__row_no, spec.table, key.label, 'SKIP', '', '', 'KEY_NOT_FOUND'));
            } else {
              const insertCols = [];
              const params = [];
              let rowInvalid = false;
              for (const [col, raw] of Object.entries(row)) {
                if (col === '__row_no') continue;
                if (!colSet.has(col)) {
                  skipped++;
                  result.push(resultRow(row.__row_no, spec.table, key.label, 'SKIP_CELL', col, raw, 'UNKNOWN_COLUMN'));
                  continue;
                }
                if ((spec.blocked || []).includes(col)) continue;
                const v = validateCell(col, raw, spec);
                if (!v.ok) {
                  invalid++;
                  rowInvalid = true;
                  result.push(resultRow(row.__row_no, spec.table, key.label, 'SKIP', col, raw, v.reason));
                  break;
                }
                if (v.action === 'KEEP_OLD') continue;
                insertCols.push(col);
                params.push(v.value);
              }
              for (const k of key.keys) {
                if (!insertCols.includes(k) && colSet.has(k)) {
                  insertCols.push(k);
                  params.push(row[k] || '');
                }
              }
              if (!rowInvalid && insertCols.length) {
                if (apply) {
                  const ph = insertCols.map((_,i)=>'$'+(i+1)).join(', ');
                  await client.query(`INSERT INTO ${qIdent(spec.table)} (${insertCols.map(qIdent).join(', ')}) VALUES (${ph})`, params);
                }
                updated++;
                result.push(resultRow(row.__row_no, spec.table, key.label, apply ? 'INSERTED' : 'VALID_INSERT', '', '', apply ? 'APPLIED' : 'DRY_RUN'));
              } else if (!rowInvalid) {
                skipped++;
                result.push(resultRow(row.__row_no, spec.table, key.label, 'SKIP', '', '', 'NO_INSERT_VALUE'));
              }
            }
          } else {
            const updates = [];
            const params = [];

            for (const [col, raw] of Object.entries(row)) {
              if (col === '__row_no') continue;
              if (!colSet.has(col)) {
                skipped++;
                result.push(resultRow(row.__row_no, spec.table, key.label, 'SKIP_CELL', col, raw, 'UNKNOWN_COLUMN'));
                continue;
              }
              if (key.keys.includes(col)) continue;
              if ((spec.blocked || []).includes(col)) continue;

              const v = validateCell(col, raw, spec);
              if (!v.ok) {
                invalid++;
                updates.length = 0;
                result.push(resultRow(row.__row_no, spec.table, key.label, 'SKIP', col, raw, v.reason));
                break;
              }
              if (v.action === 'KEEP_OLD') continue;

              params.push(v.value);
              updates.push(`${qIdent(col)}=$${params.length}`);
            }

            if (updates.length) {
              if (apply) {
                key.values.forEach(v=>params.push(v));
                await client.query(
                  `UPDATE ${qIdent(spec.table)} SET ${updates.join(', ')} WHERE ${where.replace(/\$(\d+)/g, (_,n)=>'$'+(params.length-key.values.length+Number(n)))}`,
                  params
                );
              }
              updated++;
              result.push(resultRow(row.__row_no, spec.table, key.label, apply ? 'UPDATED' : 'VALID_UPDATE', '', '', apply ? 'APPLIED' : 'DRY_RUN'));
            } else if (!result.find(r => r.row_no === row.__row_no && r.result === 'SKIP')) {
              skipped++;
              result.push(resultRow(row.__row_no, spec.table, key.label, 'SKIP', '', '', 'NO_UPDATABLE_VALUE'));
            }
          }
        }

        stopped = shouldStop(invalid, processed);
        if (stopped) {
          result.push(resultRow(row.__row_no, spec.table, '', 'STOPPED', '', '', stopped));
          break;
        }
      }

      if (client) await client.query('COMMIT');
    } catch(e) {
      if (client) await client.query('ROLLBACK').catch(()=>{});
      throw e;
    } finally {
      if (client) client.release();
    }

    const cols = ['row_no','table','key','result','column_name','value','reason'];
    const csv = toCsv(result, cols);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="gm_safe_update_result_${Date.now()}.csv"`);
    res.end(csv);
  } catch(e) {
    fail(res, 500, 'safe update failed', { detail:String(e && e.message || e) });
  }
});


router.post('/api/gm/builder/cafe24-member-import', express.text({ type:['text/*','application/csv'], limit:'50mb' }), async (req,res)=>{
  const apply = String(req.query.apply || '').toUpperCase() === 'YES';
  const db = dbFrom(req);
  let rows = parseCsv(req.body);
  if (rows.length > LIMITS.MAX_ROWS) rows = rows.slice(0, LIMITS.MAX_ROWS);
  const result = [];
  let processed=0, insertedOrUpdated=0, skipped=0, invalid=0;
  const cols = ['row_no','member_id','result','member_action','address_action','name','email','phone','mobile','zipcode','address1','address2','member_grade','member_grade_code','deposit_balance','point_balance','refund_account_info','total_order_count','total_purchase_amount','last_login_at','joined_at','reason'];
  try {
    const memberCols = new Set(await getColumns(db, 'gm_member'));
    const addressCols = new Set(await getColumns(db, 'gm_member_address'));
    const client = apply ? await db.connect() : null;
    try {
      if (client) await client.query('BEGIN');
      for (const row of rows) {
        processed++;
        const mapped = mapCafe24Member(row);
        const m = mapped.member;
        const a = mapped.address;
        if (!m.member_id) {
          invalid++; skipped++;
          result.push(cafe24ImportResultRow(row, m, 'SKIP', '', '', 'MISSING_MEMBER_ID'));
          continue;
        }
        const mObj = {};
        for (const [k,v] of Object.entries(m)) if (memberCols.has(k)) mObj[k]=v;
        const aObj = {};
        for (const [k,v] of Object.entries(a)) if (addressCols.has(k)) aObj[k]=v;
        let memberAction = 'VALID_MEMBER';
        let addressAction = (a.zipcode || a.address1 || a.address2) ? 'VALID_ADDRESS' : 'NO_ADDRESS';
        if (apply) {
          const mr = await upsertObject(client, 'gm_member', mObj, ['member_id']);
          memberAction = mr.action;
          if (addressAction !== 'NO_ADDRESS') {
            // keep only one default address per member
            if (addressCols.has('is_default')) await client.query(`UPDATE gm_member_address SET is_default='N', updated_at=NOW() WHERE member_id=$1`, [m.member_id]);
            const ar = await upsertObject(client, 'gm_member_address', aObj, ['address_id']);
            addressAction = ar.action;
          }
        }
        insertedOrUpdated++;
        result.push(cafe24ImportResultRow(row, m, apply?'APPLIED':'VALID', memberAction, addressAction, apply?'APPLIED':'DRY_RUN'));
      }
      if (client) await client.query('COMMIT');
    } catch(e) {
      if (client) await client.query('ROLLBACK').catch(()=>{});
      throw e;
    } finally {
      if (client) client.release();
    }
    const csv = toCsv(result, cols);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cafe24_member_import_${apply?'apply':'dryrun'}_${Date.now()}.csv"`);
    res.end(csv);
  } catch(e) {
    fail(res, 500, 'cafe24 member import failed', { detail:String(e && e.message || e), processed, insertedOrUpdated, skipped, invalid });
  }
});


router.get('/api/gm/builder/cafe24-member-export', async (req,res)=>{
  const db = dbFrom(req);
  const limit = Math.min(Math.max(Number(req.query.limit || 50000), 1), 100000);
  try{
    const memberCols = new Set(await getColumns(db, 'gm_member'));
    const addressCols = new Set(await getColumns(db, 'gm_member_address').catch(()=>[]));
    const rawExpr = memberCols.has('cafe24_raw_json') ? 'm.cafe24_raw_json' : "'{}'::jsonb";
    const addrSelect = addressCols.has('address_id') ? `
      LEFT JOIN LATERAL (
        SELECT * FROM gm_member_address a
        WHERE a.member_id=m.member_id
        ORDER BY CASE WHEN a.is_default='Y' THEN 0 ELSE 1 END, a.updated_at DESC NULLS LAST
        LIMIT 1
      ) a ON TRUE` : '';
    const r = await db.query(`
      SELECT m.*, ${rawExpr} AS cafe24_raw,
        ${addressCols.has('address_id') ? `a.zipcode AS addr_zipcode, a.address1 AS addr_address1, a.address2 AS addr_address2, a.sido AS addr_sido, a.sigungu AS addr_sigungu, a.receiver_phone AS addr_phone, a.receiver_mobile AS addr_mobile, a.receiver_name AS addr_receiver_name` : `'' AS addr_zipcode, '' AS addr_address1, '' AS addr_address2, '' AS addr_sido, '' AS addr_sigungu, '' AS addr_phone, '' AS addr_mobile, '' AS addr_receiver_name`}
      FROM gm_member m
      ${addrSelect}
      ORDER BY m.updated_at DESC NULLS LAST, m.created_at DESC NULLS LAST
      LIMIT $1`, [limit]);
    const rows = r.rows.map(x=>{
      const raw = parseRawJson(x.cafe24_raw);
      const fallback = {
        '아이디':x.member_id,
        '이름':x.member_name || x.addr_receiver_name,
        '영문이름':x.member_name_en,
        '이메일':x.email,
        '휴대폰번호':x.default_receiver_mobile || x.addr_mobile || x.phone,
        '전화번호':x.default_receiver_phone || x.addr_phone,
        '국가':x.country_code,
        '국적':x.nationality,
        '우편번호':x.default_zipcode || x.addr_zipcode,
        '주소1':x.default_address1 || x.addr_address1,
        '주소2':x.default_address2 || x.addr_address2,
        '주 (State/Province)':x.default_sido || x.addr_sido,
        '도시 (City)':x.default_sigungu || x.addr_sigungu,
        '추천인 아이디':x.recommender_id,
        '회원등급':x.member_grade,
        '회원등급코드':x.member_grade_code,
        '사용가능 적립금':x.point_balance,
        '총예치금':x.deposit_balance,
        '환불계좌정보(은행/계좌/예금주)':refundJoin(x.refund_bank_name,x.refund_account_no,x.refund_account_holder),
        '누적주문건수':'',
        '총 실주문건수':'',
        '총구매금액':'',
        '총 방문횟수(1년 내)':'',
        '총 사용 적립금':'',
        '총적립금':'',
        '미가용 적립금':'',
        '최종접속일':'',
        '최종주문일':'',
        '회원 가입일':'',
        '가입시간':'',
        '회원구분':'',
        '회원 가입경로':'',
        'e메일 수신여부':'',
        '모바일 메시지 수신여부':'',
        '탈퇴여부':'',
        '탈퇴일':'',
        '휴면처리일':''
      };
      const out = {};
      for (const h of CAFE24_MEMBER_HEADERS) out[h] = rawOrFallback(raw, h, fallback[h] ?? '');
      return out;
    });
    const csv = toCsv(rows, CAFE24_MEMBER_HEADERS);
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cafe24_member_export_${Date.now()}.csv"`);
    res.end(csv);
  }catch(e){
    fail(res, 500, 'cafe24 member export failed', { detail:String(e && e.message || e) });
  }
});

router.get('/api/gm/builder/cafe24-member-template', (req,res)=>{
  const headers = CAFE24_MEMBER_HEADERS;
  const csv = headers.join(',') + '\n';
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="cafe24_member_import_template.csv"`);
  res.end('\ufeff' + csv);
});

module.exports = router;
