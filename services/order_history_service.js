/* services/order_history_service.js
 * GM_ORDER_HISTORY_SERVICE_V004
 * 주문 생성/저장 로직과 분리된 주문조회 전용 서비스.
 * gm_order / gm_order_item을 읽기만 한다.
 */
'use strict';

const VERSION = 'GM_ORDER_HISTORY_SERVICE_V004';
function text(v){ return String(v == null ? '' : v).trim(); }
function int(v, def){ const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : (def || 0); }
function sourceType(item){
  const source = text(item && (item.source_mall || item.mall_code)).toUpperCase();
  /* Cafe24 내부 주문 collector가 GMKR로 저장한다. 빈 값도 과거 내부 데이터 호환을 위해 내부로 본다. */
  return (!source || source === 'GMKR' || source === 'CAFE24' || source === 'INTERNAL') ? 'CAFE24' : 'EXTERNAL';
}
function displayStatus(order, items){
  const cs = text(order.cs_status || order.cancel_status).toUpperCase();
  if(cs && !['NONE','N','NULL'].includes(cs)) return cs;
  const customer = text(order.customer_status).toUpperCase();
  if(customer === 'PURCHASE_CONFIRMED') return '구매확정';
  const seller = text(order.seller_status).toUpperCase();
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
function normalizeOrder(order, items){
  const normalizedItems = items.map((item) => ({
    order_no: text(item.order_no),
    cafe24_order_no: text(item.cafe24_order_no),
    source_type: sourceType(item),
    source_mall: text(item.source_mall || item.mall_code),
    mall_code: text(item.mall_code),
    pi_ii_vi: text(item.pi_ii_vi),
    product_name: text(item.product_name),
    option_name: text(item.option_name),
    option_value: text(item.option_value),
    quantity: int(item.quantity, 1),
    customer_order_price: int(item.customer_order_price || item.mall_sale_price, 0),
    product_amount: int(item.product_amount, 0),
    delivery_fee: int(item.delivery_fee, 0),
    product_url: text(item.product_url),
    thumb_url: text(item.thumb_file_name),
    carrier_name: text(item.carrier_name),
    tracking_number: text(item.tracking_number),
    item_order_status: text(item.item_order_status),
    item_shipping_status: text(item.item_shipping_status)
  }));
  const first = normalizedItems[0] || {};
  const hasExternal = normalizedItems.some((x) => x.source_type === 'EXTERNAL');
  const hasInternal = normalizedItems.some((x) => x.source_type === 'CAFE24');
  return {
    order_no: text(order.order_no),
    cafe24_order_no: text(order.cafe24_order_no || first.cafe24_order_no),
    order_group_key: text(order.order_group_key || order.cafe24_order_no || order.order_no),
    member_id: text(order.member_id),
    source_type: hasExternal ? 'EXTERNAL' : 'CAFE24',
    source_mix: hasExternal && hasInternal ? 'MIXED' : (hasExternal ? 'EXTERNAL' : 'CAFE24'),
    ordered_at: order.ordered_at || order.created_at || null,
    total_product_price: int(order.total_product_price, 0),
    total_delivery_fee: int(order.total_delivery_fee, 0),
    total_payment_price: int(order.total_payment_price, 0),
    seller_status: text(order.seller_status),
    customer_status: text(order.customer_status),
    order_status: text(order.order_status),
    payment_status: text(order.payment_status),
    shipping_status: text(order.shipping_status),
    cs_status: text(order.cs_status),
    display_status: displayStatus(order, items),
    items: normalizedItems
  };
}
function collectStats(orders){
  const stats={orders:orders.length,items:0,internal_items:0,external_items:0,internal_orders:0,external_orders:0,mixed_orders:0};
  for(const order of orders){
    let hasInternal=false, hasExternal=false;
    for(const item of order.items){
      stats.items++;
      if(item.source_type==='EXTERNAL'){stats.external_items++;hasExternal=true;}
      else{stats.internal_items++;hasInternal=true;}
    }
    if(hasInternal&&hasExternal)stats.mixed_orders++;
    else if(hasExternal)stats.external_orders++;
    else stats.internal_orders++;
  }
  return stats;
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
  const startDate = text(options && options.start_date);
  const endDate = text(options && options.end_date);
  if(startDate){ values.push(startDate); where.push(`COALESCE(o.ordered_at,o.created_at) >= $${values.length}::date`); }
  if(endDate){ values.push(endDate); where.push(`COALESCE(o.ordered_at,o.created_at) < ($${values.length}::date + INTERVAL '1 day')`); }

  const countSql = `SELECT COUNT(*)::int AS total FROM gm_order o WHERE ${where.join(' AND ')}`;
  const countResult = await pool.query(countSql, values);
  const total = int(countResult.rows[0] && countResult.rows[0].total, 0);

  const pageValues = values.slice();
  pageValues.push(limit, offset);
  const orderSql = `
    SELECT o.*
      FROM gm_order o
     WHERE ${where.join(' AND ')}
     ORDER BY COALESCE(o.ordered_at, o.created_at) DESC, o.order_no DESC
     LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`;
  const orderRows = (await pool.query(orderSql, pageValues)).rows;

  if(!orderRows.length){
    const stats={orders:0,items:0,internal_items:0,external_items:0,internal_orders:0,external_orders:0,mixed_orders:0};
    console.log('['+VERSION+'] QUERY',JSON.stringify({member_id:memberId,total,page,returned_orders:0,stats}));
    return { version:VERSION, page, limit, total, total_pages:Math.max(1,Math.ceil(total/limit)), stats, orders:[] };
  }

  const orderNos = orderRows.map((row) => text(row.order_no)).filter(Boolean);
  const itemRows = (await pool.query(
    `SELECT * FROM gm_order_item WHERE order_no = ANY($1::text[]) ORDER BY order_no ASC, created_at ASC, pi_ii_vi ASC`,
    [orderNos]
  )).rows;
  const byOrder = new Map();
  for(const item of itemRows){
    const key=text(item.order_no);
    if(!byOrder.has(key)) byOrder.set(key, []);
    byOrder.get(key).push(item);
  }
  const orders=orderRows.map((order) => normalizeOrder(order, byOrder.get(text(order.order_no)) || []));
  const stats=collectStats(orders);
  console.log('['+VERSION+'] QUERY',JSON.stringify({member_id:memberId,total,page,returned_orders:orders.length,raw_items:itemRows.length,stats}));
  return {
    version: VERSION,
    page,
    limit,
    total,
    total_pages: Math.max(1, Math.ceil(total / limit)),
    stats,
    orders
  };
}
module.exports = { VERSION, list };
