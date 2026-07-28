/* services/order_history_service.js
 * GM_ORDER_HISTORY_SERVICE_V003
 * 주문 생성/저장 로직과 분리된 주문조회 전용 서비스.
 * 이 파일은 gm_order / gm_order_item을 읽기만 하며 주문 저장 흐름을 수정하지 않는다.
 */
'use strict';

const VERSION = 'GM_ORDER_HISTORY_SERVICE_V003';

function text(v){ return String(v == null ? '' : v).trim(); }
function int(v, def){ const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : (def || 0); }
function sourceType(item){
  const source = text(item && (item.source_mall || item.mall_code)).toUpperCase();
  return source === 'GMKR' || source === 'CAFE24' ? 'CAFE24' : 'EXTERNAL';
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
  const source = normalizedItems.some((x) => x.source_type === 'EXTERNAL') ? 'EXTERNAL' : 'CAFE24';
  return {
    order_no: text(order.order_no),
    cafe24_order_no: text(order.cafe24_order_no || first.cafe24_order_no),
    order_group_key: text(order.order_group_key || order.cafe24_order_no || order.order_no),
    member_id: text(order.member_id),
    source_type: source,
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
  if(startDate){ values.push(startDate); where.push(`o.ordered_at >= $${values.length}::date`); }
  if(endDate){ values.push(endDate); where.push(`o.ordered_at < ($${values.length}::date + INTERVAL '1 day')`); }
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
  const itemRows = (await pool.query(
    `SELECT * FROM gm_order_item WHERE order_no = ANY($1::text[]) ORDER BY created_at ASC, pi_ii_vi ASC`,
    [orderNos]
  )).rows;
  const byOrder = new Map();
  itemRows.forEach((item) => {
    if(!byOrder.has(item.order_no)) byOrder.set(item.order_no, []);
    byOrder.get(item.order_no).push(item);
  });
  return {
    version: VERSION,
    page,
    limit,
    total,
    total_pages: Math.max(1, Math.ceil(total / limit)),
    orders: orderRows.map((order) => normalizeOrder(order, byOrder.get(order.order_no) || []))
  };
}

module.exports = { VERSION, list };
