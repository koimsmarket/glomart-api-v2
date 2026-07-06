const express = require('express');
const router = express.Router();

const VERSION = 'GM_SAFE_UPDATE_BUILDER_V020_V018_PLUS_PRODUCT_OPTIONS';

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

function dbFrom(req) {
  return req.app.locals.db || req.app.locals.pool;
}
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

router.get('/api/gm/builder/export', async (req,res)=>{
  const spec = tableSpec(req.query.table);
  if (!spec) return fail(res, 400, 'invalid table');

  const format = String(req.query.format || 'csv').toLowerCase();
  const db = dbFrom(req);
  // V018: no default 5,000 row cap for single-table export.
  // If limit is provided, use it. If omitted, stream all rows in pages.
  const rawLimit = req.query.limit === undefined ? 0 : Number(req.query.limit || 0);
  const limit = rawLimit > 0 ? Math.min(Math.max(rawLimit, 1), 200000) : 0;
  const pageSize = Math.min(Math.max(Number(req.query.pageSize || 1000), 100), 5000);

  try {
    let cols = await getColumns(db, spec.table);
    if (spec.table === 'gm_member') cols = cols.filter(c => !/^password_/i.test(c));

    if (format === 'json') {
      const sql = `SELECT ${cols.map(qIdent).join(', ')} FROM ${qIdent(spec.table)} ORDER BY ${spec.order}` + (limit ? ' LIMIT $1' : '');
      const r = await db.query(sql, limit ? [limit] : []);
      return ok(res, { table:spec.table, count:r.rows.length, columns:cols, rows:r.rows });
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${spec.table}_${Date.now()}.csv"`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.write('﻿' + cols.map(csvEscape).join(',') + '\n');

    let offset = 0;
    let sent = 0;
    while (true) {
      const take = limit ? Math.min(pageSize, limit - sent) : pageSize;
      if (take <= 0) break;
      const r = await db.query(
        `SELECT ${cols.map(qIdent).join(', ')} FROM ${qIdent(spec.table)} ORDER BY ${spec.order} LIMIT $1 OFFSET $2`,
        [take, offset]
      );
      if (!r.rows.length) break;
      for (const row of r.rows) {
        res.write(cols.map(c => csvEscape(row[c])).join(',') + '\n');
      }
      sent += r.rows.length;
      offset += r.rows.length;
      try { console.log('[GM_BUILDER_EXPORT_STREAM_V018]', JSON.stringify({ table:spec.table, sent, offset, pageSize })); } catch(_) {}
      if (r.rows.length < take) break;
    }
    res.end();
  } catch(e) {
    if (!res.headersSent) return fail(res, 500, 'export failed', { detail:String(e && e.message || e) });
    try { res.end(); } catch(_) {}
  }
});


// 전체 테이블 CSV를 한 번에 ZIP으로 다운로드한다.
router.get('/api/gm/builder/export-all', async (req,res)=>{
  const db = dbFrom(req);
  const limit = Math.min(Math.max(Number(req.query.limit || 50000), 1), 50000);
  try{
    const files=[];
    const errors=[];
    for(const key of Object.keys(TABLES)){
      const spec = TABLES[key];
      try{
        let cols = await getColumns(db, spec.table);
        if(!cols.length){ errors.push({key, table:spec.table, error:'no columns'}); continue; }
        if(spec.table === 'gm_member') cols = cols.filter(c => !/^password_/i.test(c));
        const r = await db.query(`SELECT ${cols.map(qIdent).join(', ')} FROM ${qIdent(spec.table)} ORDER BY ${spec.order} LIMIT $1`, [limit]);
        files.push({ name: `${spec.table}.csv`, data: toCsv(r.rows, cols) });
      }catch(e){
        errors.push({ key, table:spec.table, error:String(e && e.message || e) });
      }
    }
    if(errors.length){
      files.push({ name:'_export_errors.json', data: JSON.stringify({ ok:false, errors }, null, 2) });
    }
    const zip = makeZip(files);
    const fname = `gm_all_tables_${Date.now()}.zip`;
    res.setHeader('Content-Type','application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.setHeader('Content-Length', String(zip.length));
    res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.end(zip);
  }catch(e){
    fail(res, 500, 'export all failed', { detail:String(e && e.message || e) });
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

router.post('/api/gm/builder/safe-update', express.text({ type:['text/*','application/csv'], limit:'30mb' }), async (req,res)=>{
  const spec = tableSpec(req.query.table);
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
