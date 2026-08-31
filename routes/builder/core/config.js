const VERSION = 'GM_SAFE_UPDATE_BUILDER_V018_MODULAR_SAFE';

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
  product_image_vector: {
    table: 'gm_product_image_vector',
    key: ['product_uid'],
    order: 'product_uid ASC',
    critical: ['product_uid','vector_image'],
    numeric: [],
    defaults: {},
    enums: {},
    blocked: [],
    allowInsert: true
  },
  smartfit_template_vector: {
    table: 'gm_smartfit_template_vector',
    key: ['template_id'],
    order: 'template_id ASC',
    critical: ['template_id','vector_image'],
    numeric: ['template_id'],
    defaults: {},
    enums: {},
    blocked: [],
    allowInsert: true
  },
  smartfit_space_vector: {
    table: 'gm_smartfit_space_vector',
    key: ['space_id'],
    order: 'space_id ASC',
    critical: ['space_id','vector_image'],
    numeric: ['space_id'],
    defaults: {},
    enums: {},
    blocked: [],
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


module.exports = { VERSION, TABLES, LIMITS };
