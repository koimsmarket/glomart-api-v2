const express = require('express');
const router = express.Router();

const VERSION = 'GM_SAFE_UPDATE_BUILDER_V009_CAFE24_MEMBER_IMPORT';

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
    blocked: ['created_at'],
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
    key: ['category_no'],
    order: 'depth ASC, sort_order ASC, category_no ASC',
    critical: ['category_no'],
    numeric: ['depth','sort_order','view_count','search_count','wish_count','cart_count','order_count','sales_qty','sales_amount','purchase_amount','gross_profit','return_count','exchange_count','ad_view_count','ad_order_count','ad_sales_qty','ad_sales_amount'],
    defaults: { leaf_yn:'N', display_yn:'Y', depth:'0', sort_order:'0' },
    enums: { leaf_yn:['Y','N'], display_yn:['Y','N'] },
    blocked: ['created_at'],
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


function pickKor(row, names, d='') {
  for (const n of names) {
    if (row[n] !== undefined && row[n] !== null && clean(row[n]) !== '') return clean(row[n]);
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
  const member = {
    member_id: memberId,
    cafe24_member_id: memberId,
    member_name: name,
    member_name_en: pickKor(row, ['영문이름']),
    email: pickKor(row, ['이메일','이메일주소']),
    phone: mobile || phone,
    country_code: pickKor(row, ['국가']),
    nationality: pickKor(row, ['국적']),
    language_code: 'ko',
    cs_language: 'ko',
    recommender_id: pickKor(row, ['추천인 아이디']),
    member_grade: pickKor(row, ['회원등급']),
    member_grade_code: pickKor(row, ['회원등급코드']),
    member_status: cafe24Status(row),
    deposit_balance: money(pickKor(row, ['총예치금'])),
    point_balance: money(pickKor(row, ['사용가능 적립금','총적립금'])),
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
    delivery_memo: ''
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
  const limit = Math.min(Math.max(Number(req.query.limit || 5000), 1), 50000);

  try {
    const cols = await getColumns(db, spec.table);
    const r = await db.query(`SELECT ${cols.map(qIdent).join(', ')} FROM ${qIdent(spec.table)} ORDER BY ${spec.order} LIMIT $1`, [limit]);
    if (format === 'json') return ok(res, { table:spec.table, count:r.rows.length, columns:cols, rows:r.rows });

    const csv = toCsv(r.rows, cols);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${spec.table}_${Date.now()}.csv"`);
    res.end(csv);
  } catch(e) {
    fail(res, 500, 'export failed', { detail:String(e && e.message || e) });
  }
});

router.post('/api/gm/builder/safe-update', express.text({ type:['text/*','application/csv'], limit:'30mb' }), async (req,res)=>{
  const spec = tableSpec(req.query.table);
  if (!spec) return fail(res, 400, 'invalid table');

  const apply = String(req.query.apply || '').toUpperCase() === 'YES';
  const db = dbFrom(req);

  let rows = parseCsv(req.body);
  if (rows.length > LIMITS.MAX_ROWS) {
    rows = rows.slice(0, LIMITS.MAX_ROWS);
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
  const cols = ['row_no','member_id','result','member_action','address_action','name','mobile','zipcode','address1','reason'];
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
          result.push({row_no:row.__row_no, member_id:'', result:'SKIP', member_action:'', address_action:'', name:m.member_name, mobile:m.default_receiver_mobile, zipcode:m.default_zipcode, address1:m.default_address1, reason:'MISSING_MEMBER_ID'});
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
        result.push({row_no:row.__row_no, member_id:m.member_id, result:apply?'APPLIED':'VALID', member_action:memberAction, address_action:addressAction, name:m.member_name, mobile:m.default_receiver_mobile, zipcode:m.default_zipcode, address1:m.default_address1, reason:apply?'APPLIED':'DRY_RUN'});
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

router.get('/api/gm/builder/cafe24-member-template', (req,res)=>{
  const headers = ['아이디','이름','영문이름','이메일','휴대폰번호','전화번호','국가','국적','우편번호','주소1','주소2','주 (State/Province)','도시 (City)','추천인 아이디','회원등급','회원등급코드','사용가능 적립금','총예치금','환불계좌정보(은행/계좌/예금주)','탈퇴여부','휴면처리일','불량회원'];
  const csv = headers.join(',') + '\n';
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="cafe24_member_import_template.csv"`);
  res.end('\ufeff' + csv);
});

module.exports = router;