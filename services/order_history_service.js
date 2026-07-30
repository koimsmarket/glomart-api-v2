/* services/order_history_service.js
 * GM_ORDER_HISTORY_SERVICE_V005
 * 주문조회 전용 서비스. 생성/결제 흐름은 수정하지 않는다.
 */
'use strict';

const VERSION='GM_ORDER_HISTORY_SERVICE_V010';
function text(v){return String(v==null?'':v).trim();}
function int(v,def){const n=Number(v);return Number.isFinite(n)?Math.trunc(n):(def||0);}
function sourceType(item){const source=text(item&&(item.source_mall||item.mall_code)).toUpperCase();return source==='GMKR'||source==='CAFE24'?'CAFE24':'EXTERNAL';}
function sellerStatus(order,items){
  const direct=text(order.seller_status).toUpperCase(); if(direct)return direct;
  const shipping=text(order.shipping_status||(items[0]&&items[0].item_shipping_status)).toUpperCase();
  if(['SHIPPING','IN_TRANSIT','SHIPPED','DISPATCHED'].includes(shipping))return 'SHIPPING';
  if(['DELIVERED','COMPLETED','COMPLETE'].includes(shipping))return 'DELIVERED';
  if(['PREPARING','READY','READY_TO_SHIP'].includes(shipping))return 'PREPARING';
  const status=text(order.order_status).toUpperCase();
  if(['CANCELLED','CANCELED'].includes(status))return 'CANCELLED';
  if(['ORDERED','ACCEPTED','PAID','ORDER_COMPLETE'].includes(status))return 'ORDERED';
  return 'READY_TO_ORDER';
}
function customerStatus(order){
  const raw=text(order.customer_status).toUpperCase();
  const c=(!raw||['N','NONE','NULL','FALSE','0'].includes(raw))?'NONE':raw;
  if(c!=='NONE')return c;
  const csRaw=text(order.cs_status).toUpperCase();
  const cs=(!csRaw||['N','NONE','NULL','FALSE','0'].includes(csRaw))?'NONE':csRaw;
  if(cs!=='NONE')return cs;
  const cancel=text(order.cancel_status).toUpperCase();
  if(['REQUESTED','REQUEST','PENDING'].includes(cancel))return 'CANCEL_REQUESTED';
  if(cancel==='PROCESSING')return 'CANCEL_PROCESSING';
  if(['COMPLETED','COMPLETE','CANCELLED','CANCELED','DONE'].includes(cancel))return 'CANCEL_COMPLETED';
  if(text(order.purchase_confirmed_yn).toUpperCase()==='Y')return 'PURCHASE_CONFIRMED';
  return 'NONE';
}
function actionFlags(order,items){
  const s=sellerStatus(order,items), c=customerStatus(order);
  const activeCs=/_(REQUESTED|PROCESSING)$/.test(c);
  const normalCs=(c==='NONE'||/_(WITHDRAWN|REJECTED)$/.test(c));
  return {
    detail:true,
    direct_cancel:!activeCs && normalCs && ['READY_TO_ORDER','ORDERED'].includes(s),
    cancel_request:!activeCs && normalCs && s==='PREPARING',
    cancel_withdraw:c==='CANCEL_REQUESTED',
    exchange_request:!activeCs && normalCs && s==='DELIVERED',
    exchange_withdraw:c==='EXCHANGE_REQUESTED',
    return_request:!activeCs && normalCs && s==='DELIVERED',
    return_withdraw:c==='RETURN_REQUESTED',
    shipping_trace:['SHIPPING','DELIVERED'].includes(s) && items.some(x=>text(x.tracking_number)),
    purchase_confirm:!activeCs && normalCs && s==='DELIVERED'
  };
}
function displayStatus(order,items){
  const c=customerStatus(order);
  const csMap={CANCEL_REQUESTED:'취소신청',CANCEL_PROCESSING:'취소처리중',CANCEL_COMPLETED:'취소완료',CANCEL_REJECTED:'취소거절',EXCHANGE_REQUESTED:'교환신청',EXCHANGE_PROCESSING:'교환처리중',EXCHANGE_COMPLETED:'교환완료',RETURN_REQUESTED:'반품신청',RETURN_PROCESSING:'반품처리중',RETURN_COMPLETED:'반품완료',PURCHASE_CONFIRMED:'구매확정'};
  if(csMap[c])return csMap[c];
  const s=sellerStatus(order,items);return {READY_TO_ORDER:'주문대기',ORDERED:'주문완료',PREPARING:'상품준비중',SHIPPING:'배송중',DELIVERED:'배송완료',CANCELLED:'주문취소'}[s]||s||'주문완료';
}
function normalizeOrder(order,items){
  const normalizedItems=items.map(item=>({
    order_no:text(item.order_no),cafe24_order_no:text(item.cafe24_order_no),source_type:sourceType(item),source_mall:text(item.source_mall||item.mall_code),mall_code:text(item.mall_code),
    product_name:text(item.product_name),option_name:text(item.option_name),option_value:text(item.option_value),quantity:int(item.quantity,1),
    mall_sale_price:int(item.mall_sale_price,0),customer_order_price:int(item.customer_order_price||item.mall_sale_price,0),final_supply_price:item.final_supply_price==null?null:int(item.final_supply_price,0),product_amount:int(item.product_amount,0),
    delivery_type:text(item.delivery_type),delivery_fee:int(item.delivery_fee,0),extra_area_delivery_fee:int(item.extra_area_delivery_fee,0),
    product_url:text(item.product_url),thumb_url:text(item.thumb_url||item.thumb_file_name),carrier_name:text(item.carrier_name),tracking_number:text(item.tracking_number),
    shipping_started_at:item.shipping_started_at||null,shipping_completed_at:item.shipping_completed_at||null,item_order_status:text(item.item_order_status),item_shipping_status:text(item.item_shipping_status),
    pi_ii_vi:text(item.pi_ii_vi),source_uid:text(item.source_uid),internal_product_code:text(item.internal_product_code),cafe24_product_no:text(item.cafe24_product_no),
    hs_code:text(item.hs_code),origin_country:text(item.origin_country),supplier_id:text(item.supplier_id),supplier_name:text(item.supplier_name)
  }));
  const first=normalizedItems[0]||{};
  const hasExternal=normalizedItems.some(x=>x.source_type==='EXTERNAL');
  const hasCafe24=normalizedItems.some(x=>x.source_type==='CAFE24');
  const source=hasExternal&&hasCafe24?'MIXED':(hasExternal?'EXTERNAL':'CAFE24');
  const s=sellerStatus(order,normalizedItems),c=customerStatus(order);
  return {
    order_no:text(order.order_no),cafe24_order_no:text(order.cafe24_order_no||first.cafe24_order_no),member_id:text(order.member_id),source_type:source,
    ordered_at:order.ordered_at||order.created_at||null,created_at:order.created_at||null,updated_at:order.updated_at||null,
    orderer_name:text(order.orderer_name),orderer_phone:text(order.orderer_phone),orderer_mobile:text(order.orderer_mobile),orderer_email:text(order.orderer_email),
    receiver_name:text(order.receiver_name),receiver_phone:text(order.receiver_phone),receiver_mobile:text(order.receiver_mobile),receiver_safe_phone:text(order.receiver_safe_phone),receiver_zipcode:text(order.receiver_zipcode),
    receiver_address1:text(order.receiver_address1),receiver_address2:text(order.receiver_address2),receiver_address_old:text(order.receiver_address_old),receiver_address_full:text(order.receiver_address_full),
    receiver_sido:text(order.receiver_sido),receiver_sigungu:text(order.receiver_sigungu),receiver_eup_myeon_dong:text(order.receiver_eup_myeon_dong),delivery_memo:text(order.delivery_memo),
    customs_required_yn:text(order.customs_required_yn),customs_clearance_code:text(order.customs_clearance_code),customs_name:text(order.customs_name),customs_mobile:text(order.customs_mobile),
    payment_method:text(order.payment_method),payment_method_display:text(order.payment_method_display),payment_bank_name:text(order.payment_bank_name),payment_account_number:text(order.payment_account_number),
    depositor_name:text(order.depositor_name),depositor_phone:text(order.depositor_phone),expected_payment_amount:int(order.expected_payment_amount,0),actual_payment_amount:int(order.actual_payment_amount,0),payment_difference_amount:int(order.payment_difference_amount,0),
    total_product_price:int(order.total_product_price,0),total_delivery_fee:int(order.total_delivery_fee,0),extra_area_delivery_fee:int(order.extra_area_delivery_fee,0),estimated_customs_fee:int(order.estimated_customs_fee,0),estimated_import_vat:int(order.estimated_import_vat,0),total_payment_price:int(order.total_payment_price,0),
    seller_status:s,customer_status:c,order_status:text(order.order_status),payment_status:text(order.payment_status),shipping_status:text(order.shipping_status),delivered_at:order.delivered_at||null,
    cs_status:text(order.cs_status),cancel_status:text(order.cancel_status),cancel_requested_at:order.cancel_requested_at||null,cancel_completed_at:order.cancel_completed_at||null,
    cs_reason_code:text(order.cs_reason_code),cs_reason_text:text(order.cs_reason_text),cs_requested_at:order.cs_requested_at||null,cs_processed_at:order.cs_processed_at||null,cs_completed_at:order.cs_completed_at||null,cs_rejected_reason:text(order.cs_rejected_reason),cs_withdrawn_at:order.cs_withdrawn_at||null,refund_amount:order.refund_amount==null?null:int(order.refund_amount,0),refund_completed_at:order.refund_completed_at||null,admin_memo:text(order.admin_memo),purchase_confirmed_yn:text(order.purchase_confirmed_yn),purchase_confirmed_at:order.purchase_confirmed_at||null,
    display_status:displayStatus(order,normalizedItems),actions:actionFlags(order,normalizedItems),item_count:normalizedItems.length,items:normalizedItems
  };
}
async function rowsFor(pool,orderRows){
  if(!orderRows.length)return [];
  const orderNos=orderRows.map(r=>r.order_no);
  const items=(await pool.query('SELECT * FROM gm_order_item WHERE order_no = ANY($1::text[]) ORDER BY created_at ASC, pi_ii_vi ASC',[orderNos])).rows;
  const by=new Map();items.forEach(i=>{if(!by.has(i.order_no))by.set(i.order_no,[]);by.get(i.order_no).push(i);});
  return orderRows.map(o=>normalizeOrder(o,by.get(o.order_no)||[]));
}
async function list(pool,options){
  if(!pool)throw new Error('DB pool is not attached');const memberId=text(options&&options.member_id);if(!memberId)throw new Error('member_id_required');
  const page=Math.max(1,int(options&&options.page,1)),limit=Math.min(50,Math.max(1,int(options&&options.limit,20))),offset=(page-1)*limit;
  const values=[memberId],where=['o.member_id = $1'];const start=text(options&&options.start_date),end=text(options&&options.end_date),status=text(options&&options.order_status).toUpperCase();
  if(start){values.push(start);where.push(`COALESCE(o.ordered_at,o.created_at) >= $${values.length}::date`);}if(end){values.push(end);where.push(`COALESCE(o.ordered_at,o.created_at) < ($${values.length}::date + INTERVAL '1 day')`);}
  if(status){values.push(status);where.push(`UPPER(COALESCE(o.order_status,'')) = $${values.length}`);}
  const total=(await pool.query(`SELECT COUNT(*)::int AS total FROM gm_order o WHERE ${where.join(' AND ')}`,values)).rows[0].total;
  values.push(limit,offset);const orderRows=(await pool.query(`SELECT o.* FROM gm_order o WHERE ${where.join(' AND ')} ORDER BY COALESCE(o.ordered_at,o.created_at) DESC,o.order_no DESC LIMIT $${values.length-1} OFFSET $${values.length}`,values)).rows;
  return {version:VERSION,page,limit,total,total_pages:Math.max(1,Math.ceil(total/limit)),orders:await rowsFor(pool,orderRows)};
}
async function detail(pool,options){
  if(!pool)throw new Error('DB pool is not attached');const memberId=text(options&&options.member_id),orderNo=text(options&&options.order_no);if(!memberId)throw new Error('member_id_required');if(!orderNo)throw new Error('order_no_required');
  const rows=(await pool.query('SELECT * FROM gm_order WHERE member_id=$1 AND order_no=$2 LIMIT 1',[memberId,orderNo])).rows;if(!rows.length)throw new Error('order_not_found');return (await rowsFor(pool,rows))[0];
}
module.exports={VERSION,list,detail,actionFlags,sellerStatus,customerStatus};
