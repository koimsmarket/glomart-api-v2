/* routes/order.js
 * server.js에서 분리한 주문 저장 라우터.
 * server.js 하단의 app.use(require('./routes/order')) 방식으로 로드된다.
 * - POST /api/gm/order/create : gm_order 1건 + gm_order_item N건 저장
 * - GET  /api/gm/order/get    : order_no 기준 조회
 * - POST /api/gm/order/link   : Cafe24 주문번호 연결
 */
'use strict';

const express = require('express');
const router = express.Router();
const VERSION = 'GM_ORDER_ROUTE';

function db(req){ return req.app.locals.db || req.app.locals.pool; }
function clean(v){
  return String(v == null ? '' : v)
    .replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function money(v, def){
  if(def == null) def = 0;
  if(v === undefined || v === null || v === '') return def;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : def;
}
function pick(obj, keys, def){
  if(def === undefined) def = '';
  for(const k of keys){
    if(obj && obj[k] !== undefined && obj[k] !== null && clean(obj[k]) !== '') return obj[k];
  }
  return def;
}
function decodeUrlMaybe(v){
  let s = clean(v);
  if(!s) return '';
  for(let i=0;i<3;i++){
    try{
      const d = decodeURIComponent(s);
      if(d === s) break;
      s = d;
    }catch(_e){ break; }
  }
  return s;
}
function normalizeUrl(v){
  const s = clean(v);
  if(!s) return '';
  if(/^https?:\/\//i.test(s)) return s;
  if(/^\/\//.test(s)) return 'https:' + s;
  return s;
}
function externalProductUrl(v){
  let s = decodeUrlMaybe(v);
  if(!s) return '';
  try{
    const u = new URL(s);
    if(/koims1287\.cafe24\.com/i.test(u.hostname) && /gm_detail\.html/i.test(u.pathname)){
      const keys = ['product_url','productUrl','pageUrl','sourceUrl','url'];
      for(const k of keys){
        const inner = decodeUrlMaybe(u.searchParams.get(k) || '');
        if(/^https?:\/\//i.test(inner) && !/koims1287\.cafe24\.com/i.test(inner)) return inner;
      }
    }
    if(/^https?:\/\//i.test(s)) return s;
  }catch(_e){}
  const m = s.match(/(?:product_url|productUrl|pageUrl|sourceUrl|url)=([^&]+)/i);
  if(m){
    const inner = decodeUrlMaybe(m[1]);
    if(/^https?:\/\//i.test(inner)) return inner;
  }
  return normalizeUrl(s);
}
function nowKst(){
  const d = new Date(Date.now() + 9*60*60*1000);
  const pad = n => String(n).padStart(2,'0');
  return d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate())+' '+pad(d.getUTCHours())+':'+pad(d.getUTCMinutes())+':'+pad(d.getUTCSeconds());
}
function roadInfo(raw){
  const full = clean(raw.receiver_road_address || raw.road_address || raw.address_road || raw.receiver_address1 || raw.address1);
  const m = full.match(/(.+?\s(?:대로|로|길))\s*([0-9]+(?:-[0-9]+)?)/);
  return { road: clean(raw.receiver_road_address || raw.road_address || (m ? (m[1]+' '+m[2]) : full)), no: clean(raw.receiver_building_no || raw.building_no || raw.buildingNo || (m ? m[2] : '')) };
}
function ok(res, data){ res.json(Object.assign({ ok:true, version:VERSION }, data || {})); }
function fail(res, status, message, extra){ res.status(status).json(Object.assign({ ok:false, version:VERSION, error:message }, extra || {})); }
function pad(n, len){ return String(n).padStart(len, '0'); }
function autoOrderNo(){
  const d = new Date();
  return 'GM' + d.getFullYear() + pad(d.getMonth()+1,2) + pad(d.getDate(),2) + '-' + pad(d.getHours(),2) + pad(d.getMinutes(),2) + pad(d.getSeconds(),2) + '-' + String(Date.now()).slice(-4);
}
function cafe24OrderNo(raw){
  return clean(pick(raw || {}, ['cafe24_order_no','cafe24OrderNo','cafe24_order_id','cafe24OrderId','order_id','orderId','mall_order_no','mallOrderNo','internal_order_no','internalOrderNo'], '')) || null;
}
function sourceMallFrom(v, uid, url, mallCode){
  const direct = clean(v).toUpperCase();
  if(direct) return direct;
  const u = clean(uid).toUpperCase();
  if(u.indexOf('_') > 0) return u.split('_')[0];
  const x = String(url || '').toLowerCase();
  if(x.includes('coupang.com') || x.includes('link.coupang.com')) return 'CPKR';
  if(x.includes('aliexpress.com')) return 'ALKR';
  if(x.includes('temu.com')) return 'TEMU';
  if(x.includes('shopping.naver.com') || x.includes('smartstore.naver.com')) return 'NPKR';
  const m = clean(mallCode).toUpperCase();
  return (m === 'CAFE24' || m === 'INTERNAL') ? '' : m;
}
function sourceUidFrom(v, mall, key){
  const direct = clean(v);
  if(direct) return direct;
  const k = clean(key);
  if(!k) return '';
  const m = clean(mall).toUpperCase();
  return m && k.indexOf(m + '_') !== 0 ? m + '_' + k : k;
}
function addrVal(raw, keys){ return clean(pick(raw, keys, pick(raw.address || {}, keys, ''))); }
function totalVal(raw, keys, def){ return money(pick(raw, keys, pick(raw.totals || {}, keys, def)), def); }
function itemVal(it, keys, def){ return pick(it || {}, keys, def); }
function normalizeItems(raw){
  if(Array.isArray(raw.items)) return raw.items;
  if(Array.isArray(raw.orderItems)) return raw.orderItems;
  if(Array.isArray(raw.products)) return raw.products;
  if(raw.item && typeof raw.item === 'object') return [raw.item];
  return [];
}
function buildOrderRow(raw, inputItems){
  const orderNo = clean(raw.gm_order_no || raw.order_no) || autoOrderNo();
  const cafeNo = cafe24OrderNo(raw);
  const orderRow = {
    order_no: orderNo,
    member_id: clean(raw.member_id) || null,
    guest_key: clean(raw.guest_key) || null,
    orderer_name: clean(raw.orderer_name || raw.buyer_name || raw.name),
    orderer_phone: clean(raw.orderer_phone || raw.buyer_phone),
    orderer_mobile: clean(raw.orderer_mobile || raw.buyer_mobile || raw.mobile),
    orderer_email: clean(raw.orderer_email || raw.email),
    receiver_name: addrVal(raw, ['receiver_name','rname','name']),
    receiver_phone: addrVal(raw, ['receiver_phone','rphone1','phone']),
    receiver_mobile: addrVal(raw, ['receiver_mobile','rphone2','mobile']),
    receiver_safe_phone: addrVal(raw, ['receiver_safe_phone','safe_phone']),
    receiver_zipcode: addrVal(raw, ['receiver_zipcode','zipcode','zip','rzipcode']),
    receiver_address1: addrVal(raw, ['receiver_address1','address1','addr1','raddr1']),
    receiver_address2: addrVal(raw, ['receiver_address2','address2','addr2','raddr2']),
    delivery_memo: addrVal(raw, ['delivery_memo','memo','message','omessage']),
    customs_required_yn: clean(raw.customs_required_yn || 'N'),
    customs_clearance_code: clean(raw.customs_clearance_code),
    customs_name: clean(raw.customs_name),
    customs_mobile: clean(raw.customs_mobile),
    payment_method: clean(raw.payment_method || 'pending'),
    payment_method_display: clean(raw.payment_method_display || '미정'),
    payment_bank_name: clean(raw.payment_bank_name),
    payment_account_number: clean(raw.payment_account_number),
    depositor_name: clean(raw.depositor_name),
    depositor_phone: clean(raw.depositor_phone),
    expected_payment_amount: totalVal(raw, ['expected_payment_amount','payment','total_payment_price'], 0),
    actual_payment_amount: totalVal(raw, ['actual_payment_amount'], 0),
    payment_difference_amount: totalVal(raw, ['payment_difference_amount'], 0),
    total_product_price: totalVal(raw, ['total_product_price','product','product_total'], 0),
    total_delivery_fee: totalVal(raw, ['total_delivery_fee','delivery','delivery_fee'], 0),
    extra_area_delivery_fee: totalVal(raw, ['extra_area_delivery_fee','extra','extra_fee'], 0),
    estimated_customs_fee: totalVal(raw, ['estimated_customs_fee','customs_fee'], 0),
    estimated_import_vat: totalVal(raw, ['estimated_import_vat','import_vat'], 0),
    total_payment_price: totalVal(raw, ['total_payment_price','payment','total'], 0),
    order_status: clean(raw.order_status || 'ordered'),
    payment_status: clean(raw.payment_status || 'pending'),
    shipping_status: clean(raw.shipping_status || 'pending'),
    cs_status: clean(raw.cs_status || 'none'),
    cancel_status: clean(raw.cancel_status || 'none'),
    purchase_confirmed_yn: clean(raw.purchase_confirmed_yn || 'N'),
    receiver_address_old: clean(raw.receiver_address_old || raw.address_old || raw.jibun_address),
    receiver_address_full: clean(raw.receiver_address_full || raw.address_full),
    receiver_sido: clean(raw.receiver_sido || raw.sido),
    receiver_sigungu: clean(raw.receiver_sigungu || raw.sigungu),
    receiver_eup_myeon_dong: clean(raw.receiver_eup_myeon_dong || raw.eup_myeon_dong || raw.dong),
    receiver_road_address: roadInfo(raw).road,
    receiver_building_no: roadInfo(raw).no,
    cafe24_order_no: cafeNo,
    address_id: clean(raw.address_id || raw.addressId || (raw.address && (raw.address.address_id || raw.address.addressId)) || '') || null
  };
  if(!orderRow.total_product_price || !orderRow.total_payment_price){
    let product = 0, delivery = 0, extra = 0;
    for(const it of inputItems){
      const qty = Math.max(1, money(itemVal(it, ['quantity','qty'], 1), 1));
      const line = money(itemVal(it, ['product_amount','amount','line_amount'], 0), 0);
      const unit = money(itemVal(it, ['customer_order_price','mall_sale_price','price','sale_price','normal_price'], 0), 0);
      product += line || (unit * qty);
      delivery += money(itemVal(it, ['delivery_fee','shipping_fee'], 0), 0);
      extra += money(itemVal(it, ['extra_area_delivery_fee','extra_fee'], 0), 0);
    }
    if(!orderRow.total_product_price) orderRow.total_product_price = product;
    if(!orderRow.total_delivery_fee) orderRow.total_delivery_fee = delivery;
    if(!orderRow.extra_area_delivery_fee) orderRow.extra_area_delivery_fee = extra;
    if(!orderRow.total_payment_price) orderRow.total_payment_price = product + delivery + extra;
    if(!orderRow.expected_payment_amount) orderRow.expected_payment_amount = orderRow.total_payment_price;
  }
  return orderRow;
}
async function upsertOrder(client, o){
  const params = [
    o.order_no, o.member_id, o.guest_key, o.orderer_name, o.orderer_phone, o.orderer_mobile, o.orderer_email,
    o.receiver_name, o.receiver_phone, o.receiver_mobile, o.receiver_safe_phone,
    o.receiver_zipcode, o.receiver_address1, o.receiver_address2, o.delivery_memo,
    o.customs_required_yn, o.customs_clearance_code, o.customs_name, o.customs_mobile,
    o.payment_method, o.payment_method_display, o.payment_bank_name, o.payment_account_number,
    o.depositor_name, o.depositor_phone, o.expected_payment_amount, o.actual_payment_amount, o.payment_difference_amount,
    o.total_product_price, o.total_delivery_fee, o.extra_area_delivery_fee,
    o.estimated_customs_fee, o.estimated_import_vat, o.total_payment_price,
    o.order_status, o.payment_status, o.shipping_status, o.cs_status,
    o.cancel_status, o.purchase_confirmed_yn,
    o.receiver_address_old, o.receiver_address_full, o.receiver_sido, o.receiver_sigungu, o.receiver_eup_myeon_dong,
    o.receiver_road_address, o.receiver_building_no, o.cafe24_order_no, o.address_id, nowKst()
  ];
  const upd = await client.query(`
    UPDATE gm_order SET
      member_id=$2, guest_key=$3, orderer_name=$4, orderer_phone=$5, orderer_mobile=$6, orderer_email=$7,
      receiver_name=$8, receiver_phone=$9, receiver_mobile=$10, receiver_safe_phone=$11,
      receiver_zipcode=$12, receiver_address1=$13, receiver_address2=$14, delivery_memo=$15,
      customs_required_yn=$16, customs_clearance_code=$17, customs_name=$18, customs_mobile=$19,
      payment_method=$20, payment_method_display=$21, payment_bank_name=$22, payment_account_number=$23,
      depositor_name=$24, depositor_phone=$25, expected_payment_amount=$26, actual_payment_amount=$27, payment_difference_amount=$28,
      total_product_price=$29, total_delivery_fee=$30, extra_area_delivery_fee=$31,
      estimated_customs_fee=$32, estimated_import_vat=$33, total_payment_price=$34,
      order_status=$35, payment_status=$36, shipping_status=$37, cs_status=$38,
      cancel_status=$39, purchase_confirmed_yn=$40,
      receiver_address_old=$41, receiver_address_full=$42, receiver_sido=$43, receiver_sigungu=$44, receiver_eup_myeon_dong=$45,
      receiver_road_address=$46, receiver_building_no=$47, cafe24_order_no=$48, address_id=$49, updated_at=$50
    WHERE order_no=$1
  `, params);
  if(upd.rowCount) return 'updated';
  await client.query(`
    INSERT INTO gm_order (
      order_no, member_id, guest_key, orderer_name, orderer_phone, orderer_mobile, orderer_email,
      receiver_name, receiver_phone, receiver_mobile, receiver_safe_phone,
      receiver_zipcode, receiver_address1, receiver_address2, delivery_memo,
      customs_required_yn, customs_clearance_code, customs_name, customs_mobile,
      payment_method, payment_method_display, payment_bank_name, payment_account_number,
      depositor_name, depositor_phone, expected_payment_amount, actual_payment_amount, payment_difference_amount,
      total_product_price, total_delivery_fee, extra_area_delivery_fee,
      estimated_customs_fee, estimated_import_vat, total_payment_price,
      order_status, payment_status, shipping_status, cs_status,
      ordered_at, created_at, updated_at, cancel_status, purchase_confirmed_yn,
      receiver_address_old, receiver_address_full, receiver_sido, receiver_sigungu, receiver_eup_myeon_dong, receiver_road_address, receiver_building_no, cafe24_order_no, address_id
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$50,$50,$50,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49
    )
  `, params);
  return 'inserted';
}
function mergeDuplicateItems(inputItems){
  const map = new Map();
  for(const it of inputItems || []){
    const mallCode = clean(itemVal(it, ['mall_code','mallCode','source_mall','sourceMall'], '')).toUpperCase();
    const sourceMall = sourceMallFrom(itemVal(it, ['source_mall','sourceMall','source_code','sourceCode'], ''), itemVal(it, ['source_uid','sourceUid'], ''), itemVal(it, ['product_url','source_url','url'], ''), mallCode);
    const k = sourceUidFrom(itemVal(it, ['source_uid','sourceUid','product_uid','uid'], ''), sourceMall, itemVal(it, ['source_key','sourceKey','key'], '')) || clean(itemVal(it, ['pi_ii_vi','piIiVi'], ''));
    const key = clean(sourceMall + '|' + k + '|' + itemVal(it, ['option_name','optionName','option_value','optionValue'], ''));
    if(!key){ continue; }
    if(!map.has(key)){ map.set(key, Object.assign({}, it)); continue; }
    const prev = map.get(key);
    const q1 = Math.max(1, money(itemVal(prev, ['quantity','qty'], 1), 1));
    const q2 = Math.max(1, money(itemVal(it, ['quantity','qty'], 1), 1));
    prev.quantity = q1 + q2;
    prev.qty = prev.quantity;
    const a1 = money(itemVal(prev, ['product_amount','amount','line_amount'], 0), 0);
    const a2 = money(itemVal(it, ['product_amount','amount','line_amount'], 0), 0);
    if(a1 || a2) prev.product_amount = a1 + a2;
  }
  return Array.from(map.values());
}
async function replaceOrderItems(client, orderRow, inputItems){
  await client.query('DELETE FROM gm_order_item WHERE order_no=$1', [orderRow.order_no]);
  inputItems = mergeDuplicateItems(inputItems);
  let itemCount = 0;
  for(const src of inputItems){
    const qty = Math.max(1, money(itemVal(src, ['quantity','qty'], 1), 1));
    const mallCode = clean(itemVal(src, ['mall_code','mallCode','source_mall','sourceMall'], '')).toUpperCase();
    const pi = clean(itemVal(src, ['pi_ii_vi','piIiVi','source_key','sourceKey','key','product_uid','uid'], '')) || (mallCode ? mallCode + '_' + itemCount : 'ITEM_' + itemCount);
    const mallUnit = money(itemVal(src, ['mall_sale_price','mall_unit_price','source_sale_price','external_sale_price','coupang_sale_price','ali_sale_price','gm_coupang_price','gm_ali_price','raw_price','rawPrice'], 0), 0);
    const customerUnit = money(itemVal(src, ['customer_order_price','sale_price','price','normal_price','gm_price'], mallUnit), mallUnit);
    const unit = customerUnit || mallUnit;
    const amount = money(itemVal(src, ['product_amount','amount','line_amount'], 0), 0) || (unit * qty);
    const sourceMall = sourceMallFrom(itemVal(src, ['source_mall','sourceMall','source_code','sourceCode'], ''), itemVal(src, ['source_uid','sourceUid'], ''), itemVal(src, ['product_url','source_url','url'], ''), mallCode);
    const sourceUid = sourceUidFrom(itemVal(src, ['source_uid','sourceUid','product_uid','uid'], ''), sourceMall, itemVal(src, ['source_key','sourceKey','key'], '')) || pi;
    await client.query(`
      INSERT INTO gm_order_item (
        order_no, pi_ii_vi, product_name, option_name, option_value, quantity,
        mall_sale_price, customer_order_price, final_supply_price, product_amount,
        delivery_type, delivery_fee, extra_area_delivery_fee, mall_code, supplier_id, supplier_name,
        product_url, thumb_file_name, hs_code, origin_country, carrier_name, tracking_number,
        item_order_status, item_shipping_status, created_at, updated_at, cafe24_order_no, source_mall, source_uid
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$25,$26,$27,$28
      )
    `, [
      orderRow.order_no, pi, clean(itemVal(src, ['product_name','productName','name','title'], '')),
      clean(itemVal(src, ['option_name','optionName'], '')), clean(itemVal(src, ['option_value','optionValue','selected_option','selectedOption'], '')),
      qty, mallUnit || unit, unit,
      itemVal(src, ['final_supply_price','supply_price'], null) == null ? null : money(itemVal(src, ['final_supply_price','supply_price'], null), 0),
      amount, clean(itemVal(src, ['delivery_type','ship_type','shipping_type'], '')),
      money(itemVal(src, ['delivery_fee','shipping_fee'], 0), 0), money(itemVal(src, ['extra_area_delivery_fee','extra_fee'], 0), 0),
      mallCode, clean(itemVal(src, ['supplier_id','supplierId'], '')), clean(itemVal(src, ['supplier_name','supplierName','seller','seller_name'], '')),
      externalProductUrl(itemVal(src, ['product_url','source_url','url','productUrl','pageUrl'], '')), clean(itemVal(src, ['thumb_file_name','thumb','thumb_url','image','image_url'], '')),
      clean(itemVal(src, ['hs_code','hsCode'], '')), clean(itemVal(src, ['origin_country','origin','country'], '')),
      clean(itemVal(src, ['carrier_name','carrier'], '')), clean(itemVal(src, ['tracking_number','tracking'], '')),
      'READY_TO_ORDER', clean(itemVal(src, ['item_shipping_status','shipping_status'], 'pending')),
      nowKst(), orderRow.cafe24_order_no || null, sourceMall, sourceUid
    ]);
    itemCount++;
  }
  return itemCount;
}
router.post('/api/gm/order/create', async (req, res) => {
  const pool = db(req);
  if(!pool) return fail(res, 500, 'DB pool is not attached');
  const raw = req.body || {};
  const inputItems = normalizeItems(raw);
  if(!inputItems.length) return fail(res, 400, 'items required');
  const client = await pool.connect().catch(()=>null);
  if(!client) return fail(res, 500, 'DB client connect failed');
  try{
    const orderRow = buildOrderRow(raw, inputItems);
    await client.query('BEGIN');
    const orderAction = await upsertOrder(client, orderRow);
    const itemCount = await replaceOrderItems(client, orderRow, inputItems);
    await client.query('COMMIT');
    console.log('[GM_ORDER_CREATE_OK]', JSON.stringify({ order_no:orderRow.order_no, action:orderAction, items:itemCount, total:orderRow.total_payment_price }));
    ok(res, { action:'order.create', order_no:orderRow.order_no, cafe24_order_no:orderRow.cafe24_order_no, order_action:orderAction, item_count:itemCount, total_payment_price:orderRow.total_payment_price });
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    console.error('[GM_ORDER_CREATE_ERROR]', String(e && e.message || e));
    fail(res, 500, 'order create failed', { detail:String(e && e.message || e) });
  }finally{
    client.release();
  }
});
router.get('/api/gm/order/get', async (req, res) => {
  const pool = db(req);
  if(!pool) return fail(res, 500, 'DB pool is not attached');
  const orderNo = clean(req.query.order_no || req.query.gm_order_no);
  if(!orderNo) return fail(res, 400, 'order_no required');
  try{
    const order = await pool.query('SELECT * FROM gm_order WHERE order_no=$1 LIMIT 1', [orderNo]);
    const items = await pool.query('SELECT * FROM gm_order_item WHERE order_no=$1 ORDER BY created_at ASC, pi_ii_vi ASC', [orderNo]);
    ok(res, { action:'order.get', order:order.rows[0] || null, items:items.rows || [] });
  }catch(e){
    console.error('[GM_ORDER_GET_ERROR]', String(e && e.message || e));
    fail(res, 500, 'order get failed', { detail:String(e && e.message || e) });
  }
});
router.post('/api/gm/order/link', async (req, res) => {
  const pool = db(req);
  if(!pool) return fail(res, 500, 'DB pool is not attached');
  const body = req.body || {};
  const orderNo = clean(body.order_no || body.gm_order_no);
  const cafeNo = clean(body.cafe24_order_no || body.cafe24OrderNo || body.order_id || body.orderId);
  if(!orderNo || !cafeNo) return fail(res, 400, 'order_no/cafe24_order_no required');
  const client = await pool.connect().catch(()=>null);
  if(!client) return fail(res, 500, 'DB client connect failed');
  try{
    await client.query('BEGIN');
    await client.query('UPDATE gm_order SET cafe24_order_no=$2, updated_at=$3 WHERE order_no=$1', [orderNo, cafeNo, nowKst()]);
    await client.query('UPDATE gm_order_item SET cafe24_order_no=$2, updated_at=$3 WHERE order_no=$1', [orderNo, cafeNo, nowKst()]);
    await client.query('COMMIT');
    ok(res, { action:'order.link', order_no:orderNo, cafe24_order_no:cafeNo });
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    console.error('[GM_ORDER_LINK_ERROR]', String(e && e.message || e));
    fail(res, 500, 'order link failed', { detail:String(e && e.message || e) });
  }finally{
    client.release();
  }
});
// 기존 GET 호환 URL 유지
router.get('/api/order/:order_no', async (req,res)=>{
  req.query.order_no = req.params.order_no;
  const pool = db(req);
  if(!pool) return fail(res, 500, 'DB pool is not attached');
  try{
    const order = await pool.query('SELECT * FROM gm_order WHERE order_no=$1 LIMIT 1', [req.params.order_no]);
    const items = await pool.query('SELECT * FROM gm_order_item WHERE order_no=$1 ORDER BY created_at ASC, pi_ii_vi ASC', [req.params.order_no]);
    ok(res, { action:'order.get', order:order.rows[0] || null, items:items.rows || [] });
  }catch(e){ fail(res, 500, 'order get failed', { detail:String(e && e.message || e) }); }
});
module.exports = router;
