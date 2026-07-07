/* routes/order.js
 * GM_ORDER_ROUTE_V037_DOM_ORDERFORM_SAVE
 * - POST /api/gm/order/create : gm_order 1건 + gm_order_item N건 저장
 * - GET  /api/gm/order/get    : order_no 기준 조회
 * - POST /api/gm/order/link   : Cafe24 주문번호 연결
 */
'use strict';

const express = require('express');
const router = express.Router();
const VERSION = 'GM_ORDER_ROUTE_V037_DOM_ORDERFORM_SAVE';

const ORDER_COLS = [
  'order_no','member_id','guest_key','orderer_name','orderer_phone','orderer_mobile','orderer_email',
  'receiver_name','receiver_phone','receiver_mobile','receiver_safe_phone','receiver_zipcode','receiver_address1','receiver_address2','delivery_memo',
  'customs_required_yn','customs_clearance_code','customs_name','customs_mobile',
  'payment_method','payment_method_display','payment_bank_name','payment_account_number','depositor_name','depositor_phone',
  'expected_payment_amount','actual_payment_amount','payment_difference_amount','total_product_price','total_delivery_fee','extra_area_delivery_fee',
  'estimated_customs_fee','estimated_import_vat','total_payment_price',
  'order_status','payment_status','shipping_status','cs_status','cancel_status','purchase_confirmed_yn',
  'receiver_address_old','receiver_address_full','receiver_sido','receiver_sigungu','receiver_eup_myeon_dong','cafe24_order_no'
];
const ORDER_ITEM_COLS = [
  'order_no','pi_ii_vi','product_name','option_name','option_value','quantity',
  'mall_sale_price','customer_order_price','final_supply_price','product_amount',
  'delivery_type','delivery_fee','extra_area_delivery_fee','mall_code','supplier_id','supplier_name',
  'product_url','thumb_file_name','hs_code','origin_country','carrier_name','tracking_number',
  'item_order_status','item_shipping_status','cafe24_order_no','source_mall','source_uid'
];

function db(req){ return req.app.locals.db || req.app.locals.pool; }
function clean(v){ return String(v == null ? '' : v).replace(/[\u00A0\u200B-\u200D\uFEFF]/g,' ').replace(/\s+/g,' ').trim(); }
function nullable(v){ const s = clean(v); return s ? s : null; }
function money(v, def=0){ if(v === undefined || v === null || v === '') return def; const n = Number(String(v).replace(/[^0-9.-]/g,'')); return Number.isFinite(n) ? Math.round(n) : def; }
function pick(obj, keys, def=''){
  for(const k of keys){ if(obj && obj[k] !== undefined && obj[k] !== null && clean(obj[k]) !== '') return obj[k]; }
  return def;
}
function pickDeep(raw, keys, def=''){
  const direct = pick(raw, keys, '');
  if(clean(direct)) return direct;
  return pick(raw && raw.address || {}, keys, def);
}
function totalVal(raw, keys, def=0){
  const v = pick(raw, keys, '');
  if(clean(v)) return money(v, def);
  return money(pick(raw && raw.totals || {}, keys, def), def);
}
function normalizeUrl(v){ const s=clean(v); if(!s) return null; if(/^https?:\/\//i.test(s)) return s; if(/^\/\//.test(s)) return 'https:'+s; return s; }
function ok(res, data){ res.json(Object.assign({ok:true, version:VERSION}, data||{})); }
function fail(res, status, message, extra){ res.status(status).json(Object.assign({ok:false, version:VERSION, error:message}, extra||{})); }
function pad(n,len){ return String(n).padStart(len,'0'); }
function autoOrderNo(){ const d=new Date(); return 'GM'+d.getFullYear()+pad(d.getMonth()+1,2)+pad(d.getDate(),2)+'-'+pad(d.getHours(),2)+pad(d.getMinutes(),2)+pad(d.getSeconds(),2)+'-'+String(Date.now()).slice(-4); }
function cafe24OrderNo(raw){ return nullable(pick(raw||{}, ['cafe24_order_no','cafe24OrderNo','cafe24_order_id','cafe24OrderId','order_id','orderId','mall_order_no','mallOrderNo','internal_order_no','internalOrderNo'], '')); }
function normalizeItems(raw){
  if(Array.isArray(raw.items)) return raw.items;
  if(Array.isArray(raw.orderItems)) return raw.orderItems;
  if(Array.isArray(raw.products)) return raw.products;
  if(Array.isArray(raw.dom_items)) return raw.dom_items;
  if(raw.item && typeof raw.item === 'object') return [raw.item];
  return [];
}
function itemVal(it, keys, def=''){ return pick(it||{}, keys, def); }
function sourceMallFrom(v, uid, url, mallCode){
  const direct = clean(v).toUpperCase(); if(direct) return direct;
  const u = clean(uid).toUpperCase(); if(u.includes('_')) return u.split('_')[0];
  const x = String(url||'').toLowerCase();
  if(x.includes('coupang.com') || x.includes('link.coupang.com')) return 'CPKR';
  if(x.includes('aliexpress.com')) return 'ALKR';
  if(x.includes('temu.com')) return 'TEMU';
  const m = clean(mallCode).toUpperCase();
  return (m === 'CAFE24' || m === 'INTERNAL') ? '' : m;
}
function sourceUidFrom(v, mall, key){
  const direct=clean(v); if(direct) return direct;
  const k=clean(key); if(!k) return '';
  const m=clean(mall).toUpperCase();
  return m && k.indexOf(m+'_') !== 0 ? m+'_'+k : k;
}
function rowObj(cols, obj){ const out={}; cols.forEach(c=>{ if(obj[c] !== undefined) out[c]=obj[c]; }); return out; }
async function updateThenInsert(client, table, keyCol, row, extraCols){
  extraCols = extraCols || [];
  const key = row[keyCol];
  if(!key) throw new Error(table+'.'+keyCol+' required');
  const cols = Object.keys(row).filter(c => c !== keyCol);
  if(cols.length){
    const sets = cols.map((c,i)=>`${c}=$${i+2}`).join(', ');
    const upd = await client.query(`UPDATE ${table} SET ${sets}, updated_at=now() WHERE ${keyCol}=$1`, [key].concat(cols.map(c=>row[c])));
    if(upd.rowCount) return 'updated';
  }
  const insCols = Object.keys(row).filter(c => row[c] !== undefined);
  const vals = insCols.map((_,i)=>`$${i+1}`);
  const allCols = insCols.concat(extraCols.map(e=>e.col));
  const allVals = vals.concat(extraCols.map(e=>e.expr));
  await client.query(`INSERT INTO ${table} (${allCols.join(',')}) VALUES (${allVals.join(',')})`, insCols.map(c=>row[c]));
  return 'inserted';
}
function buildOrderRow(raw, inputItems){
  const orderNo = clean(raw.gm_order_no || raw.order_no) || autoOrderNo();
  const cafeNo = cafe24OrderNo(raw);
  const o = {
    order_no: orderNo,
    member_id: nullable(raw.member_id),
    guest_key: nullable(raw.guest_key),
    orderer_name: nullable(raw.orderer_name || raw.buyer_name || raw.name),
    orderer_phone: nullable(raw.orderer_phone || raw.buyer_phone),
    orderer_mobile: nullable(raw.orderer_mobile || raw.buyer_mobile || raw.mobile),
    orderer_email: nullable(raw.orderer_email || raw.email),
    receiver_name: nullable(pickDeep(raw, ['receiver_name','rname','name'])),
    receiver_phone: nullable(pickDeep(raw, ['receiver_phone','rphone1','phone'])),
    receiver_mobile: nullable(pickDeep(raw, ['receiver_mobile','rphone2','mobile'])),
    receiver_safe_phone: nullable(pickDeep(raw, ['receiver_safe_phone','safe_phone'])),
    receiver_zipcode: nullable(pickDeep(raw, ['receiver_zipcode','zipcode','zip','rzipcode'])),
    receiver_address1: nullable(pickDeep(raw, ['receiver_address1','address1','addr1','raddr1'])),
    receiver_address2: nullable(pickDeep(raw, ['receiver_address2','address2','addr2','raddr2'])),
    delivery_memo: nullable(pickDeep(raw, ['delivery_memo','memo','message','omessage'])),
    customs_required_yn: clean(raw.customs_required_yn || 'N'),
    customs_clearance_code: nullable(raw.customs_clearance_code),
    customs_name: nullable(raw.customs_name),
    customs_mobile: nullable(raw.customs_mobile),
    payment_method: clean(raw.payment_method || 'pending'),
    payment_method_display: clean(raw.payment_method_display || '미정'),
    payment_bank_name: nullable(raw.payment_bank_name),
    payment_account_number: nullable(raw.payment_account_number),
    depositor_name: nullable(raw.depositor_name),
    depositor_phone: nullable(raw.depositor_phone),
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
    receiver_address_old: nullable(raw.receiver_address_old || raw.address_old || raw.jibun_address),
    receiver_address_full: nullable(raw.receiver_address_full || raw.address_full),
    receiver_sido: nullable(raw.receiver_sido || raw.sido),
    receiver_sigungu: nullable(raw.receiver_sigungu || raw.sigungu),
    receiver_eup_myeon_dong: nullable(raw.receiver_eup_myeon_dong || raw.eup_myeon_dong || raw.dong),
    cafe24_order_no: cafeNo
  };
  if(!o.total_product_price || !o.total_payment_price){
    let product=0, delivery=0, extra=0;
    for(const it of inputItems){
      const qty = Math.max(1, money(itemVal(it,['quantity','qty'],1),1));
      const line = money(itemVal(it,['product_amount','amount','line_amount'],0),0);
      const unit = money(itemVal(it,['customer_order_price','mall_sale_price','price','sale_price','normal_price'],0),0);
      product += line || unit*qty;
      delivery += money(itemVal(it,['delivery_fee','shipping_fee'],0),0);
      extra += money(itemVal(it,['extra_area_delivery_fee','extra_fee'],0),0);
    }
    if(!o.total_product_price) o.total_product_price = product;
    if(!o.total_delivery_fee) o.total_delivery_fee = delivery;
    if(!o.extra_area_delivery_fee) o.extra_area_delivery_fee = extra;
    if(!o.total_payment_price) o.total_payment_price = product+delivery+extra;
    if(!o.expected_payment_amount) o.expected_payment_amount = o.total_payment_price;
  }
  return rowObj(ORDER_COLS, o);
}
function buildItemRow(orderRow, src, idx){
  const qty = Math.max(1, money(itemVal(src,['quantity','qty'],1),1));
  const mallCode = clean(itemVal(src,['mall_code','mallCode','source_mall','sourceMall'], '')).toUpperCase();
  const pi = clean(itemVal(src,['pi_ii_vi','piIiVi','source_key','sourceKey','key','product_uid','uid'], '')) || (mallCode ? mallCode+'_'+idx : 'ITEM_'+idx);
  const unit = money(itemVal(src,['customer_order_price','mall_sale_price','sale_price','price','normal_price'],0),0);
  const amount = money(itemVal(src,['product_amount','amount','line_amount'],0),0) || unit*qty;
  const sourceMall = sourceMallFrom(itemVal(src,['source_mall','sourceMall','source_code','sourceCode'], ''), itemVal(src,['source_uid','sourceUid','product_uid','uid'], ''), itemVal(src,['product_url','source_url','url'], ''), mallCode);
  const sourceUid = sourceUidFrom(itemVal(src,['source_uid','sourceUid','product_uid','uid'], ''), sourceMall, itemVal(src,['source_key','sourceKey','key','pi_ii_vi','piIiVi'], '')) || pi;
  return rowObj(ORDER_ITEM_COLS, {
    order_no: orderRow.order_no,
    pi_ii_vi: pi,
    product_name: clean(itemVal(src,['product_name','productName','name','title'], '상품')) || '상품',
    option_name: nullable(itemVal(src,['option_name','optionName'], '')),
    option_value: nullable(itemVal(src,['option_value','optionValue','selected_option','selectedOption'], '')),
    quantity: qty,
    mall_sale_price: money(itemVal(src,['mall_sale_price','sale_price','normal_price','price'], unit), unit),
    customer_order_price: unit,
    final_supply_price: itemVal(src,['final_supply_price','supply_price'], null) == null ? null : money(itemVal(src,['final_supply_price','supply_price'], null),0),
    product_amount: amount,
    delivery_type: nullable(itemVal(src,['delivery_type','ship_type','shipping_type'], '')),
    delivery_fee: money(itemVal(src,['delivery_fee','shipping_fee'],0),0),
    extra_area_delivery_fee: money(itemVal(src,['extra_area_delivery_fee','extra_fee'],0),0),
    mall_code: nullable(mallCode),
    supplier_id: nullable(itemVal(src,['supplier_id','supplierId'],'')),
    supplier_name: nullable(itemVal(src,['supplier_name','supplierName','seller','seller_name'],'')),
    product_url: normalizeUrl(itemVal(src,['product_url','source_url','url'],'')),
    thumb_file_name: nullable(itemVal(src,['thumb_file_name','thumb','thumb_url','image','image_url'],'')),
    hs_code: nullable(itemVal(src,['hs_code','hsCode'],'')),
    origin_country: nullable(itemVal(src,['origin_country','origin','country'],'')),
    carrier_name: nullable(itemVal(src,['carrier_name','carrier'],'')),
    tracking_number: nullable(itemVal(src,['tracking_number','tracking'],'')),
    item_order_status: clean(itemVal(src,['item_order_status','order_status'],'ordered')) || 'ordered',
    item_shipping_status: clean(itemVal(src,['item_shipping_status','shipping_status'],'pending')) || 'pending',
    cafe24_order_no: orderRow.cafe24_order_no || null,
    source_mall: nullable(sourceMall),
    source_uid: nullable(sourceUid)
  });
}
async function insertRow(client, table, row, extraCols){
  const cols = Object.keys(row).filter(c => row[c] !== undefined);
  const vals = cols.map((_,i)=>`$${i+1}`);
  const extra = extraCols || [];
  const sql = `INSERT INTO ${table} (${cols.concat(extra.map(e=>e.col)).join(',')}) VALUES (${vals.concat(extra.map(e=>e.expr)).join(',')})`;
  await client.query(sql, cols.map(c=>row[c]));
}
async function saveOrder(client, raw, inputItems){
  const orderRow = buildOrderRow(raw, inputItems);
  const orderAction = await updateThenInsert(client, 'gm_order', 'order_no', orderRow, [{col:'ordered_at',expr:'now()'}, {col:'created_at',expr:'now()'}, {col:'updated_at',expr:'now()'}]);
  await client.query('DELETE FROM gm_order_item WHERE order_no=$1', [orderRow.order_no]);
  let itemCount = 0;
  for(const src of inputItems){
    const row = buildItemRow(orderRow, src, itemCount);
    await insertRow(client, 'gm_order_item', row, [{col:'created_at',expr:'now()'}, {col:'updated_at',expr:'now()'}]);
    itemCount++;
  }
  return {orderRow, orderAction, itemCount};
}

router.post('/api/gm/order/create', async (req,res)=>{
  const pool = db(req);
  if(!pool) return fail(res, 500, 'DB pool is not attached');
  const raw = req.body || {};
  const inputItems = normalizeItems(raw);
  if(!inputItems.length) return fail(res, 400, 'items required');
  const client = await pool.connect().catch(()=>null);
  if(!client) return fail(res, 500, 'DB client connect failed');
  try{
    await client.query('BEGIN');
    const saved = await saveOrder(client, raw, inputItems);
    await client.query('COMMIT');
    console.log('[GM_ORDER_CREATE_V037_OK]', JSON.stringify({order_no:saved.orderRow.order_no, items:saved.itemCount, total:saved.orderRow.total_payment_price, source:raw.source||''}));
    ok(res, {action:'order.create', order_no:saved.orderRow.order_no, gm_order_no:saved.orderRow.order_no, cafe24_order_no:saved.orderRow.cafe24_order_no, order_action:saved.orderAction, item_count:saved.itemCount, total_payment_price:saved.orderRow.total_payment_price});
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    console.error('[GM_ORDER_CREATE_V037_ERROR]', String(e && e.message || e));
    fail(res, 500, 'order create failed', {detail:String(e && e.message || e)});
  }finally{ client.release(); }
});

router.get('/api/gm/order/get', async (req,res)=>{
  const pool = db(req);
  if(!pool) return fail(res, 500, 'DB pool is not attached');
  const orderNo = clean(req.query.order_no || req.query.gm_order_no);
  if(!orderNo) return fail(res, 400, 'order_no required');
  try{
    const order = await pool.query('SELECT * FROM gm_order WHERE order_no=$1 LIMIT 1', [orderNo]);
    const items = await pool.query('SELECT * FROM gm_order_item WHERE order_no=$1 ORDER BY created_at ASC, pi_ii_vi ASC', [orderNo]);
    ok(res, {action:'order.get', order:order.rows[0] || null, items:items.rows || []});
  }catch(e){ fail(res, 500, 'order get failed', {detail:String(e && e.message || e)}); }
});

router.post('/api/gm/order/link', async (req,res)=>{
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
    await client.query('UPDATE gm_order SET cafe24_order_no=$2, updated_at=now() WHERE order_no=$1', [orderNo, cafeNo]);
    await client.query('UPDATE gm_order_item SET cafe24_order_no=$2, updated_at=now() WHERE order_no=$1', [orderNo, cafeNo]);
    await client.query('COMMIT');
    ok(res, {action:'order.link', order_no:orderNo, cafe24_order_no:cafeNo});
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    fail(res, 500, 'order link failed', {detail:String(e && e.message || e)});
  }finally{ client.release(); }
});

router.get('/api/order/:order_no', async (req,res)=>{
  req.query.order_no = req.params.order_no;
  const pool = db(req);
  if(!pool) return fail(res, 500, 'DB pool is not attached');
  try{
    const order = await pool.query('SELECT * FROM gm_order WHERE order_no=$1 LIMIT 1', [req.params.order_no]);
    const items = await pool.query('SELECT * FROM gm_order_item WHERE order_no=$1 ORDER BY created_at ASC, pi_ii_vi ASC', [req.params.order_no]);
    ok(res, {action:'order.get', order:order.rows[0] || null, items:items.rows || []});
  }catch(e){ fail(res, 500, 'order get failed', {detail:String(e && e.message || e)}); }
});

module.exports = router;
