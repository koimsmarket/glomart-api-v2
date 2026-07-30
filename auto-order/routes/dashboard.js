'use strict';

const express = require('express');
const router = express.Router();

/*
 * GM_AUTO_ORDER_DASHBOARD_API_V001
 *
 * Glomart 외부상품 운영센터 대시보드 전용 조회 API.
 *
 * 원칙
 * - 쿠팡/알리에 직접 접속하지 않는다.
 * - Glomart PostgreSQL의 주문/주문상품 상태만 집계한다.
 * - 현재 운영 DB의 컬럼 차이로 대시보드 전체가 죽지 않도록
 *   information_schema를 확인한 뒤 존재하는 컬럼만 사용한다.
 * - 자동주문 실행기/Job의 실제 서버 Queue 연동 전까지 clients는 빈 목록을 반환한다.
 */

function clean(v){
  return v === undefined || v === null ? '' : String(v).trim();
}
function qIdent(v){
  return '"' + String(v).replace(/"/g, '""') + '"';
}
function up(v){
  return String(v || '').toUpperCase();
}
function num(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function tableExists(pool, table){
  const r = await pool.query(`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name=$1
    LIMIT 1
  `, [table]);
  return r.rows.length > 0;
}

async function columnNames(pool, table){
  const r = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1
    ORDER BY ordinal_position
  `, [table]);
  return r.rows.map(x => x.column_name);
}

function firstCol(cols, names){
  for(const n of names){
    if(cols.includes(n)) return n;
  }
  return '';
}

function textExpr(alias, cols, names, fallback="''"){
  const c = firstCol(cols, names);
  return c ? `${alias}.${qIdent(c)}` : fallback;
}
function numExpr(alias, cols, names, fallback='0'){
  const c = firstCol(cols, names);
  return c ? `COALESCE(${alias}.${qIdent(c)},0)` : fallback;
}
function dateExpr(alias, cols, names){
  const c = firstCol(cols, names);
  return c ? `${alias}.${qIdent(c)}` : '';
}

function todayWhere(expr){
  return expr ? `${expr} >= date_trunc('day', now())` : 'FALSE';
}
function monthWhere(expr){
  return expr ? `${expr} >= date_trunc('month', now())` : 'FALSE';
}
function happenedToday(expr){
  return expr ? `${expr} >= date_trunc('day', now())` : 'FALSE';
}

async function getOrderSchema(pool){
  const orderTable = await tableExists(pool, 'gm_order') ? 'gm_order' : '';
  const itemTable = await tableExists(pool, 'gm_order_item') ? 'gm_order_item' : '';
  return {
    orderTable,
    itemTable,
    orderCols: orderTable ? await columnNames(pool, orderTable) : [],
    itemCols: itemTable ? await columnNames(pool, itemTable) : []
  };
}

async function aggregateOrders(pool, schema){
  const { orderTable, orderCols } = schema;
  if(!orderTable){
    return {};
  }

  const orderedAt = dateExpr('o', orderCols, ['ordered_at','created_at']);
  const totalAmount = numExpr('o', orderCols, ['total_payment_price','expected_payment_amount','total_product_price']);
  const paidAmount = numExpr('o', orderCols, ['actual_payment_amount']);
  const refundAmount = numExpr('o', orderCols, ['refund_amount']);
  const paymentCompletedAt = dateExpr('o', orderCols, ['payment_completed_at','payment_confirmed_at']);
  const refundCompletedAt = dateExpr('o', orderCols, ['refund_completed_at']);
  const shippingStatus = textExpr('o', orderCols, ['shipping_status'], "''");
  const sellerStatus = textExpr('o', orderCols, ['seller_status','order_status'], "''");
  const customerStatus = textExpr('o', orderCols, ['customer_status'], "''");
  const csStatus = textExpr('o', orderCols, ['cs_status'], "''");
  const updatedAt = dateExpr('o', orderCols, ['updated_at','created_at']);

  const sql = `
    SELECT
      COUNT(*) FILTER (WHERE ${todayWhere(orderedAt)})::int AS today_orders,
      COUNT(*) FILTER (WHERE ${monthWhere(orderedAt)})::int AS month_orders,

      COALESCE(SUM(${totalAmount}) FILTER (WHERE ${todayWhere(orderedAt)}),0)::bigint AS today_order_amount,
      COALESCE(SUM(${totalAmount}) FILTER (WHERE ${monthWhere(orderedAt)}),0)::bigint AS month_order_amount,

      COUNT(*) FILTER (
        WHERE ${todayWhere(paymentCompletedAt || orderedAt)}
          AND ${paidAmount} > 0
      )::int AS today_paid_count,
      COUNT(*) FILTER (
        WHERE ${monthWhere(paymentCompletedAt || orderedAt)}
          AND ${paidAmount} > 0
      )::int AS month_paid_count,
      COALESCE(SUM(${paidAmount}) FILTER (
        WHERE ${todayWhere(paymentCompletedAt || orderedAt)}
      ),0)::bigint AS today_paid_amount,
      COALESCE(SUM(${paidAmount}) FILTER (
        WHERE ${monthWhere(paymentCompletedAt || orderedAt)}
      ),0)::bigint AS month_paid_amount,

      COUNT(*) FILTER (
        WHERE ${todayWhere(refundCompletedAt || updatedAt || orderedAt)}
          AND ${refundAmount} > 0
      )::int AS today_refund_count,
      COUNT(*) FILTER (
        WHERE ${monthWhere(refundCompletedAt || updatedAt || orderedAt)}
          AND ${refundAmount} > 0
      )::int AS month_refund_count,
      COALESCE(SUM(${refundAmount}) FILTER (
        WHERE ${todayWhere(refundCompletedAt || updatedAt || orderedAt)}
      ),0)::bigint AS today_refund_amount,
      COALESCE(SUM(${refundAmount}) FILTER (
        WHERE ${monthWhere(refundCompletedAt || updatedAt || orderedAt)}
      ),0)::bigint AS month_refund_amount,

      COUNT(*) FILTER (
        WHERE UPPER(COALESCE(${sellerStatus}::text,'')) IN ('READY_TO_ORDER','PENDING','WAITING')
      )::int AS auto_order_waiting,

      COUNT(*) FILTER (
        WHERE UPPER(COALESCE(${sellerStatus}::text,'')) IN ('PREPARING','PRODUCT_PREPARING')
      )::int AS preparing,

      COUNT(*) FILTER (
        WHERE UPPER(COALESCE(${shippingStatus}::text,'')) IN ('HOLD','ON_HOLD','DELIVERY_HOLD')
      )::int AS delivery_hold,

      COUNT(*) FILTER (
        WHERE UPPER(COALESCE(${shippingStatus}::text,'')) IN ('READY','READY_TO_SHIP','DELIVERY_READY','PREPARING')
      )::int AS delivery_ready,

      COUNT(*) FILTER (
        WHERE UPPER(COALESCE(${sellerStatus}::text,'')) IN ('SHIPPING','IN_TRANSIT','SHIPPED','DISPATCHED')
           OR UPPER(COALESCE(${shippingStatus}::text,'')) IN ('SHIPPING','IN_TRANSIT','SHIPPED','DISPATCHED')
      )::int AS shipping,

      COUNT(*) FILTER (WHERE UPPER(COALESCE(${customerStatus}::text,''))='CANCEL_REQUESTED')::int AS cancel_request,
      COUNT(*) FILTER (WHERE UPPER(COALESCE(${customerStatus}::text,''))='CANCEL_PROCESSING')::int AS cancel_processing,
      COUNT(*) FILTER (WHERE UPPER(COALESCE(${customerStatus}::text,''))='EXCHANGE_REQUESTED')::int AS exchange_request,
      COUNT(*) FILTER (WHERE UPPER(COALESCE(${customerStatus}::text,''))='EXCHANGE_PROCESSING')::int AS exchange_processing,
      COUNT(*) FILTER (WHERE UPPER(COALESCE(${customerStatus}::text,''))='RETURN_REQUESTED')::int AS return_request,
      COUNT(*) FILTER (WHERE UPPER(COALESCE(${customerStatus}::text,''))='RETURN_PROCESSING')::int AS return_processing,

      COUNT(*) FILTER (
        WHERE UPPER(COALESCE(${customerStatus}::text,'')) IN ('CANCEL_COMPLETED','RETURN_COMPLETED')
          AND ${refundCompletedAt ? `${refundCompletedAt} IS NULL` : 'TRUE'}
      )::int AS refund_waiting,

      COUNT(*) FILTER (
        WHERE UPPER(COALESCE(${sellerStatus}::text,'')) IN ('ORDERED','PREPARING','SHIPPING','DELIVERED')
          AND ${happenedToday(updatedAt || orderedAt)}
      )::int AS auto_order_success,

      COUNT(*) FILTER (
        WHERE ${paidAmount} > 0 AND ${happenedToday(paymentCompletedAt || updatedAt || orderedAt)}
      )::int AS payment_done,

      COUNT(*) FILTER (
        WHERE UPPER(COALESCE(${shippingStatus}::text,'')) IN ('READY','READY_TO_SHIP','DELIVERY_READY','PREPARING')
          AND ${happenedToday(updatedAt || orderedAt)}
      )::int AS delivery_ready_done,

      COUNT(*) FILTER (
        WHERE UPPER(COALESCE(${shippingStatus}::text,'')) IN ('SHIPPING','IN_TRANSIT','SHIPPED','DISPATCHED')
          AND ${happenedToday(updatedAt || orderedAt)}
      )::int AS shipping_started,

      COUNT(*) FILTER (
        WHERE UPPER(COALESCE(${sellerStatus}::text,''))='DELIVERED'
          AND ${happenedToday(dateExpr('o', orderCols, ['delivered_at','updated_at','created_at']) || orderedAt)}
      )::int AS delivered,

      COUNT(*) FILTER (
        WHERE UPPER(COALESCE(${customerStatus}::text,''))='CANCEL_COMPLETED'
          AND ${happenedToday(dateExpr('o', orderCols, ['cs_completed_at','cancel_completed_at','updated_at']) || orderedAt)}
      )::int AS cancel_done,

      COUNT(*) FILTER (
        WHERE UPPER(COALESCE(${customerStatus}::text,''))='EXCHANGE_COMPLETED'
          AND ${happenedToday(dateExpr('o', orderCols, ['cs_completed_at','updated_at']) || orderedAt)}
      )::int AS exchange_done,

      COUNT(*) FILTER (
        WHERE UPPER(COALESCE(${customerStatus}::text,''))='RETURN_COMPLETED'
          AND ${happenedToday(dateExpr('o', orderCols, ['cs_completed_at','updated_at']) || orderedAt)}
      )::int AS return_done,

      COUNT(*) FILTER (
        WHERE ${refundAmount} > 0
          AND ${happenedToday(refundCompletedAt || updatedAt || orderedAt)}
      )::int AS refund_done,

      COUNT(*) FILTER (
        WHERE UPPER(COALESCE(${csStatus}::text,'')) NOT IN ('','NONE','DONE','COMPLETED','CLOSED')
      )::int AS pending_cs

    FROM ${qIdent(orderTable)} o
  `;

  const r = await pool.query(sql);
  return r.rows[0] || {};
}

async function aggregateItemExceptions(pool, schema){
  const { itemTable, itemCols } = schema;
  const out = {
    auto_order_failed:0,
    login_required:0,
    price_changed:0,
    stock_or_option_error:0,
    no_invoice:0,
    delivery_delay:0
  };
  if(!itemTable) return out;

  const orderStatus = textExpr('i', itemCols, ['item_order_status'], "''");
  const shippingStatus = textExpr('i', itemCols, ['item_shipping_status'], "''");
  const tracking = textExpr('i', itemCols, ['tracking_number'], "''");
  const updated = dateExpr('i', itemCols, ['updated_at','created_at']);

  const r = await pool.query(`
    SELECT
      COUNT(*) FILTER (
        WHERE UPPER(COALESCE(${orderStatus}::text,'')) IN
          ('FAILED','ORDER_FAILED','AUTO_ORDER_FAILED','ERROR')
      )::int AS auto_order_failed,

      COUNT(*) FILTER (
        WHERE UPPER(COALESCE(${orderStatus}::text,'')) IN
          ('LOGIN_REQUIRED','AUTH_REQUIRED')
      )::int AS login_required,

      COUNT(*) FILTER (
        WHERE UPPER(COALESCE(${orderStatus}::text,'')) IN
          ('PRICE_CHANGED','PRICE_MISMATCH')
      )::int AS price_changed,

      COUNT(*) FILTER (
        WHERE UPPER(COALESCE(${orderStatus}::text,'')) IN
          ('OUT_OF_STOCK','OPTION_ERROR','OPTION_MISMATCH','STOCK_ERROR')
      )::int AS stock_or_option_error,

      COUNT(*) FILTER (
        WHERE UPPER(COALESCE(${shippingStatus}::text,'')) IN
          ('SHIPPING','IN_TRANSIT','SHIPPED','DISPATCHED')
          AND BTRIM(COALESCE(${tracking}::text,''))=''
      )::int AS no_invoice,

      COUNT(*) FILTER (
        WHERE UPPER(COALESCE(${shippingStatus}::text,'')) IN
          ('DELAYED','DELIVERY_DELAY')
          OR (
            UPPER(COALESCE(${shippingStatus}::text,'')) IN ('SHIPPING','IN_TRANSIT')
            AND ${updated ? `${updated} < now() - interval '7 day'` : 'FALSE'}
          )
      )::int AS delivery_delay
    FROM ${qIdent(itemTable)} i
  `);

  return Object.assign(out, r.rows[0] || {});
}

async function dashboardSummary(pool){
  const schema = await getOrderSchema(pool);
  const [orders, exceptions] = await Promise.all([
    aggregateOrders(pool, schema),
    aggregateItemExceptions(pool, schema)
  ]);

  return {
    mode: process.env.GM_AUTO_ORDER_MODE || 'SEMI_AUTO',
    updated_at: new Date().toISOString(),

    today_order_amount:num(orders.today_order_amount),
    month_order_amount:num(orders.month_order_amount),
    today_orders:num(orders.today_orders),
    month_orders:num(orders.month_orders),

    today_paid_amount:num(orders.today_paid_amount),
    month_paid_amount:num(orders.month_paid_amount),
    today_paid_count:num(orders.today_paid_count),
    month_paid_count:num(orders.month_paid_count),

    today_refund_amount:num(orders.today_refund_amount),
    month_refund_amount:num(orders.month_refund_amount),
    today_refund_count:num(orders.today_refund_count),
    month_refund_count:num(orders.month_refund_count),

    auto_order_waiting:num(orders.auto_order_waiting),
    preparing:num(orders.preparing),
    delivery_hold:num(orders.delivery_hold),
    delivery_ready:num(orders.delivery_ready),
    shipping:num(orders.shipping),

    cancel_request:num(orders.cancel_request),
    cancel_processing:num(orders.cancel_processing),
    exchange_request:num(orders.exchange_request),
    exchange_processing:num(orders.exchange_processing),
    return_request:num(orders.return_request),
    return_processing:num(orders.return_processing),
    refund_waiting:num(orders.refund_waiting),

    auto_order_success:num(orders.auto_order_success),
    payment_done:num(orders.payment_done),
    delivery_ready_done:num(orders.delivery_ready_done),
    shipping_started:num(orders.shipping_started),
    delivered:num(orders.delivered),
    cancel_done:num(orders.cancel_done),
    exchange_done:num(orders.exchange_done),
    return_done:num(orders.return_done),
    refund_done:num(orders.refund_done),

    auto_order_failed:num(exceptions.auto_order_failed),
    login_required:num(exceptions.login_required),
    price_changed:num(exceptions.price_changed),
    stock_or_option_error:num(exceptions.stock_or_option_error),
    no_invoice:num(exceptions.no_invoice),
    delivery_delay:num(exceptions.delivery_delay),
    pending_cs:num(orders.pending_cs),

    // 실행기 등록 API는 다음 단계에서 실제 Queue/Client Registry와 연결한다.
    client_online:0,
    cpkr_ready:0,
    alkr_ready:0,
    payment_waiting:0
  };
}

async function attentionRows(pool){
  const schema = await getOrderSchema(pool);
  const { orderTable, itemTable, orderCols, itemCols } = schema;
  if(!orderTable) return [];

  const orderNo = textExpr('o', orderCols, ['order_no'], "''");
  const orderedAt = textExpr('o', orderCols, ['ordered_at','created_at'], 'NULL');
  const sellerStatus = textExpr('o', orderCols, ['seller_status','order_status'], "''");
  const customerStatus = textExpr('o', orderCols, ['customer_status'], "''");
  const shippingStatus = textExpr('o', orderCols, ['shipping_status'], "''");
  const csStatus = textExpr('o', orderCols, ['cs_status'], "''");

  let productJoin = '';
  let productName = "''";
  let sourceMall = "''";
  let itemOrderStatus = "''";
  let itemShippingStatus = "''";

  if(itemTable){
    const itemOrderNoCol = firstCol(itemCols, ['order_no']);
    if(itemOrderNoCol){
      const itemName = textExpr('i', itemCols, ['product_name'], "''");
      const itemSource = textExpr('i', itemCols, ['source_mall','mall_code'], "''");
      const itemOrder = textExpr('i', itemCols, ['item_order_status'], "''");
      const itemShip = textExpr('i', itemCols, ['item_shipping_status'], "''");
      productJoin = `
        LEFT JOIN LATERAL (
          SELECT *
          FROM ${qIdent(itemTable)} ix
          WHERE ix.${qIdent(itemOrderNoCol)} = ${orderNo}
          ORDER BY ix.${qIdent(itemOrderNoCol)}
          LIMIT 1
        ) i ON TRUE
      `;
      productName = itemName;
      sourceMall = itemSource;
      itemOrderStatus = itemOrder;
      itemShippingStatus = itemShip;
    }
  }

  const sql = `
    SELECT
      ${orderedAt} AS ordered_at,
      ${orderNo} AS order_no,
      ${sourceMall} AS source_mall,
      ${productName} AS product_name,
      ${sellerStatus} AS auto_order_status,
      ${shippingStatus} AS delivery_status,
      CASE
        WHEN UPPER(COALESCE(${itemOrderStatus}::text,'')) IN ('FAILED','ORDER_FAILED','AUTO_ORDER_FAILED','ERROR')
          THEN '자동주문 실패'
        WHEN UPPER(COALESCE(${itemOrderStatus}::text,'')) IN ('LOGIN_REQUIRED','AUTH_REQUIRED')
          THEN '로그인 필요'
        WHEN UPPER(COALESCE(${itemOrderStatus}::text,'')) IN ('PRICE_CHANGED','PRICE_MISMATCH')
          THEN '가격변경'
        WHEN UPPER(COALESCE(${itemOrderStatus}::text,'')) IN ('OUT_OF_STOCK','OPTION_ERROR','OPTION_MISMATCH','STOCK_ERROR')
          THEN '품절/옵션 오류'
        WHEN UPPER(COALESCE(${customerStatus}::text,'')) LIKE '%_REQUESTED'
          OR UPPER(COALESCE(${customerStatus}::text,'')) LIKE '%_PROCESSING'
          THEN '취소/교환/반품'
        WHEN UPPER(COALESCE(${csStatus}::text,'')) NOT IN ('','NONE','DONE','COMPLETED','CLOSED')
          THEN '미처리 CS'
        WHEN UPPER(COALESCE(${itemShippingStatus}::text,'')) IN ('DELAYED','DELIVERY_DELAY')
          THEN '배송지연'
        ELSE '확인 필요'
      END AS attention_reason
    FROM ${qIdent(orderTable)} o
    ${productJoin}
    WHERE
      UPPER(COALESCE(${itemOrderStatus}::text,'')) IN (
        'FAILED','ORDER_FAILED','AUTO_ORDER_FAILED','ERROR',
        'LOGIN_REQUIRED','AUTH_REQUIRED',
        'PRICE_CHANGED','PRICE_MISMATCH',
        'OUT_OF_STOCK','OPTION_ERROR','OPTION_MISMATCH','STOCK_ERROR'
      )
      OR UPPER(COALESCE(${customerStatus}::text,'')) LIKE '%_REQUESTED'
      OR UPPER(COALESCE(${customerStatus}::text,'')) LIKE '%_PROCESSING'
      OR UPPER(COALESCE(${csStatus}::text,'')) NOT IN ('','NONE','DONE','COMPLETED','CLOSED')
      OR UPPER(COALESCE(${itemShippingStatus}::text,'')) IN ('DELAYED','DELIVERY_DELAY')
    ORDER BY ${orderedAt} DESC NULLS LAST
    LIMIT 30
  `;

  const r = await pool.query(sql);
  return r.rows;
}

router.get('/api/auto-order/dashboard/summary', async (req, res) => {
  const pool = req.app && req.app.locals ? req.app.locals.pool : null;
  if(!pool) return res.status(503).json({ ok:false, error:'database pool not ready' });
  try{
    const data = await dashboardSummary(pool);
    return res.json({ ok:true, data });
  }catch(e){
    console.error('[GM_AUTO_ORDER_DASHBOARD_SUMMARY_ERROR]', e);
    return res.status(500).json({ ok:false, error:String(e && e.message || e) });
  }
});

router.get('/api/auto-order/dashboard/clients', async (req, res) => {
  /*
   * 실행기 Registry는 다음 자동주문 단계에서 연결한다.
   * 지금은 대시보드가 실제 API를 사용하도록 endpoint만 고정한다.
   */
  return res.json({ ok:true, data:[] });
});

router.get('/api/auto-order/dashboard/attention', async (req, res) => {
  const pool = req.app && req.app.locals ? req.app.locals.pool : null;
  if(!pool) return res.status(503).json({ ok:false, error:'database pool not ready' });
  try{
    const data = await attentionRows(pool);
    return res.json({ ok:true, data });
  }catch(e){
    console.error('[GM_AUTO_ORDER_DASHBOARD_ATTENTION_ERROR]', e);
    return res.status(500).json({ ok:false, error:String(e && e.message || e) });
  }
});

module.exports = router;
