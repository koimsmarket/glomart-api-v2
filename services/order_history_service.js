/* services/order_history_service.js
 * GM_ORDER_HISTORY_SERVICE_V005_AUTO_ORDER_CANCEL_GUARD
 * 주문 생성/저장 로직과 분리된 주문조회 + 외부주문 CS 상태 서비스.
 * Cafe24 내부주문의 실제 CS 처리는 Cafe24 원본 액션 브리지에 맡긴다.
 */
'use strict';

const VERSION = 'GM_ORDER_HISTORY_SERVICE_V005_AUTO_ORDER_CANCEL_GUARD';

function text(v){ return String(v == null ? '' : v).trim(); }
function upper(v){ return text(v).toUpperCase(); }
function int(v, def){ const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : (def || 0); }
function sourceType(item){
  const source = upper(item && (item.source_mall || item.mall_code));
  return source === 'GMKR' || source === 'CAFE24' || source === 'INTERNAL' ? 'CAFE24' : 'EXTERNAL';
}
function orderSource(items){
  const hasCafe24 = items.some((x) => sourceType(x) === 'CAFE24');
  const hasExternal = items.some((x) => sourceType(x) === 'EXTERNAL');
  if(hasCafe24 && hasExternal) return 'MIXED';
  return hasExternal ? 'EXTERNAL' : 'CAFE24';
}
function customerIsClear(customer){
  return ['','NONE','CANCEL_WITHDRAWN','EXCHANGE_WITHDRAWN','RETURN_WITHDRAWN','CANCEL_REJECTED','EXCHANGE_REJECTED','RETURN_REJECTED'].includes(upper(customer));
}
function actionsFor(order, normalizedItems){
  const source = orderSource(normalizedItems);
  const seller = upper(order.seller_status) || 'READY_TO_ORDER';
  const customer = upper(order.customer_status) || 'NONE';
  const hasTracking = normalizedItems.some((x) => text(x.tracking_number));
  const actions = {
    direct_cancel:false, cancel_request:false, cancel_withdraw:false,
    exchange_request:false, exchange_withdraw:false,
    return_request:false, return_withdraw:false,
    shipping_trace:false, purchase_confirm:false
  };
  // 내부 주문은 Cafe24 DOM bridge가 실제 버튼 가시성을 결정한다.
  // 혼합 주문은 주문 단위 처리를 금지하고 상품별 처리 구조가 준비될 때까지 상세조회만 허용한다.
  if(source !== 'EXTERNAL') return actions;

  actions.shipping_trace = hasTracking && ['SHIPPING','DELIVERED'].includes(seller);
  if(customer === 'CANCEL_REQUESTED') actions.cancel_withdraw = true;
  if(customer === 'EXCHANGE_REQUESTED') actions.exchange_withdraw = true;
  if(customer === 'RETURN_REQUESTED') actions.return_withdraw = true;
  if(!customerIsClear(customer)) return actions;

  actions.direct_cancel = ['READY_TO_ORDER','ORDERED'].includes(seller);
  actions.cancel_request = seller === 'PREPARING';
  actions.exchange_request = seller === 'DELIVERED';
  actions.return_request = seller === 'DELIVERED';
  actions.purchase_confirm = seller === 'DELIVERED';
  return actions;
}
function displayStatus(order, items){
  const customer = upper(order.customer_status);
  const customerMap = {
    PURCHASE_CONFIRMED:'구매확정',
    CANCEL_REQUESTED:'취소신청', CANCEL_PROCESSING:'취소처리중', CANCEL_COMPLETED:'주문취소', CANCEL_REJECTED:'취소거절', CANCEL_WITHDRAWN:'취소철회',
    EXCHANGE_REQUESTED:'교환신청', EXCHANGE_PROCESSING:'교환처리중', EXCHANGE_COMPLETED:'교환완료', EXCHANGE_REJECTED:'교환거절', EXCHANGE_WITHDRAWN:'교환철회',
    RETURN_REQUESTED:'반품신청', RETURN_PROCESSING:'반품처리중', RETURN_COMPLETED:'반품완료', RETURN_REJECTED:'반품거절', RETURN_WITHDRAWN:'반품철회'
  };
  if(customerMap[customer] && customer !== 'CANCEL_WITHDRAWN' && customer !== 'EXCHANGE_WITHDRAWN' && customer !== 'RETURN_WITHDRAWN') return customerMap[customer];
  const cs = upper(order.cs_status || order.cancel_status);
  if(cs && !['NONE','N','NULL'].includes(cs)){
    const csMap = {REQUESTED:'신청접수',PROCESSING:'처리중',COMPLETED:'처리완료',COMPLETE:'처리완료',CANCELLED:'주문취소',CANCELED:'주문취소'};
    if(csMap[cs]) return csMap[cs];
  }
  const seller = upper(order.seller_status);
  const sellerMap = {
    READY_TO_ORDER:'주문대기', ORDERED:'주문완료', PREPARING:'상품준비중',
    SHIPPING:'배송중', DELIVERED:'배송완료', CANCELLED:'주문취소'
  };
  if(sellerMap[seller]) return sellerMap[seller];
  const shipping = text(order.shipping_status || (items[0] && items[0].item_shipping_status)).toLowerCase();
  const shippingMap = { pending:'배송준비중', preparing:'상품준비중', shipping:'배송중', delivered:'배송완료', completed:'배송완료' };
  if(shippingMap[shipping]) return shippingMap[shipping];
  const status = text(order.order_status || (items[0] && items[0].item_order_status));
  return status || '주문완료';
}
function normalizeItem(item){
  return {
    order_no: text(item.order_no),
    cafe24_order_no: text(item.cafe24_order_no),
    source_type: sourceType(item),
    source_mall: text(item.source_mall || item.mall_code),
    product_name: text(item.product_name),
    option_name: text(item.option_name),
    option_value: text(item.option_value),
    quantity: int(item.quantity, 1),
    customer_order_price: int(item.customer_order_price || item.mall_sale_price, 0),
    mall_sale_price: int(item.mall_sale_price, 0),
    product_amount: int(item.product_amount, 0),
    delivery_fee: int(item.delivery_fee, 0),
    delivery_type: text(item.delivery_type),
    product_url: text(item.product_url),
    thumb_url: text(item.thumb_file_name || item.thumb_url),
    carrier_name: text(item.carrier_name),
    tracking_number: text(item.tracking_number),
    item_order_status: text(item.item_order_status),
    item_shipping_status: text(item.item_shipping_status)
  };
}
function normalizeOrder(order, items){
  const normalizedItems = items.map(normalizeItem);
  const first = normalizedItems[0] || {};
  const source = orderSource(items);
  const out = {
    order_no: text(order.order_no),
    cafe24_order_no: text(order.cafe24_order_no || first.cafe24_order_no),
    order_group_key: text(order.order_group_key || order.cafe24_order_no || order.order_no),
    member_id: text(order.member_id),
    source_type: source,
    ordered_at: order.ordered_at || order.created_at || null,
    created_at: order.created_at || null,
    updated_at: order.updated_at || null,
    orderer_name: text(order.orderer_name),
    orderer_phone: text(order.orderer_phone),
    orderer_mobile: text(order.orderer_mobile),
    orderer_email: text(order.orderer_email),
    receiver_name: text(order.receiver_name),
    receiver_phone: text(order.receiver_phone),
    receiver_mobile: text(order.receiver_mobile),
    receiver_zipcode: text(order.receiver_zipcode),
    receiver_address1: text(order.receiver_address1),
    receiver_address2: text(order.receiver_address2),
    receiver_address_full: [text(order.receiver_address1), text(order.receiver_address2)].filter(Boolean).join(' '),
    delivery_memo: text(order.delivery_memo),
    customs_required_yn: text(order.customs_required_yn),
    customs_clearance_code: text(order.customs_clearance_code),
    customs_name: text(order.customs_name),
    customs_mobile: text(order.customs_mobile),
    payment_method: text(order.payment_method),
    payment_method_display: text(order.payment_method_display),
    payment_bank_name: text(order.payment_bank_name),
    payment_account_number: text(order.payment_account_number),
    depositor_name: text(order.depositor_name),
    expected_payment_amount: int(order.expected_payment_amount, 0),
    actual_payment_amount: int(order.actual_payment_amount, 0),
    total_product_price: int(order.total_product_price, 0),
    total_delivery_fee: int(order.total_delivery_fee, 0),
    extra_area_delivery_fee: int(order.extra_area_delivery_fee, 0),
    estimated_customs_fee: int(order.estimated_customs_fee, 0),
    estimated_import_vat: int(order.estimated_import_vat, 0),
    total_payment_price: int(order.total_payment_price, 0),
    seller_status: text(order.seller_status),
    customer_status: text(order.customer_status),
    order_status: text(order.order_status),
    payment_status: text(order.payment_status),
    shipping_status: text(order.shipping_status),
    cs_status: text(order.cs_status),
    cs_reason_code: text(order.cs_reason_code),
    cs_reason_text: text(order.cs_reason_text),
    cs_requested_at: order.cs_requested_at || null,
    cs_processed_at: order.cs_processed_at || null,
    cs_completed_at: order.cs_completed_at || null,
    cs_rejected_reason: text(order.cs_rejected_reason),
    cs_withdrawn_at: order.cs_withdrawn_at || null,
    cancel_requested_at: order.cancel_requested_at || null,
    cancel_completed_at: order.cancel_completed_at || null,
    refund_amount: int(order.refund_amount, 0),
    refund_completed_at: order.refund_completed_at || null,
    purchase_confirmed_yn: text(order.purchase_confirmed_yn),
    purchase_confirmed_at: order.purchase_confirmed_at || null,
    display_status: displayStatus(order, items),
    actions: actionsFor(order, normalizedItems),
    items: normalizedItems
  };
  return out;
}

function addFilters(where, values, options){
  const startDate = text(options && options.start_date);
  const endDate = text(options && options.end_date);
  const orderStatus = upper(options && options.order_status);
  const csOnly = ['1','Y','YES','TRUE','CS'].includes(upper(options && (options.cs_only || options.mode)));
  if(startDate){ values.push(startDate); where.push(`o.ordered_at >= $${values.length}::date`); }
  if(endDate){ values.push(endDate); where.push(`o.ordered_at < ($${values.length}::date + INTERVAL '1 day')`); }
  if(orderStatus){
    values.push(orderStatus);
    where.push(`UPPER(COALESCE(o.seller_status,'')) = $${values.length} OR UPPER(COALESCE(o.order_status,'')) = $${values.length} OR UPPER(COALESCE(o.shipping_status,'')) = $${values.length} OR UPPER(COALESCE(o.customer_status,'')) = $${values.length}`);
    where[where.length - 1] = '(' + where[where.length - 1] + ')';
  }
  if(csOnly){
    where.push(`(UPPER(COALESCE(o.customer_status,'')) LIKE 'CANCEL_%' OR UPPER(COALESCE(o.customer_status,'')) LIKE 'EXCHANGE_%' OR UPPER(COALESCE(o.customer_status,'')) LIKE 'RETURN_%' OR UPPER(COALESCE(o.cs_status,'')) NOT IN ('','NONE','N','NULL') OR UPPER(COALESCE(o.cancel_status,'')) NOT IN ('','NONE','N','NULL'))`);
  }
}

async function list(pool, options){
  if(!pool) throw new Error('DB pool is not attached');
  const memberId = text(options && options.member_id);
  if(!memberId) throw new Error('member_id_required');
  const page = Math.max(1, int(options && options.page, 1));
  const limit = Math.min(50, Math.max(1, int(options && options.limit, 20)));
  const offset = (page - 1) * limit;
  const values = [memberId];
  const where = ['o.member_id = $1'];
  addFilters(where, values, options);
  const countSql = `SELECT COUNT(*)::int AS total FROM gm_order o WHERE ${where.join(' AND ')}`;
  const total = (await pool.query(countSql, values)).rows[0].total;
  values.push(limit, offset);
  const orderSql = `
    SELECT o.*
      FROM gm_order o
     WHERE ${where.join(' AND ')}
     ORDER BY COALESCE(o.ordered_at, o.created_at) DESC, o.order_no DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`;
  const orderRows = (await pool.query(orderSql, values)).rows;
  if(!orderRows.length) return { version: VERSION, page, limit, total, total_pages: Math.max(1, Math.ceil(total / limit)), orders: [] };
  const orderNos = orderRows.map((row) => row.order_no);
  const itemRows = (await pool.query(`SELECT * FROM gm_order_item WHERE order_no = ANY($1::text[]) ORDER BY created_at ASC, pi_ii_vi ASC`, [orderNos])).rows;
  const byOrder = new Map();
  itemRows.forEach((item) => { if(!byOrder.has(item.order_no)) byOrder.set(item.order_no, []); byOrder.get(item.order_no).push(item); });
  return { version: VERSION, page, limit, total, total_pages: Math.max(1, Math.ceil(total / limit)), orders: orderRows.map((order) => normalizeOrder(order, byOrder.get(order.order_no) || [])) };
}

async function detail(pool, options){
  if(!pool) throw new Error('DB pool is not attached');
  const memberId = text(options && options.member_id);
  const orderNo = text(options && options.order_no);
  if(!memberId) throw new Error('member_id_required');
  if(!orderNo) throw new Error('order_no_required');
  const orderRows = (await pool.query(`SELECT * FROM gm_order WHERE member_id=$1 AND order_no=$2 LIMIT 1`, [memberId, orderNo])).rows;
  if(!orderRows.length) throw new Error('order_not_found');
  const itemRows = (await pool.query(`SELECT * FROM gm_order_item WHERE order_no=$1 ORDER BY created_at ASC, pi_ii_vi ASC`, [orderNo])).rows;
  return normalizeOrder(orderRows[0], itemRows);
}

function assertAllowed(order, actionName){
  const allowed = order.actions || {};
  if(!Object.prototype.hasOwnProperty.call(allowed, actionName)) throw new Error('unsupported_action');
  if(!allowed[actionName]) throw new Error('action_not_allowed_for_current_status');
}
async function action(pool, options){
  if(!pool) throw new Error('DB pool is not attached');
  const memberId = text(options && options.member_id);
  const orderNo = text(options && options.order_no);
  const actionName = text(options && options.action);
  const reasonCode = text(options && options.reason_code);
  const reasonText = text(options && options.reason_text);
  if(!memberId) throw new Error('member_id_required');
  if(!orderNo) throw new Error('order_no_required');
  if(!actionName) throw new Error('action_required');

  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  const release = client !== pool && typeof client.release === 'function' ? () => client.release() : () => {};
  try{
    await client.query('BEGIN');
    const rows = (await client.query(`SELECT * FROM gm_order WHERE member_id=$1 AND order_no=$2 FOR UPDATE`, [memberId, orderNo])).rows;
    if(!rows.length) throw new Error('order_not_found');
    const itemRows = (await client.query(`SELECT * FROM gm_order_item WHERE order_no=$1 ORDER BY created_at ASC, pi_ii_vi ASC`, [orderNo])).rows;
    const normalized = normalizeOrder(rows[0], itemRows);
    if(normalized.source_type === 'CAFE24') throw new Error('cafe24_action_must_use_cafe24_bridge');
    if(normalized.source_type === 'MIXED') throw new Error('mixed_order_requires_item_selection');
    assertAllowed(normalized, actionName);

    if(actionName === 'shipping_trace'){
      const tracking = normalized.items.find((x) => text(x.tracking_number)) || {};
      await client.query('COMMIT');
      return { action:actionName, order:normalized, carrier_name:text(tracking.carrier_name), tracking_number:text(tracking.tracking_number), tracking_url:'' };
    }

    let sql = '';
    let params = [memberId, orderNo];
    if(actionName === 'direct_cancel'){
      sql = `UPDATE gm_order SET seller_status='CANCELLED', customer_status='CANCEL_COMPLETED', cs_status='CANCEL_COMPLETED', cs_reason_code=$3, cs_reason_text=$4, cs_requested_at=COALESCE(cs_requested_at,NOW()), cs_completed_at=NOW(), cancel_status='COMPLETED', cancel_requested_at=COALESCE(cancel_requested_at,NOW()), cancel_completed_at=NOW(), order_status='CANCELLED', updated_at=NOW() WHERE member_id=$1 AND order_no=$2`;
      params.push(reasonCode, reasonText);
    }else if(actionName === 'cancel_request'){
      sql = `UPDATE gm_order SET customer_status='CANCEL_REQUESTED', cs_status='CANCEL_REQUESTED', cs_reason_code=$3, cs_reason_text=$4, cs_requested_at=NOW(), cs_processed_at=NULL, cs_completed_at=NULL, cs_rejected_reason=NULL, cs_withdrawn_at=NULL, cancel_status='REQUESTED', cancel_requested_at=NOW(), updated_at=NOW() WHERE member_id=$1 AND order_no=$2`;
      params.push(reasonCode, reasonText);
    }else if(actionName === 'exchange_request'){
      sql = `UPDATE gm_order SET customer_status='EXCHANGE_REQUESTED', cs_status='EXCHANGE_REQUESTED', cs_reason_code=$3, cs_reason_text=$4, cs_requested_at=NOW(), cs_processed_at=NULL, cs_completed_at=NULL, cs_rejected_reason=NULL, cs_withdrawn_at=NULL, updated_at=NOW() WHERE member_id=$1 AND order_no=$2`;
      params.push(reasonCode, reasonText);
    }else if(actionName === 'return_request'){
      sql = `UPDATE gm_order SET customer_status='RETURN_REQUESTED', cs_status='RETURN_REQUESTED', cs_reason_code=$3, cs_reason_text=$4, cs_requested_at=NOW(), cs_processed_at=NULL, cs_completed_at=NULL, cs_rejected_reason=NULL, cs_withdrawn_at=NULL, updated_at=NOW() WHERE member_id=$1 AND order_no=$2`;
      params.push(reasonCode, reasonText);
    }else if(actionName === 'cancel_withdraw'){
      sql = `UPDATE gm_order SET customer_status='CANCEL_WITHDRAWN', cs_status='CANCEL_WITHDRAWN', cs_withdrawn_at=NOW(), cancel_status='WITHDRAWN', updated_at=NOW() WHERE member_id=$1 AND order_no=$2`;
    }else if(actionName === 'exchange_withdraw'){
      sql = `UPDATE gm_order SET customer_status='EXCHANGE_WITHDRAWN', cs_status='EXCHANGE_WITHDRAWN', cs_withdrawn_at=NOW(), updated_at=NOW() WHERE member_id=$1 AND order_no=$2`;
    }else if(actionName === 'return_withdraw'){
      sql = `UPDATE gm_order SET customer_status='RETURN_WITHDRAWN', cs_status='RETURN_WITHDRAWN', cs_withdrawn_at=NOW(), updated_at=NOW() WHERE member_id=$1 AND order_no=$2`;
    }else if(actionName === 'purchase_confirm'){
      sql = `UPDATE gm_order SET customer_status='PURCHASE_CONFIRMED', purchase_confirmed_yn='Y', purchase_confirmed_at=NOW(), updated_at=NOW() WHERE member_id=$1 AND order_no=$2`;
    }else{
      throw new Error('unsupported_action');
    }
    await client.query(sql, params);

    /*
     * [AUTO-ORDER CANCEL GUARD]
     * 고객 direct_cancel은 gm_order만 취소하고 끝내면 안 된다.
     * 이미 Runner가 잡은 자동주문 work도 같은 DB 트랜잭션에서 즉시 CANCELLED 처리하고
     * lock을 제거한다. 따라서 취소가 확정된 뒤 Runner가 다음 주문 단계로 진행할 수 없다.
     *
     * Runner 역시 장바구니/주문서/최종 주문 직전에 heartbeat로 gm_order 취소상태를
     * 다시 확인한다. CS 즉시중단 + Runner 직전확인의 이중 방어를 유지한다.
     */
    if(actionName === 'direct_cancel'){
      await client.query(
        `UPDATE gm_auto_order
         SET cancel_status='CANCELLED',
             process_status='CANCELLED',
             order_status=CASE
               WHEN NULLIF(TRIM(COALESCE(mall_order_no,'')),'') IS NULL THEN 'CANCELLED'
               ELSE order_status
             END,
             updated_at=NOW()
         WHERE order_no=$1`,
        [orderNo]
      );
      await client.query(
        `UPDATE gm_auto_order_work w
         SET work_status='CANCELLED',
             lock_token=NULL,
             lock_admin_id=NULL,
             lock_mall_account_id=NULL,
             lock_at=NULL,
             lock_expires_at=NULL,
             error_code='CUSTOMER_CANCELLED',
             error_message='Glomart 주문이 고객에 의해 취소되어 자동주문 작업을 즉시 중단함',
             updated_at=NOW()
         FROM gm_auto_order a
         WHERE a.auto_order_no=w.auto_order_no
           AND a.order_no=$1
           AND UPPER(COALESCE(w.work_status,'')) NOT IN ('COMPLETED','CANCELLED')`,
        [orderNo]
      );
    }

    const updatedRows = (await client.query(`SELECT * FROM gm_order WHERE member_id=$1 AND order_no=$2 LIMIT 1`, [memberId, orderNo])).rows;
    const updated = normalizeOrder(updatedRows[0], itemRows);
    await client.query('COMMIT');
    return { action:actionName, order:updated };
  }catch(error){
    try{ await client.query('ROLLBACK'); }catch(_){}
    throw error;
  }finally{ release(); }
}

module.exports = { VERSION, list, detail, action, normalizeOrder, actionsFor };
