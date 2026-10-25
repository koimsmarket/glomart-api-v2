/* services/order_history_service.js
 * GM_ORDER_HISTORY_SERVICE_V008_PAID_ONLY_REFUND
 * 주문 생성/저장 로직과 분리된 주문조회 + 외부주문 CS 상태 서비스.
 * Cafe24 내부주문의 실제 CS 처리는 Cafe24 원본 액션 브리지에 맡긴다.
 */
'use strict';

const refundBank=require('./GM_ORDER_REFUND_BANK');
const refundDeposit=require('./GM_ORDER_REFUND_DEPOSIT');
const orderMessageEvent=require('./order_message_event_service');
const cancelShipping=require('./GM_ORDER_CANCEL_SHIPPING');

const VERSION = 'GM_ORDER_HISTORY_SERVICE_V009_ORDER_EVENT_MESSAGE';

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
  const confirmed=upper(order.purchase_confirmed_yn)==='Y'||Boolean(order.purchase_confirmed_at)||customer==='PURCHASE_CONFIRMED';
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
  actions.cancel_request = ['PREPARING','SHIPPING','SHIPPED','IN_TRANSIT'].includes(seller);
  actions.exchange_request = !confirmed && seller === 'DELIVERED';
  actions.return_request = !confirmed && ['SHIPPING','SHIPPED','IN_TRANSIT','DELIVERED'].includes(seller);
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
    pi_ii_vi: text(item.pi_ii_vi),
    shipping_completed_at: item.shipping_completed_at || null,
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
    refund_method: text(order.refund_method),
    refund_status: text(order.refund_status || 'NONE'),
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
  const out=normalizeOrder(orderRows[0], itemRows);
  const member=(await pool.query(
    `SELECT refund_bank_name,refund_account_no,refund_account_holder
       FROM gm_member WHERE member_id=$1 LIMIT 1`,
    [memberId]
  )).rows[0] || {};
  // Refund account is member master data only; never copied into gm_order.
  out.refund_account={
    bank_name:text(member.refund_bank_name),
    account_no:text(member.refund_account_no),
    account_holder:text(member.refund_account_holder)
  };
  const depositUse=(await pool.query(
    `SELECT COALESCE(withdraw_amount,0)::bigint AS used
       FROM gm_deposit_transaction
      WHERE order_no=$1 AND member_id=$2 AND transaction_type='ORDER_USE'
      ORDER BY transaction_id ASC LIMIT 1`,
    [orderNo,memberId]
  )).rows[0];
  out.deposit_used_amount=Math.max(0,int(depositUse&&depositUse.used,0));
  return out;
}

// Existing gm_order_item primary key (order_no, pi_ii_vi): no additional table.
function selectCsItems(order, rows, requested){
  if(!Array.isArray(requested)||!requested.length||requested.length>rows.length)throw new Error('cs_selection_required');
  const byKey=new Map(rows.map(i=>[text(i.pi_ii_vi),i]));
  const seen=new Set(),selected=[];
  for(const v of requested){
    const key=text(v&&v.pi_ii_vi),qty=Number(v&&v.quantity),i=byKey.get(key);
    if(!key||seen.has(key)||!i||!Number.isSafeInteger(qty)||qty<1||qty>int(i.quantity,0))throw new Error('cs_selection_invalid');
    seen.add(key);selected.push({item:i,quantity:qty});
  }
  return selected;
}
// Fresh food: complaint intake is distinct from approval, collection, disposal or refund.
// Seller-specified deadline is consulted only if it is actually present in the order snapshot.
function freshComplaintReview(order,selected,reasonCode){
  const fresh=selected.filter(x=>upper(x.item.delivery_type||x.item.shipping_type).includes('FRESH'));
  if(!fresh.length)return [];
  // Pure buyer remorse / subjective dissatisfaction is not automatically eligible for a fresh-food claim.
  if(!['B','J','F','K'].includes(upper(reasonCode)))throw new Error('fresh_cs_reason_manual_inquiry_required');
  const now=Date.now(),review=[];
  for(const x of fresh){
    const item=x.item;
    const deadline=item.fresh_cs_deadline_at||item.fresh_return_deadline_at||item.cs_deadline_at||null;
    if(deadline){
      const ts=new Date(deadline).getTime();
      if(!Number.isFinite(ts))throw new Error('fresh_cs_deadline_invalid');
      if(now>ts)throw new Error('cs_request_deadline_passed');
      review.push({item:text(item.pi_ii_vi),status:'FRESH_CLAIM_REVIEW',deadline_status:'IN_DEADLINE'});
    }else{
      review.push({item:text(item.pi_ii_vi),status:'FRESH_CLAIM_REVIEW',deadline_status:'UNVERIFIED'});
    }
  }
  return review;
}
function verifyCsDeadline(order,selected,reasonCode){
  if(upper(order.purchase_confirmed_yn)==='Y'||order.purchase_confirmed_at||upper(order.customer_status)==='PURCHASE_CONFIRMED')throw new Error('purchase_already_confirmed');
  const reviews=freshComplaintReview(order,selected,reasonCode),now=Date.now();
  for(const x of selected){
    const i=x.item,type=upper(i.delivery_type||i.shipping_type);
    if(type.includes('FRESH'))continue;
    const delivered=i.shipping_completed_at||order.delivered_at;
    if(!delivered||!Number.isFinite(new Date(delivered).getTime()))throw new Error('delivery_time_unverified');
    if(now>new Date(delivered).getTime()+7*24*60*60*1000)throw new Error('cs_request_deadline_passed');
  }
  return reviews;
}
function csSelectionSummary(selected,reasonText){
  const lines=selected.map(x=>text(x.item.pi_ii_vi)+':'+x.quantity);
  // Persist selection in existing gm_order.cs_reason_text, without a schema migration.
  return [text(reasonText),'[GM_CS_SELECTED_ITEMS_V001] '+JSON.stringify(lines)].filter(Boolean).join('\n');
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
  const requestedAction = text(options && options.action);
  let actionName = requestedAction; // V002: distinguish confirmed pre-dispatch cancellation from manual requests.
  const reasonCode = text(options && options.reason_code);
  let reasonText = text(options && options.reason_text);
  const refundMethod = upper(options && options.refund_method);
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
    // GM_AUTO_ORDER_CANCEL_V002: gm_order row is already locked; order-row locking is
    // the serialization point for CS cancellation and final pre-payment validation.
    // Only unclaimed/queued jobs and demonstrably unplaced orders qualify for
    // immediate cancellation. Active, unknown or already placed orders NEVER do.
    let preDispatchDecision='NOT_APPLICABLE';
    if(requestedAction==='direct_cancel'){
      const ao=(await client.query(`SELECT auto_order_no,order_status,process_status,mall_order_no
        FROM gm_auto_order WHERE order_no=$1 ORDER BY auto_order_no FOR UPDATE`,[orderNo])).rows;
      const autoNos=ao.map(x=>x.auto_order_no);
      const workRows=autoNos.length?(await client.query(`SELECT work_id,work_status
        FROM gm_auto_order_work WHERE auto_order_no = ANY($1) ORDER BY work_id FOR UPDATE`,[autoNos])).rows:[];
      const outbound=ao.some(x=>text(x.mall_order_no)||['ORDERED','COMPLETED'].includes(upper(x.order_status)) || upper(x.process_status)==='COMPLETED');
      // RUNNING and PAYMENT_WAITING may represent a submitted order with delayed reporting.
      const uncertain=ao.some(x=>!['','WAIT_PAYMENT','READY','PENDING','CANCELLED'].includes(upper(x.process_status)) || !['','NOT_ORDERED','CANCELLED'].includes(upper(x.order_status))) || workRows.some(x=>['RUNNING','PAYMENT_WAITING','COMPLETED'].includes(upper(x.work_status)));
      const unsafeSeller=!['READY_TO_ORDER','ORDERED'].includes(upper(rows[0].seller_status||'READY_TO_ORDER')) || (!ao.length && upper(rows[0].seller_status)==='ORDERED');
      if(outbound||uncertain||unsafeSeller){
        actionName='cancel_request';
        preDispatchDecision=outbound?'MALL_ORDER_EXISTS':uncertain?'RUNNER_OR_PAYMENT_UNCERTAIN':'SELLER_STATUS_UNCERTAIN';
      }else{
        actionName='direct_cancel';
        preDispatchDecision='CONFIRMED_NOT_DISPATCHED';
      }
      console.log('[GM_PRE_DISPATCH_CANCEL_DECISION_V002]',JSON.stringify({order_no:orderNo,decision:preDispatchDecision,auto_orders:ao.length,works:workRows.length}));
    }
    if(requestedAction==='direct_cancel') assertAllowed(normalized,'direct_cancel');
    else assertAllowed(normalized,actionName);
    let selectedItems=null;
    if(['exchange_request','return_request'].includes(actionName)){
      selectedItems=selectCsItems(rows[0],itemRows,options.selected_items);
      const freshReviews=verifyCsDeadline(rows[0],selectedItems,reasonCode);
      reasonText=csSelectionSummary(selectedItems,reasonText);
      if(freshReviews.length){
        reasonText+='\n[GM_FRESH_CLAIM_REVIEW_V001] '+JSON.stringify(freshReviews);
        console.log('[GM_FRESH_CLAIM_INTAKE]',JSON.stringify({order_no:orderNo,action:actionName,review:freshReviews}));
      }
    }
    if(['cancel_request','exchange_request','return_request'].includes(actionName)){
      if(options.shipping_fee_ack!==true) throw new Error('shipping_fee_confirmation_required');
      const q=cancelShipping.quote(rows[0],selectedItems?selectedItems.map(x=>x.item):itemRows,reasonCode);
      if(q.manual_shipping_review){
        console.warn('[GM_CS_SHIPPING_REVIEW_REQUIRED]', JSON.stringify({order_no:orderNo,action:actionName,reason_code:reasonCode}));
        throw new Error('shipping_status_manual_review_required');
      }
      console.log('[GM_CS_SHIPPING_VERIFIED]', JSON.stringify({order_no:orderNo,action:actionName,fee:q.customer_shipping_fee,groups:q.groups.map(g=>({key:g.key,shipped:g.shipped,fee:g.customer_shipping_fee}))}));
      if(!Number.isSafeInteger(Number(options.shipping_fee_confirmed)) || Number(options.shipping_fee_confirmed)!==q.customer_shipping_fee) throw new Error('shipping_quote_changed');
      if(selectedItems){
        const fingerprint=cancelShipping.quoteFingerprint(orderNo,actionName,reasonCode,selectedItems.map(x=>({pi_ii_vi:x.item.pi_ii_vi,quantity:x.quantity})),q);
        if(text(options.quote_fingerprint)!==fingerprint || !Number.isSafeInteger(Number(options.seller_shipping_fee_confirmed)) || Number(options.seller_shipping_fee_confirmed)!==q.seller_shipping_fee){
          throw new Error('shipping_quote_changed');
        }
      }
      console.log('[GM_CS_QUOTE_CONFIRMED]',JSON.stringify({order_no:orderNo,action:actionName,reason_code:reasonCode,shipping_fee:q.customer_shipping_fee,groups:q.groups.map(g=>({key:g.key,fee:g.customer_shipping_fee,shipped:g.shipped}))}));
    }

    if(actionName === 'shipping_trace'){
      const tracking = normalized.items.find((x) => text(x.tracking_number)) || {};
      await client.query('COMMIT');
      return { action:actionName, order:normalized, carrier_name:text(tracking.carrier_name), tracking_number:text(tracking.tracking_number), tracking_url:'' };
    }

    let refundResult=null;
    let refundAmount=0;
    let paidForRefund=false;
    if(actionName === 'direct_cancel'){
      const payStatus=upper(rows[0].payment_status);
      const completedPayment=['PAID','OVERPAID','PAYMENT_COMPLETE','PAYMENT_COMPLETED','COMPLETED','COMPLETE','DONE','SUCCESS','SETTLED'].includes(payStatus);
      const actualPaid=Math.max(0,int(rows[0].actual_payment_amount,0));

      // 예치금 사용액도 실제 결제된 금액이다.
      // 취소 시 자동으로 예치금에 복원하지 않고, 현금 입금액과 합산하여
      // 사용자가 선택한 기존 환불방법(BANK / DEPOSIT)으로 처리한다.
      const useRow=(await client.query(
        `SELECT COALESCE(withdraw_amount,0)::bigint AS used
           FROM gm_deposit_transaction
          WHERE order_no=$1 AND member_id=$2 AND transaction_type='ORDER_USE'
          ORDER BY transaction_id ASC LIMIT 1`,
        [orderNo,memberId]
      )).rows[0];
      const depositUsed=Math.max(0,int(useRow&&useRow.used,0));

      refundAmount=actualPaid+depositUsed;
      // 과거 결제완료 데이터에 actual_payment_amount가 없고 예치금 사용도 없는 경우만 기존 fallback 유지.
      if(refundAmount<=0 && completedPayment){
        refundAmount=Math.max(
          int(rows[0].expected_payment_amount,0),
          int(rows[0].total_payment_price,0)
        );
      }
      paidForRefund=refundAmount>0;
      if(paidForRefund && !['BANK','DEPOSIT'].includes(refundMethod)) throw new Error('refund_method_required');
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
     * [PAID-ONLY REFUND GUARD]
     * 실제 결제액(현금입금 + ORDER_USE)이 0원인 주문만 취소만 한다.
     * 부분결제라도 실제 결제액이 있으면 사용자가 선택한 환불방법으로 환불한다.
     */
    if(actionName === 'direct_cancel' && !paidForRefund){
      await client.query(
        `UPDATE gm_order
            SET refund_method=NULL,
                refund_status='NONE',
                refund_amount=0,
                refund_completed_at=NULL,
                updated_at=NOW()
          WHERE member_id=$1 AND order_no=$2`,
        [memberId,orderNo]
      );
    }

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

    // V002: A cancellation request is already authoritative for stopping
    // uncompleted Runner operations, even when refund/CS completion is pending.
    // Do not touch completed jobs or claim a placed Coupang order was cancelled.
    if(actionName==='cancel_request'){
      await client.query(`UPDATE gm_auto_order_work w SET
          work_status='CANCELLED', lock_token=NULL,lock_admin_id=NULL,
          lock_mall_account_id=NULL,lock_at=NULL,lock_expires_at=NULL,
          error_code='CUSTOMER_CANCEL_HOLD',
          error_message='CS 취소 접수: 재발주 금지, 관리자 결제/발주 확인 필요',updated_at=NOW()
        FROM gm_auto_order a WHERE w.auto_order_no=a.auto_order_no AND a.order_no=$1
        AND UPPER(COALESCE(w.work_status,'')) NOT IN ('COMPLETED','CANCELLED')`,[orderNo]);
      console.warn('[GM_PRE_DISPATCH_CANCEL_HOLD_V002]',JSON.stringify({order_no:orderNo,reason:preDispatchDecision}));
    }

    /*
     * [CANCEL REFUND ROUTING]
     * BANK: validate gm_member.refund_* and leave refund_status=PENDING.
     *       No fake gm_bank_transaction OUT row is created.
     * DEPOSIT: update gm_deposit_balance + gm_deposit_transaction in this
     *          same DB transaction and mark refund completed.
     */
    if(actionName === 'direct_cancel' && refundAmount>0){
      if(refundMethod === 'BANK'){
        refundResult=await refundBank.prepare(client,{member_id:memberId,order_no:orderNo,amount:refundAmount});
      }else if(refundMethod === 'DEPOSIT'){
        refundResult=await refundDeposit.apply(client,{member_id:memberId,order_no:orderNo,amount:refundAmount});
      }
    }

    // Preserve every application round (including zero-photo applications) in one existing order row.
    let csPhotoRound=null;
    if(actionName==='return_request'||actionName==='exchange_request'){
      const col=actionName==='return_request'?'return_image_history':'exchange_image_history';
      const previous=String(rows[0][col]||'');
      const rounds=previous?previous.split('|'):[];
      if(rounds.some((x,i)=>!new RegExp('^'+(i+1)+':[0-6]$').test(x)))throw new Error('cs_photo_history_invalid');
      csPhotoRound=rounds.length+1;
      // Two-digit file slots allow 01..06, 11..16 ... 91..96; from round 11 slots become 101..106.
      if(csPhotoRound>10000)throw new Error('cs_photo_round_limit');
      const next=previous?previous+'|'+csPhotoRound+':0':csPhotoRound+':0';
      await client.query('UPDATE gm_order SET '+col+'=$3 WHERE member_id=$1 AND order_no=$2',[memberId,orderNo,next]);
      console.log('[GM_CS_PHOTO_ROUND_RESERVED]',JSON.stringify({order_no:orderNo,action:actionName,round:csPhotoRound}));
    }
    const updatedRows = (await client.query(`SELECT * FROM gm_order WHERE member_id=$1 AND order_no=$2 LIMIT 1`, [memberId, orderNo])).rows;
    const updated = normalizeOrder(updatedRows[0], itemRows);

    /* [ORDER EVENT MESSAGE]
     * 고객의 상태변경이 DB에 성공한 경우에만 주문 알림함에 1건을 추가한다.
     * 메시지 저장 실패는 취소/반품/교환 자체를 롤백시키지 않는다.
     */
    const messageTypeMap={
      direct_cancel:'CANCEL_COMPLETED',
      cancel_request:'CANCEL_REQUESTED',
      return_request:'RETURN_REQUESTED',
      exchange_request:'EXCHANGE_REQUESTED'
    };
    let messageEvent=null, messageEventError='';
    const messageType=messageTypeMap[actionName]||'';
    if(messageType){
      try{
        const mr=await orderMessageEvent.create(client,{order:updatedRows[0],message_type:messageType});
        messageEvent=mr&&mr.item||null;
      }catch(messageError){
        messageEventError=String(messageError&&messageError.message||messageError);
        try{console.error('[GM_ORDER_EVENT_MESSAGE_FAIL]',JSON.stringify({order_no:orderNo,action:actionName,message_type:messageType,error:messageEventError}));}catch(_log){}
      }
    }

    await client.query('COMMIT');
    return { action:actionName, pre_dispatch_decision:preDispatchDecision, order:updated, refund:refundResult, message_event:messageEvent, message_event_error:messageEventError, photo_round:csPhotoRound };
  }catch(error){
    try{ await client.query('ROLLBACK'); }catch(_){}
    throw error;
  }finally{ release(); }
}

function selectCsItemsForQuote(order,rows,selection,reasonCode){
  const chosen=selectCsItems(order,rows,selection);
  verifyCsDeadline(order,chosen,reasonCode);
  return chosen.map(x=>x.item);
}
module.exports = { VERSION, list, detail, action, normalizeOrder, actionsFor, selectCsItemsForQuote };
